import type { PlatformAdapters } from '@core/adapters'
import { hydrateSettings, toPersistedSettings } from '@core/store/settings'
import * as keys from '@core/store/keys'
import type {
  AppSettings,
  Character,
  Conversation,
  PersonaPreset,
  WorldPreset,
  ScenePreset
} from '@core/types'
import { DEFAULT_SETTINGS } from '@core/types'
import { DataError } from '@core/data'
import type {
  AppStateSnapshot,
  LlmSettingsSnapshot,
  ModuleToggle,
  PackConflictPolicy,
  SendMessageInput
} from '@core/data'
import { extractCharaJson, PngCardError } from '@core/card/pngCard'
import { importStJson } from '@core/card/stCardMapper'
import { bytesToBase64 } from '@core/util/base64'
import { LocalEventSource } from '../events/localEventSource'
import { newId } from './id'
import { toConversationSnapshot } from './messages'
import {
  blankCharacter,
  importCharactersFromDstPack,
  seedDefaultCharactersIfEmpty,
  seedDefaultPresetsIfEmpty
} from './seedDefaults'
import { sendStandaloneMessage } from './chat'

const MODULE_DEFS: ModuleToggle[] = [
  { id: 'desktopst.weather', label: '天氣', enabled: false },
  { id: 'desktopst.news', label: '個人新聞報', enabled: false },
  { id: 'desktopst.spotify', label: 'Spotify 音樂偵測', enabled: false },
  { id: 'desktopst.calendar', label: 'Google 日曆', enabled: false }
]

export interface BootStandaloneOptions {
  /** 測試用：直接注入 dstpack bytes，略過 fetch */
  packBytes?: Uint8Array | null
  /** 測試用：不要去 fetch 預設包 */
  skipPackFetch?: boolean
}

/**
 * 獨立模式執行期狀態：settings／角色／對話全在記憶體，
 * 變更時透過 `StorageAdapter` 落地。
 */
export class StandaloneSession {
  readonly events = new LocalEventSource()
  settings: AppSettings = { ...DEFAULT_SETTINGS }
  characters: Character[] = []
  personas: PersonaPreset[] = []
  worlds: WorldPreset[] = []
  scenes: ScenePreset[] = []
  activeConversation: Conversation | null = null
  private conversationIndex = new Map<string, Conversation>()

  private constructor(readonly adapters: PlatformAdapters) {}

  static async boot(
    adapters: PlatformAdapters,
    opts: BootStandaloneOptions = {}
  ): Promise<StandaloneSession> {
    const session = new StandaloneSession(adapters)
    await session.loadAll(opts)
    return session
  }

  private async loadAll(opts: BootStandaloneOptions): Promise<void> {
    for (const dir of keys.DATA_SUBDIRS) {
      // list 不存在的目錄回 []；寫檔時 recursive 會建
      await this.adapters.storage.list(dir).catch(() => [])
    }

    await this.loadSettings()
    const seededPresets = await seedDefaultPresetsIfEmpty(this.adapters.storage)
    await this.reloadPresets()
    if (seededPresets.personas[0] && !this.settings.activePersonaId) {
      this.settings.activePersonaId = seededPresets.personas[0].id
    }
    if (seededPresets.worlds[0] && !this.settings.activeWorldId) {
      this.settings.activeWorldId = seededPresets.worlds[0].id
    }

    const seededChars = await seedDefaultCharactersIfEmpty(this.adapters.storage, {
      packBytes: opts.packBytes,
      skipFetch: opts.skipPackFetch === true && opts.packBytes === undefined
    })

    await this.reloadCharacters()
    if (seededChars.desktopState.length > 0 && this.settings.ui.desktopCharacters.length === 0) {
      this.settings.ui.desktopCharacters = seededChars.desktopState
    }
    if (this.characters.length === 0) {
      const c = blankCharacter('新角色')
      await this.adapters.storage.writeJson(keys.characterCardKey(c.id), c)
      this.characters = [c]
    }

    // 校正在場清單：只留仍存在的角色；若空則放入第一個
    const charIds = new Set(this.characters.map((c) => c.id))
    this.settings.ui.desktopCharacters = this.settings.ui.desktopCharacters.filter((d) =>
      charIds.has(d.characterId)
    )
    if (this.settings.ui.desktopCharacters.length === 0 && this.characters[0]) {
      this.settings.ui.desktopCharacters = [
        {
          characterId: this.characters[0].id,
          position: { x: 80, y: 400 },
          size: 1,
          flipped: false,
          muted: false,
          zIndex: 1
        }
      ]
    }

    await this.saveSettings()
    await this.reloadConversations()
    if (!this.activeConversation) {
      await this.createConversation('聊天')
    }
  }

  private async loadSettings(): Promise<void> {
    const raw = await this.adapters.storage.readJson<Record<string, unknown>>(keys.SETTINGS_KEY)
    const pinned =
      (await this.adapters.storage.readJson<import('@core/types').PinnedNote[]>(keys.PINNED_NOTES_KEY)) ??
      []
    const result = hydrateSettings(raw, pinned, {
      secrets: this.adapters.secrets,
      migrate: {
        newId,
        now: () => Date.now(),
        labels: {
          personaPresetName: '預設使用者',
          worldPresetName: '預設世界觀',
          fallbackDisplayName: '使用者',
          fallbackNickname: '主人'
        }
      },
      resolveRemoteControl: () => ({
        ...DEFAULT_SETTINGS.remoteControl!,
        enabled: false
      })
    })
    this.settings = result.settings
    if (result.personaToSave) {
      await this.adapters.storage.writeJson(keys.personaKey(result.personaToSave.id), result.personaToSave)
    }
    if (result.worldToSave) {
      await this.adapters.storage.writeJson(keys.worldKey(result.worldToSave.id), result.worldToSave)
    }
    if (result.needsResave || result.shouldSavePinnedNotes) {
      if (result.shouldSavePinnedNotes) {
        await this.adapters.storage.writeJson(keys.PINNED_NOTES_KEY, this.settings.ui.pinnedNotes ?? [])
      }
      await this.saveSettings()
    }
  }

  async saveSettings(): Promise<void> {
    const persisted = toPersistedSettings(this.settings, this.adapters.secrets)
    await this.adapters.storage.writeJson(keys.SETTINGS_KEY, persisted)
  }

  async reloadCharacters(): Promise<void> {
    const dirs = await this.adapters.storage.list(keys.CHARACTERS_DIR)
    const chars: Character[] = []
    for (const dirKey of dirs) {
      const id = dirKey.split('/').pop()
      if (!id) continue
      const card = await this.adapters.storage.readJson<Character>(keys.characterCardKey(id))
      if (card) chars.push(card)
    }
    this.characters = chars
  }

  async reloadPresets(): Promise<void> {
    this.personas = await this.loadPresetDir<PersonaPreset>(keys.PERSONAS_DIR, keys.personaKey)
    this.worlds = await this.loadPresetDir<WorldPreset>(keys.WORLDS_DIR, keys.worldKey)
    this.scenes = await this.loadPresetDir<ScenePreset>(keys.SCENES_DIR, keys.sceneKey)
  }

  private async loadPresetDir<T>(
    dir: string,
    keyOf: (id: string) => string
  ): Promise<T[]> {
    const listed = await this.adapters.storage.list(dir)
    const out: T[] = []
    for (const entry of listed) {
      const name = entry.split('/').pop() ?? ''
      const id = keys.idFromJsonName(name)
      if (!id) continue
      const item = await this.adapters.storage.readJson<T>(keyOf(id))
      if (item) out.push(item)
    }
    return out
  }

  private async reloadConversations(): Promise<void> {
    const listed = await this.adapters.storage.list(keys.CONVERSATIONS_DIR)
    this.conversationIndex.clear()
    let newest: Conversation | null = null
    for (const entry of listed) {
      const name = entry.split('/').pop() ?? ''
      const id = keys.idFromJsonName(name)
      if (!id) continue
      const conv = await this.adapters.storage.readJson<Conversation>(keys.conversationKey(id))
      if (!conv) continue
      this.conversationIndex.set(conv.id, conv)
      if (!newest || conv.updatedAt > newest.updatedAt) newest = conv
    }
    this.activeConversation = newest
  }

  async saveConversation(conv: Conversation): Promise<void> {
    this.conversationIndex.set(conv.id, conv)
    if (this.activeConversation?.id === conv.id) this.activeConversation = conv
    await this.adapters.storage.writeJson(keys.conversationKey(conv.id), conv)
  }

  getState(): AppStateSnapshot {
    const present = this.settings.ui.desktopCharacters.map((d) => {
      const c = this.characters.find((x) => x.id === d.characterId)
      return { id: d.characterId, name: c?.name ?? '角色', muted: !!d.muted }
    })
    return {
      presentCharacters: present,
      conversation: toConversationSnapshot(this.activeConversation),
      colorTheme: this.settings.ui.colorTheme ?? 'mint',
      randomToolsEnabled: this.settings.ui.randomToolsEnabled !== false,
      maxImagesPerMessage: this.settings.llm.maxImagesPerMessage ?? 3,
      activeSceneId: this.settings.activeSceneId || undefined,
      activePersonaId: this.settings.activePersonaId || undefined,
      activeWorldId: this.settings.activeWorldId || undefined,
      activeSceneDirty: false
    }
  }

  llmSnapshot(): LlmSettingsSnapshot {
    const providers = ['openai', 'claude', 'gemini', 'grok'] as const
    const hasApiKey = {} as LlmSettingsSnapshot['hasApiKey']
    for (const p of providers) {
      hasApiKey[p] = !!this.settings.llm.apiKeys[p]?.trim()
    }
    const provider = this.settings.llm.provider
    return {
      provider,
      model: this.settings.llm.models?.[provider] || this.settings.llm.model || '',
      models: { ...(this.settings.llm.models ?? {}) },
      endpoint: this.settings.llm.endpoint,
      hasApiKey,
      maxResponseTokens: this.settings.llm.maxResponseTokens ?? 360,
      maxGroupRounds: this.settings.llm.maxGroupRounds ?? 3,
      maxImagesPerMessage: this.settings.llm.maxImagesPerMessage ?? 5
    }
  }

  listModules(): ModuleToggle[] {
    return MODULE_DEFS.map((m) => ({
      ...m,
      enabled:
        m.id === 'desktopst.weather'
          ? !!this.settings.weather?.enabled
          : m.id === 'desktopst.spotify'
            ? !!this.settings.spotify?.enabled
            : m.id === 'desktopst.calendar'
              ? !!this.settings.calendar?.enabled
              : false
    }))
  }

  async setModuleEnabled(id: string, enabled: boolean): Promise<void> {
    switch (id) {
      case 'desktopst.weather':
        this.settings.weather = {
          polish: false,
          locationName: '',
          latitude: 0,
          longitude: 0,
          locationSource: '' as const,
          ...this.settings.weather,
          enabled
        }
        break
      case 'desktopst.spotify':
        this.settings.spotify = { ...(this.settings.spotify ?? { enabled: false, clientId: '' }), enabled }
        break
      case 'desktopst.calendar':
        this.settings.calendar = {
          clientId: '',
          lookaheadHours: 24,
          maxEvents: 5,
          mentionWhenEmpty: false,
          ...this.settings.calendar,
          enabled
        }
        break
      case 'desktopst.news':
        // 獨立模式新聞模組設定檔尚未接；先忽略不炸
        break
      default:
        throw new DataError('not-found', `unknown module ${id}`)
    }
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    await sendStandaloneMessage({
      adapters: this.adapters,
      events: this.events,
      settings: this.settings,
      characters: this.characters,
      getActiveConversation: () => this.activeConversation,
      saveConversation: (c) => this.saveConversation(c),
      getPersona: () => this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null,
      getWorld: () => this.worlds.find((w) => w.id === this.settings.activeWorldId) ?? null,
      input
    })
  }

  listConversations() {
    const activeId = this.activeConversation?.id
    return [...this.conversationIndex.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
        active: c.id === activeId
      }))
  }

  async loadConversation(id: string): Promise<void> {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    this.activeConversation = conv
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async createConversation(title?: string) {
    const now = Date.now()
    const conv: Conversation = {
      id: newId(),
      title: title?.trim() || '新對話',
      participantIds: this.settings.ui.desktopCharacters.map((d) => d.characterId),
      messages: [],
      summary: '',
      createdAt: now,
      updatedAt: now
    }
    await this.saveConversation(conv)
    this.activeConversation = conv
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return {
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      active: true
    }
  }

  async renameConversation(id: string, title: string) {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    conv.title = title.trim() || conv.title
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return {
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      active: this.activeConversation?.id === id
    }
  }

  async removeConversation(id: string) {
    if (!this.conversationIndex.has(id)) throw new DataError('not-found', id)
    await this.adapters.storage.remove(keys.conversationKey(id))
    this.conversationIndex.delete(id)
    if (this.activeConversation?.id === id) {
      this.activeConversation = null
    }
    if (this.conversationIndex.size === 0) {
      await this.createConversation('聊天')
    } else if (!this.activeConversation) {
      const next = [...this.conversationIndex.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      this.activeConversation = next ?? null
    }
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return { activeConversationId: this.activeConversation!.id }
  }

  async removeMessage(messageId: string): Promise<void> {
    const conv = this.activeConversation
    if (!conv) throw new DataError('not-found', 'no conversation')
    const before = conv.messages.length
    conv.messages = conv.messages.filter((m) => m.id !== messageId)
    if (conv.messages.length === before) throw new DataError('not-found', messageId)
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async editMessage(messageId: string, content: string): Promise<void> {
    const conv = this.activeConversation
    if (!conv) throw new DataError('not-found', 'no conversation')
    const msg = conv.messages.find((m) => m.id === messageId)
    if (!msg) throw new DataError('not-found', messageId)
    msg.content = content
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async resendMessage(messageId: string): Promise<void> {
    const conv = this.activeConversation
    if (!conv) throw new DataError('not-found', 'no conversation')
    const idx = conv.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) throw new DataError('not-found', messageId)
    // 找到該則或之前最近的 user 訊息
    let userIdx = idx
    while (userIdx >= 0 && conv.messages[userIdx]!.role !== 'user') userIdx--
    if (userIdx < 0) throw new DataError('invalid-input', 'no user message to resend')
    const userMsg = conv.messages[userIdx]!
    conv.messages = conv.messages.slice(0, userIdx)
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    await this.sendMessage({
      content: userMsg.content,
      images: userMsg.images,
      randomResults: userMsg.randomResults,
      newsLink: userMsg.newsLink
    })
  }

  async getMessageImageUrl(messageId: string, index: number): Promise<string | null> {
    const conv = this.activeConversation
    const msg = conv?.messages.find((m) => m.id === messageId)
    const img = msg?.images?.[index]
    return img ?? null
  }

  async avatarDataUrl(characterId: string): Promise<string | null> {
    const char = this.characters.find((c) => c.id === characterId)
    if (!char?.avatar) return null
    if (char.avatar.startsWith('data:')) return char.avatar
    const bytes = await this.adapters.storage.readBinary(char.avatar)
    if (!bytes) return null
    const ext = char.avatar.split('.').pop()?.toLowerCase() ?? 'png'
    const mime =
      ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
    return `data:${mime};base64,${bytesToBase64(bytes)}`
  }

  async setPresent(id: string, present: boolean): Promise<void> {
    if (!this.characters.some((c) => c.id === id)) throw new DataError('not-found', id)
    const list = this.settings.ui.desktopCharacters
    const exists = list.some((d) => d.characterId === id)
    if (present && !exists) {
      list.push({
        characterId: id,
        position: { x: 80, y: 400 },
        size: 1,
        flipped: false,
        muted: false,
        zIndex: list.length + 1
      })
    } else if (!present && exists) {
      if (list.length <= 1) throw new DataError('conflict', 'last-present-character')
      this.settings.ui.desktopCharacters = list.filter((d) => d.characterId !== id)
    }
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async toggleMute(id: string): Promise<void> {
    const d = this.settings.ui.desktopCharacters.find((x) => x.characterId === id)
    if (!d) throw new DataError('not-found', id)
    d.muted = !d.muted
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async speak(id: string): Promise<void> {
    // 獨立模式沒有「強制說話」桌寵流程；當作解除禁言後的輕提示
    const d = this.settings.ui.desktopCharacters.find((x) => x.characterId === id)
    if (!d) throw new DataError('not-found', id)
    if (d.muted) {
      d.muted = false
      await this.saveSettings()
    }
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async saveCharacter(char: Character): Promise<void> {
    char.updatedAt = Date.now()
    const idx = this.characters.findIndex((c) => c.id === char.id)
    if (idx >= 0) this.characters[idx] = char
    else this.characters.push(char)
    await this.adapters.storage.writeJson(keys.characterCardKey(char.id), char)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async createCharacter(name: string): Promise<Character> {
    const char = blankCharacter(name?.trim() || '新角色')
    await this.saveCharacter(char)
    await this.ensurePresent(char.id)
    return char
  }

  /** 匯入 SillyTavern PNG／JSON 角色卡（獨立模式測試必備）。 */
  async importCard(file: { bytes: Uint8Array; kind: 'png' | 'json' }): Promise<Character> {
    try {
      const id = newId()
      let char: Character
      if (file.kind === 'png') {
        const jsonStr = extractCharaJson(file.bytes)
        char = importStJson(JSON.parse(jsonStr), id)
        const avatarPath = `${keys.characterDirKey(id)}/avatar.png`
        await this.adapters.storage.writeBinary(avatarPath, file.bytes)
        char = { ...char, id, avatar: avatarPath, updatedAt: Date.now() }
      } else {
        const text = new TextDecoder().decode(file.bytes)
        char = importStJson(JSON.parse(text), id)
        char = { ...char, id, avatar: char.avatar?.startsWith('data:') ? char.avatar : '', updatedAt: Date.now() }
      }
      if (!char.name?.trim()) throw new DataError('invalid-input', 'empty name')
      await this.saveCharacter(char)
      // 匯入後直接上場，方便獨立模式煙測（不必再繞角色庫加一次）
      await this.setPresent(char.id, true)
      return char
    } catch (e) {
      if (e instanceof DataError) throw e
      if (e instanceof PngCardError) throw new DataError('invalid-input', e.code)
      throw new DataError('invalid-input', e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * 匯入 `.dstpack`。一律先解成新 id，再依同名衝突策略處理。
   * 首版不套用包內 global settings。
   */
  async importPack(
    bytes: Uint8Array,
    opts: { onConflict: PackConflictPolicy; applyGlobalSettings: boolean }
  ): Promise<{ imported: number; skipped: number }> {
    void opts.applyGlobalSettings
    try {
      // 解壓前先記住既有角色（解壓後 reload 會混在一起）
      const beforeIds = new Set(this.characters.map((c) => c.id))
      const { chars } = await importCharactersFromDstPack(this.adapters.storage, bytes)
      let imported = 0
      let skipped = 0

      for (const incoming of chars) {
        const existing = this.characters.find(
          (c) => beforeIds.has(c.id) && c.name === incoming.name
        )
        if (existing && opts.onConflict === 'skip') {
          await this.adapters.storage.remove(keys.characterDirKey(incoming.id))
          skipped++
          continue
        }
        if (existing && opts.onConflict === 'overwrite') {
          await this.adapters.storage.remove(keys.characterDirKey(existing.id))
          this.characters = this.characters.filter((c) => c.id !== existing.id)
          this.settings.ui.desktopCharacters = this.settings.ui.desktopCharacters.map((d) =>
            d.characterId === existing.id ? { ...d, characterId: incoming.id } : d
          )
        }
        await this.ensurePresent(incoming.id)
        imported++
      }

      await this.saveSettings()
      await this.reloadCharacters()
      this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
      return { imported, skipped }
    } catch (e) {
      throw new DataError('invalid-input', e instanceof Error ? e.message : String(e))
    }
  }

  /** 沒有人在場時，把這隻拉上場（否則聊天列會是全空）。 */
  private async ensurePresent(id: string): Promise<void> {
    if (this.settings.ui.desktopCharacters.some((d) => d.characterId === id)) return
    if (this.settings.ui.desktopCharacters.length > 0) return
    this.settings.ui.desktopCharacters = [
      {
        characterId: id,
        position: { x: 80, y: 400 },
        size: 1,
        flipped: false,
        muted: false,
        zIndex: 1
      }
    ]
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async removeCharacter(id: string): Promise<void> {
    if (!this.characters.some((c) => c.id === id)) throw new DataError('not-found', id)
    if (this.characters.length <= 1) throw new DataError('conflict', 'last-character')
    this.characters = this.characters.filter((c) => c.id !== id)
    await this.adapters.storage.remove(keys.characterDirKey(id))
    this.settings.ui.desktopCharacters = this.settings.ui.desktopCharacters.filter(
      (d) => d.characterId !== id
    )
    if (this.settings.ui.desktopCharacters.length === 0 && this.characters[0]) {
      this.settings.ui.desktopCharacters = [
        {
          characterId: this.characters[0].id,
          position: { x: 80, y: 400 },
          size: 1,
          flipped: false,
          muted: false,
          zIndex: 1
        }
      ]
    }
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async saveAvatar(id: string, image: { bytes: Uint8Array; ext: string }): Promise<string> {
    if (!this.characters.some((c) => c.id === id)) throw new DataError('not-found', id)
    const ext = image.ext.startsWith('.') ? image.ext : `.${image.ext}`
    const path = `${keys.characterDirKey(id)}/avatar-${Date.now()}${ext}`
    await this.adapters.storage.writeBinary(path, image.bytes)
    const char = this.characters.find((c) => c.id === id)!
    char.avatar = path
    char.updatedAt = Date.now()
    await this.adapters.storage.writeJson(keys.characterCardKey(id), char)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return path
  }
}

/** 給測試／App 用的啟動入口。 */
export async function bootStandaloneSession(
  adapters: PlatformAdapters,
  opts: BootStandaloneOptions = {}
): Promise<StandaloneSession> {
  return StandaloneSession.boot(adapters, opts)
}
