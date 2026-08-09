import type { PlatformAdapters } from '@core/adapters'
import { hydrateSettings, toPersistedSettings } from '@core/store/settings'
import { applySceneSettings } from '@core/scene/apply'
import { isActiveSceneDirty } from '@core/scene/dirty'
import * as keys from '@core/store/keys'
import type {
  AppSettings,
  Character,
  Conversation,
  PersonaPreset,
  Reminder,
  WorldPreset,
  ScenePreset
} from '@core/types'
import { DEFAULT_SETTINGS } from '@core/types'
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER } from '@core/llm/modelCatalog'
import { DataError } from '@core/data'
import type {
  AppStateSnapshot,
  LlmSettingsSnapshot,
  LoreGenerateResult,
  MessageDebug,
  ModuleToggle,
  PackConflictPolicy,
  SendMessageInput,
  StopGeneratingResult
} from '@core/data'
import { extractCharaJson, PngCardError } from '@core/card/pngCard'
import { importStJson } from '@core/card/stCardMapper'
import {
  DEFAULT_SCAN_DEPTH,
  DEFAULT_TOKEN_BUDGET,
  generateLoreEntryForCharacter,
  normalizeLorebook,
  type Lorebook,
  type LoreEntry
} from '@core/lore'
import { bytesToBase64 } from '@core/util/base64'
import { fetchWeather, geocodeCity, invalidateWeatherCache, type WeatherData } from '@core/weather'
import { LocalEventSource } from '../events/localEventSource'
import { detectMobileLocation } from './weather'
import { newId } from './id'
import { toConversationSnapshot } from './messages'
import {
  blankCharacter,
  importCharactersFromDstPack,
  seedDefaultCharactersIfEmpty,
  seedDefaultPresetsIfEmpty
} from './seedDefaults'
import { forceSpeakStandalone, sendStandaloneMessage } from './chat'
import { speakStandaloneReminder, type ReminderSpeakResult } from './reminderSpeak'
import { initReminderScheduler, updateReminders, stopReminderScheduler } from './reminderScheduler'

const MODULE_DEFS: ModuleToggle[] = [
  { id: 'desktopst.weather', label: '天氣', enabled: false },
  { id: 'desktopst.news', label: '個人新聞報', enabled: false },
  { id: 'desktopst.spotify', label: 'Spotify 音樂偵測', enabled: false },
  { id: 'desktopst.calendar', label: 'Google 日曆', enabled: false }
]

const ALLOWED_AVATAR_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

/** 記住的同步主機。權杖會過期，所以拿來用之前要有失敗的心理準備。 */
export interface SyncHostMemo {
  baseUrl: string
  token: string
  lastSyncedAt: number
}

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
  reminders: Reminder[] = []
  activeConversation: Conversation | null = null
  private conversationIndex = new Map<string, Conversation>()
  private sendAbort: AbortController | null = null
  private sendDraft: { content: string; images?: string[] } | null = null
  private sendInFlight: Promise<void> | null = null
  private speakAbort: AbortController | null = null
  private speakInFlight: Promise<void> | null = null

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
    this.seedActiveModel()
    await seedDefaultPresetsIfEmpty(this.adapters.storage)
    await this.reloadPresets()
    /*
     * 校正 active 三兄弟：指到不存在（含被 `applySceneSettings` 舊 bug 洗成空字串
     * 存進 settings.json 的壞資料）就退回第一筆，不要放著讓標題列整排標籤消失。
     */
    if (!this.personas.some((p) => p.id === this.settings.activePersonaId) && this.personas[0]) {
      this.settings.activePersonaId = this.personas[0].id
    }
    if (!this.worlds.some((w) => w.id === this.settings.activeWorldId) && this.worlds[0]) {
      this.settings.activeWorldId = this.worlds[0].id
    }
    if (!this.scenes.some((s) => s.id === this.settings.activeSceneId) && this.scenes[0]) {
      this.settings.activeSceneId = this.scenes[0].id
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
    await this.reloadReminders()

    // 啟動提醒排程器：觸發時讓角色用自己的口吻把提醒講出來
    await initReminderScheduler(async (reminder) => {
      await this.recordReminderTriggered(reminder)
      return this.speakReminder(reminder)
    })
    updateReminders(this.reminders)

    if (!this.activeConversation) {
      await this.createConversation('聊天')
    }
  }

  /**
   * 把目前供應商的模型補進 `models[provider]`。
   *
   * 首次啟動時 `models` 是空的、只有早期的 `llm.model` 有值，設定頁會顯示
   * 「（尚未選擇）」。這裡把它攤平成新結構，順便讓沒有預設值的供應商
   * 拿到目錄第一個型號，避免送出空模型。
   */
  private seedActiveModel(): void {
    const llm = this.settings.llm
    const p = llm.provider
    if (llm.models?.[p]) return
    // `llm.model` 有可能是別家的型號（就是這個 bug 的成因），不屬於本家就不採用
    const catalog = MODELS_BY_PROVIDER[p] ?? []
    const fallback = DEFAULT_MODEL_BY_PROVIDER[p] || catalog[0]
    const model = (llm.model && catalog.includes(llm.model) ? llm.model : fallback) || ''
    if (!model) return
    llm.models = { ...llm.models, [p]: model }
    llm.model = model
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

  /**
   * S1 對話匯入：**電腦端** conversation id → 這台手機上對應那一則的 id。
   * 匯入情境時要靠它把情境記著的對話換成本地的（見 `remapImportedScenes`）。
   */
  importedConversationIds(): Map<string, string> {
    const out = new Map<string, string>()
    for (const conv of this.conversationIndex.values()) {
      if (conv.importedFrom) out.set(conv.importedFrom.sourceId, conv.id)
    }
    return out
  }

  /**
   * 已經帶過來的**電腦端** conversation id。
   * 匯入畫面拿它把已匯入的那幾則標出來並停用勾選，避免重複拉一份。
   */
  importedConversationSourceIds(): Set<string> {
    return new Set(this.importedConversationIds().keys())
  }

  /**
   * S1 對話匯入：放一則完整對話進來。
   *
   * **不設為使用中** —— 一次勾了五則的話，最後一則變成正在看的那則毫無道理；
   * 使用者匯入完自己去對話清單挑。
   */
  async addImportedConversation(conv: Conversation): Promise<void> {
    this.conversationIndex.set(conv.id, conv)
    await this.adapters.storage.writeJson(keys.conversationKey(conv.id), conv)
  }

  // ── 同步主機 ──────────────────────────────────────────
  //
  // roadmap §4.7 的星狀拓樸：手機只綁定**一台**同步主機，其他配對僅供遙控。
  // 記住它是為了「從電腦重新拉設定」不必每次重掃 QR。

  /**
   * 上次成功同步的那台電腦。
   *
   * 權杖會在電腦重開手機連線時換新，所以拿它去連**很可能是 401**——
   * 那不是錯誤，呼叫端要能安靜地請使用者重掃一次。
   */
  async getSyncHost(): Promise<SyncHostMemo | null> {
    return (await this.adapters.storage.readJson<SyncHostMemo>(keys.SYNC_HOST_KEY)) ?? null
  }

  async rememberSyncHost(src: { baseUrl: string; token: string }): Promise<void> {
    const memo: SyncHostMemo = { ...src, lastSyncedAt: Date.now() }
    await this.adapters.storage.writeJson(keys.SYNC_HOST_KEY, memo)
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
      showLlmBadge: this.settings.ui.showLlmBadge !== false,
      showPersonaName: this.settings.ui.showPersonaName !== false,
      maxImagesPerMessage: this.settings.llm.maxImagesPerMessage ?? 3,
      activeSceneId: this.settings.activeSceneId || undefined,
      activePersonaId: this.settings.activePersonaId || undefined,
      activeWorldId: this.settings.activeWorldId || undefined,
      activeSceneDirty: this.isActiveSceneDirty()
    }
  }

  /** 使用中情境與目前狀態是否不一致（情境名稱旁的星號）。判定與桌面共用。 */
  private isActiveSceneDirty(): boolean {
    const id = this.settings.activeSceneId
    if (!id) return false
    const scene = this.scenes.find((s) => s.id === id)
    if (!scene) return false
    return isActiveSceneDirty(scene, {
      activePersonaId: this.settings.activePersonaId,
      activeWorldId: this.settings.activeWorldId,
      colorTheme: this.settings.ui.colorTheme,
      lastActiveConversationId: this.activeConversation?.id,
      desktopCharacterIds: this.settings.ui.desktopCharacters.map((d) => d.characterId)
    })
  }

  // ── 情境與設定組（缺口 #1；桌面對應 ipcHandlers 的 *Direct 那幾支）──────

  /**
   * 套用情境：換身分／世界觀／配色／在場角色，並切到該情境記著的那則對話。
   *
   * 與桌面的差別只有「沒有視窗要開關」——設定層那段共用 `applySceneSettings`。
   * 切走之前**先把目前對話記回舊情境**，不然在 A 情境聊到一半跳去 B 再跳回來，
   * A 會停在更早以前的那則對話。
   */
  async applyScene(id: string): Promise<void> {
    const scene = this.scenes.find((s) => s.id === id)
    if (!scene) throw new DataError('not-found', id)

    const prevId = this.settings.activeSceneId
    if (prevId && prevId !== id) {
      const prev = this.scenes.find((s) => s.id === prevId)
      if (prev && this.activeConversation) {
        prev.lastActiveConversationId = this.activeConversation.id
        prev.updatedAt = Date.now()
        await this.adapters.storage.writeJson(keys.sceneKey(prev.id), prev)
      }
    }

    const target = {
      activePersonaId: this.settings.activePersonaId,
      activeWorldId: this.settings.activeWorldId,
      activeSceneId: this.settings.activeSceneId,
      colorTheme: this.settings.ui.colorTheme,
      lastActiveConversationId: this.settings.ui.lastActiveConversationId
    }
    applySceneSettings(scene, target)
    this.settings.activePersonaId = target.activePersonaId
    this.settings.activeWorldId = target.activeWorldId
    this.settings.activeSceneId = target.activeSceneId
    this.settings.ui.colorTheme = target.colorTheme
    this.settings.ui.lastActiveConversationId = target.lastActiveConversationId

    /*
     * 在場角色直接換成情境記著的那組，但**只留這台手機真的有的角色**。
     * 匯入後應已 remap 成本地 id；若仍對不到，寧願套用後變少，也不要靜靜
     * 「保持原狀」——那會讓壞掉的匯入看起來像套用沒反應（owner 2026-08-09）。
     */
    const owned = new Set(this.characters.map((c) => c.id))
    const next = scene.desktopCharacters.filter((d) => owned.has(d.characterId))
    if (scene.desktopCharacters.length > 0) {
      this.settings.ui.desktopCharacters = next.map((d) => ({ ...d }))
    }

    const wantConv = scene.lastActiveConversationId
    if (wantConv && this.conversationIndex.has(wantConv)) {
      this.activeConversation = this.conversationIndex.get(wantConv)!
    }
    /*
     * 記**真的切過去的**那則，不要照抄情境寫的。
     * `applySceneSettings` 是共用的，它只會原封不動搬過來；情境指向一則這台手機
     * 沒有的對話時（匯入來的、或那則被刪了），照抄會在設定裡留一個查不到的 id。
     */
    this.settings.ui.lastActiveConversationId = this.activeConversation?.id ?? ''

    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  /**
   * 把目前狀態存成情境。
   *
   * `id` 給既有情境 id＝「覆寫為目前狀態」，不自動套用（沿用情境既有名稱／綁定）。
   * `id` 給 `null`＝新增一個情境並直接套用 —— 手機版「新增情境」的定義本來就是
   * 「把現在這樣存起來」，不該還要使用者存完再手動套用一次（owner 2026-08-10 回報）。
   *
   * 新聞關鍵字組、用語解說綁定與模組覆蓋**要保留** —— 它們不是「目前狀態」的一部分，
   * 覆寫時一起清掉會讓使用者以為那些設定被吃掉了（桌面 `captureSceneDirect` 同樣保留）。
   */
  async captureScene(id: string | null, name: string): Promise<ScenePreset> {
    const existing = id ? this.scenes.find((s) => s.id === id) : null
    if (id && !existing) throw new DataError('not-found', id)
    const next: ScenePreset = {
      id: id ?? newId(),
      name: name.trim() || existing?.name || '未命名情境',
      activePersonaId: this.settings.activePersonaId,
      activeWorldId: this.settings.activeWorldId,
      desktopCharacters: this.settings.ui.desktopCharacters.map((d) => ({ ...d })),
      lastActiveConversationId: this.activeConversation?.id,
      colorTheme: this.settings.ui.colorTheme,
      newsKeywordGroupId: existing?.newsKeywordGroupId,
      lorebookIds: existing?.lorebookIds,
      moduleOverrides: existing?.moduleOverrides,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }
    await this.saveScene(next)
    if (!id) await this.applyScene(next.id)
    return this.scenes.find((s) => s.id === next.id) ?? next
  }

  async saveScene(preset: ScenePreset): Promise<void> {
    const now = Date.now()
    const existing = this.scenes.find((s) => s.id === preset.id)
    const next: ScenePreset = {
      ...preset,
      id: preset.id || newId(),
      name: preset.name.trim() || existing?.name || '未命名情境',
      // 新建的情境以目前狀態當快照 —— 手機沒有視窗座標可存，那兩個欄位留空。
      desktopCharacters:
        preset.desktopCharacters ?? this.settings.ui.desktopCharacters.map((d) => ({ ...d })),
      createdAt: existing?.createdAt ?? preset.createdAt ?? now,
      updatedAt: now
    }
    const idx = this.scenes.findIndex((s) => s.id === next.id)
    if (idx >= 0) this.scenes[idx] = next
    else this.scenes.push(next)
    await this.adapters.storage.writeJson(keys.sceneKey(next.id), next)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async removeScene(id: string): Promise<void> {
    if (!this.scenes.some((s) => s.id === id)) throw new DataError('not-found', id)
    this.scenes = this.scenes.filter((s) => s.id !== id)
    await this.adapters.storage.remove(keys.sceneKey(id))
    // 刪掉正在用的那組只是「不再跟著任何情境」，身分／世界觀維持現狀不動。
    if (this.settings.activeSceneId === id) {
      this.settings.activeSceneId = undefined
      await this.saveSettings()
    }
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  /**
   * 刪身分設定組。**最後一組不給刪**（與桌面 `removePersonaPresetDirect` 同一條規則）：
   * 一組都沒有的話 prompt 組不出使用者是誰，畫面也沒有地方能新增回來。
   */
  async removePersona(id: string): Promise<void> {
    if (!this.personas.some((p) => p.id === id)) throw new DataError('not-found', id)
    if (this.personas.length <= 1) throw new DataError('conflict', 'last-preset')
    this.personas = this.personas.filter((p) => p.id !== id)
    await this.adapters.storage.remove(keys.personaKey(id))
    if (this.settings.activePersonaId === id) {
      this.settings.activePersonaId = this.personas[0]?.id ?? ''
      await this.saveSettings()
    }
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async removeWorld(id: string): Promise<void> {
    if (!this.worlds.some((w) => w.id === id)) throw new DataError('not-found', id)
    if (this.worlds.length <= 1) throw new DataError('conflict', 'last-preset')
    this.worlds = this.worlds.filter((w) => w.id !== id)
    await this.adapters.storage.remove(keys.worldKey(id))
    if (this.settings.activeWorldId === id) {
      this.settings.activeWorldId = this.worlds[0]?.id ?? ''
      await this.saveSettings()
    }
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  llmSnapshot(): LlmSettingsSnapshot {
    const providers = ['openai', 'claude', 'gemini', 'grok'] as const
    const hasApiKey = {} as LlmSettingsSnapshot['hasApiKey']
    for (const p of providers) {
      hasApiKey[p] = !!this.settings.llm.apiKeys[p]?.trim()
    }
    const provider = this.settings.llm.provider
    const utilityProvider = this.settings.llm.utilityProvider ?? provider
    return {
      provider,
      /*
       * **不可以 fallback 到 `llm.model`。** 那是早期只有 OpenAI 時的單一欄位，
       * 跨供應商拿來墊會把 OpenAI 型號顯示在 Claude／Gemini 的清單頂端
       * （選單會把「不在本家目錄的目前值」保留成一個選項）。
       */
      model: this.settings.llm.models?.[provider] || '',
      models: { ...(this.settings.llm.models ?? {}) },
      endpoint: this.settings.llm.endpoint,
      hasApiKey,
      maxResponseTokens: this.settings.llm.maxResponseTokens ?? 360,
      maxGroupRounds: this.settings.llm.maxGroupRounds ?? 3,
      maxImagesPerMessage: this.settings.llm.maxImagesPerMessage ?? 5,
      utilityEnabled: !!this.settings.llm.utilityEnabled,
      utilityProvider,
      utilityModel: this.settings.llm.utilityModels?.[utilityProvider] || '',
      utilityModels: { ...(this.settings.llm.utilityModels ?? {}) }
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

  // ── 天氣 ──────────────────────────────────────────────
  //
  // 設定的讀寫在 `LocalDataSource`（純欄位搬運）；這裡只放需要打外部服務的三支。

  private ensureWeather(): NonNullable<AppSettings['weather']> {
    this.settings.weather ??= {
      enabled: false,
      polish: false,
      locationName: '',
      latitude: 0,
      longitude: 0,
      locationSource: ''
    }
    return this.settings.weather
  }

  /** 定位並寫進設定。GPS 優先、退回 IP，詳見 `runtime/weather.ts`。 */
  async detectWeatherLocation(): Promise<void> {
    const hit = await detectMobileLocation({ http: this.adapters.http })
    if (!hit) {
      throw new DataError('unknown', '定位失敗。請確認已開啟定位權限，或手動輸入城市名稱。')
    }
    const w = this.ensureWeather()
    w.locationName = hit.name
    w.latitude = hit.lat
    w.longitude = hit.lon
    w.locationSource = hit.source
    // 使用者特地按了定位，顯然是想用天氣
    if (!w.enabled) w.enabled = true
    invalidateWeatherCache()
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async geocodeWeatherLocation(name: string): Promise<void> {
    const q = name.trim()
    if (!q) throw new DataError('invalid-input', '請輸入城市名稱')
    const hit = await geocodeCity({ http: this.adapters.http }, q)
    if (!hit) throw new DataError('not-found', '找不到城市，請換個關鍵字')
    const w = this.ensureWeather()
    w.locationName = hit.name
    w.latitude = hit.lat
    w.longitude = hit.lon
    w.locationSource = 'manual'
    if (!w.enabled) w.enabled = true
    invalidateWeatherCache()
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  /** 立即抓一次天氣給 UI 顯示。**繞過快取**——使用者按「立即更新」就是不信任舊值。 */
  async fetchWeatherNow(): Promise<WeatherData> {
    const w = this.settings.weather
    if (!w?.locationName || !w.latitude || !w.longitude) {
      throw new DataError('invalid-input', '尚未設定位置')
    }
    invalidateWeatherCache()
    const data = await fetchWeather({ http: this.adapters.http }, w.latitude, w.longitude, w.locationName)
    if (!data) throw new DataError('unknown', '天氣更新失敗')
    return data
  }

  async sendMessage(input: SendMessageInput): Promise<void> {
    // 同時間只允許一則進行中的生成（對齊桌面 activeSendAbort）
    if (this.sendInFlight) await this.sendInFlight.catch(() => undefined)

    const abort = new AbortController()
    this.sendAbort = abort
    this.sendDraft = { content: input.content, images: input.images }
    this.sendInFlight = sendStandaloneMessage({
      adapters: this.adapters,
      events: this.events,
      settings: this.settings,
      characters: this.characters,
      getActiveConversation: () => this.activeConversation,
      saveConversation: (c) => this.saveConversation(c),
      getPersona: () => this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null,
      getWorld: () => this.worlds.find((w) => w.id === this.settings.activeWorldId) ?? null,
      getActiveScene: () => this.scenes.find((s) => s.id === this.settings.activeSceneId) ?? null,
      loadLorebook: (id) => this.getLorebook(id),
      input,
      signal: abort.signal
    }).finally(() => {
      if (this.sendAbort === abort) {
        this.sendAbort = null
        this.sendDraft = null
        this.sendInFlight = null
      }
    })
    await this.sendInFlight
  }

  async stopGenerating(): Promise<StopGeneratingResult> {
    if (this.sendAbort) {
      const draft = this.sendDraft
      this.sendAbort.abort()
      try {
        await this.sendInFlight
      } catch {
        // 中止路徑不往上拋；草稿仍還給 UI
      }
      return draft ? { content: draft.content, images: draft.images } : { content: '' }
    }
    if (this.speakAbort) {
      this.speakAbort.abort()
      try {
        await this.speakInFlight
      } catch {
        // 中止路徑不往上拋
      }
      // 「說點什麼」沒有使用者訊息可撤回，草稿留 null 讓輸入框維持原樣
      return null
    }
    return null
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

  /**
   * 取這則訊息保留的完整 prompt（除錯用）。
   *
   * 找不到訊息、或訊息的 prompt 已被 `prune` 剝掉，都回 `null` 而不是丟錯 ——
   * 「太舊所以沒留」是正常結果，不是失敗，UI 顯示對應說明就好。
   */
  getMessageDebug(messageId: string): MessageDebug | null {
    const msg = this.activeConversation?.messages.find((m) => m.id === messageId)
    if (!msg) return null
    return {
      debugPrompt: msg.debugPrompt ?? null,
      utilityDebugPrompt: msg.utilityDebugPrompt ?? null,
      convSearchDebugPrompt: msg.convSearchDebugPrompt ?? null,
      newsDebug: msg.newsDebug ?? null
    }
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
    /*
     * **截斷後一定要先通知 UI。** `sendMessage` 之後只會 push 新增的那幾則，
     * 沒有任何事件代表「這些舊訊息被砍了」——少了這行，畫面會停在舊清單，
     * 新回覆接在後面，要重開 app 才看得到正確結果（owner 2026-08-08 回報）。
     *
     * 順序安全：`getState()` 是記憶體快照，會在 `sendMessage` 開始寫檔前就解析完，
     * 不會反過來蓋掉接著送出的新訊息。
     */
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
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
    const d = this.settings.ui.desktopCharacters.find((x) => x.characterId === id)
    if (!d) throw new DataError('not-found', id)
    // 同時間只允許一個進行中的生成（對齊 sendMessage 的 sendInFlight 序列化）
    if (this.speakInFlight) await this.speakInFlight.catch(() => undefined)

    const abort = new AbortController()
    this.speakAbort = abort
    this.speakInFlight = forceSpeakStandalone({
      adapters: this.adapters,
      events: this.events,
      settings: this.settings,
      characters: this.characters,
      getActiveConversation: () => this.activeConversation,
      saveConversation: (c) => this.saveConversation(c),
      getPersona: () => this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null,
      getWorld: () => this.worlds.find((w) => w.id === this.settings.activeWorldId) ?? null,
      getActiveScene: () => this.scenes.find((s) => s.id === this.settings.activeSceneId) ?? null,
      loadLorebook: (id) => this.getLorebook(id),
      characterId: id,
      signal: abort.signal
    }).finally(() => {
      if (this.speakAbort === abort) {
        this.speakAbort = null
        this.speakInFlight = null
      }
    })
    await this.speakInFlight
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
    // 副檔名來自呼叫端，只收白名單（storage key 檢查擋得掉 `..`，但別讓怪東西落地）
    const raw = (image.ext.startsWith('.') ? image.ext : `.${image.ext}`).toLowerCase()
    const ext = ALLOWED_AVATAR_EXT.includes(raw) ? raw : '.png'
    const path = `${keys.characterDirKey(id)}/avatar-${Date.now()}${ext}`
    await this.adapters.storage.writeBinary(path, image.bytes)
    const char = this.characters.find((c) => c.id === id)!
    char.avatar = path
    char.updatedAt = Date.now()
    await this.adapters.storage.writeJson(keys.characterCardKey(id), char)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return path
  }

  // ── 用語解說（Lorebook，缺口 #2）────────────────────────
  // 桌面對應 `ipcHandlers.ts` 的 `*LorebookDirect`，邏輯只有一份（規格見
  // docs/future-lorebook.md）。清單不快取——本數不多，逐檔讀成本可忽略，
  // 也省得再維護一份陣列跟角色／設定組的更新事件對帳。

  async listLorebooks(): Promise<{ id: string; name: string }[]> {
    const listed = await this.adapters.storage.list(keys.LOREBOOKS_DIR)
    const out: { id: string; name: string }[] = []
    for (const entry of listed) {
      const name = entry.split('/').pop() ?? ''
      const id = keys.idFromJsonName(name)
      if (!id) continue
      const book = await this.getLorebook(id)
      if (book) out.push({ id: book.id, name: book.name })
    }
    return out
  }

  async getLorebook(id: string): Promise<Lorebook | null> {
    const raw = await this.adapters.storage.readJson<Lorebook>(keys.lorebookKey(id))
    if (!raw) return null
    try {
      return normalizeLorebook(raw)
    } catch {
      return null
    }
  }

  async createLorebook(name?: string): Promise<Lorebook> {
    const now = Date.now()
    const book: Lorebook = {
      id: newId(),
      name: (name ?? '').trim() || '用語解說',
      entries: [],
      scan_depth: DEFAULT_SCAN_DEPTH,
      token_budget: DEFAULT_TOKEN_BUDGET,
      createdAt: now,
      updatedAt: now
    }
    await this.adapters.storage.writeJson(keys.lorebookKey(book.id), book)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return book
  }

  async saveLorebook(incoming: Lorebook): Promise<Lorebook> {
    if (!incoming?.id) throw new DataError('invalid-input', 'lorebook.id')
    const book: Lorebook = { ...incoming, updatedAt: Date.now() }
    await this.adapters.storage.writeJson(keys.lorebookKey(book.id), book)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return book
  }

  /** 刪本體，並清掉角色卡／世界觀／情境上指向它的參照（比照桌面 `removeLorebookDirect`）。 */
  async removeLorebook(id: string): Promise<void> {
    await this.adapters.storage.remove(keys.lorebookKey(id))

    for (const c of this.characters) {
      if (c.lorebookIds?.includes(id)) {
        c.lorebookIds = c.lorebookIds.filter((x) => x !== id)
        await this.adapters.storage.writeJson(keys.characterCardKey(c.id), c)
      }
    }
    for (const w of this.worlds) {
      if (w.lorebookIds?.includes(id)) {
        w.lorebookIds = w.lorebookIds.filter((x) => x !== id)
        w.updatedAt = Date.now()
        await this.adapters.storage.writeJson(keys.worldKey(w.id), w)
      }
    }
    for (const s of this.scenes) {
      if (s.lorebookIds?.includes(id)) {
        s.lorebookIds = s.lorebookIds.filter((x) => x !== id)
        s.updatedAt = Date.now()
        await this.adapters.storage.writeJson(keys.sceneKey(s.id), s)
      }
    }
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  /**
   * 從角色卡生成一條用語並加進指定的書（規格 §8）。桌面對應
   * `ipcHandlers.ts` 的 `lorebook:generate-entry`，邏輯共用 `core/lore/generate.ts`，
   * 這裡只是換一個 `LLMDeps`（獨立版用自己的 `adapters.http`，不是桌面的 Node fetch）。
   *
   * 找不到角色／書是程式錯誤（呼叫端傳錯 id），照其他方法的慣例丟 `DataError`。
   * **生成本身失敗（無 API Key／逾時／模型吐空）是常見的預期情況**，走
   * `{ ok: false, error }` 而不是丟例外——比照 `NewsFetchResult` 的理由。
   */
  async generateLoreEntry(characterId: string, lorebookId: string): Promise<LoreGenerateResult> {
    const char = this.characters.find((c) => c.id === characterId)
    if (!char) throw new DataError('not-found', characterId)
    const book = await this.getLorebook(lorebookId)
    if (!book) throw new DataError('not-found', lorebookId)

    let generated: Awaited<ReturnType<typeof generateLoreEntryForCharacter>>
    try {
      generated = await generateLoreEntryForCharacter(
        {
          settings: this.settings,
          character: {
            name: char.name,
            nicknames: char.nicknames,
            description: char.description,
            personality: char.personality,
            scenario: char.scenario
          }
        },
        { http: this.adapters.http }
      )
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!generated) return { ok: false, error: '生成失敗，請確認 API Key 與模型設定' }

    const entry: LoreEntry = { id: newId(), insertion_order: book.entries.length, ...generated }
    await this.saveLorebook({ ...book, entries: [...book.entries, entry] })
    return { ok: true, entry }
  }

  private async reloadReminders(): Promise<void> {
    try {
      const data = await this.adapters.storage.readJson(keys.REMINDERS_KEY)
      this.reminders = Array.isArray(data) ? data : []
    } catch {
      this.reminders = []
    }
  }

  async listReminders(): Promise<Reminder[]> {
    return this.reminders
  }

  async createReminder(): Promise<Reminder> {
    const now = Date.now()
    const reminder: Reminder = {
      id: newId(),
      label: '新提醒',
      prompt: '',
      schedule: { type: 'daily', hour: 8, minute: 0 },
      enabled: true,
      notificationDevice: 'mobile',
      createdAt: now
    }
    return reminder
  }

  async saveReminder(reminder: Reminder): Promise<Reminder> {
    if (!reminder?.id) throw new DataError('invalid-input', 'reminder.id')
    const idx = this.reminders.findIndex((r) => r.id === reminder.id)
    const saved = { ...reminder, updatedAt: Date.now() }
    if (idx >= 0) {
      this.reminders[idx] = saved
    } else {
      this.reminders.push(saved)
    }
    await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
    updateReminders(this.reminders)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return saved
  }

  async removeReminder(id: string): Promise<void> {
    this.reminders = this.reminders.filter((r) => r.id !== id)
    await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
    updateReminders(this.reminders)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async toggleReminder(id: string, enabled: boolean): Promise<void> {
    const reminder = this.reminders.find((r) => r.id === id)
    if (reminder) {
      reminder.enabled = enabled
      await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
      updateReminders(this.reminders)
      this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    }
  }

  private async recordReminderTriggered(reminder: Reminder): Promise<void> {
    const idx = this.reminders.findIndex((r) => r.id === reminder.id)
    if (idx >= 0) {
      this.reminders[idx].lastTriggeredAt = Date.now()
      await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
    }
  }

  /**
   * 提醒觸發 → 角色發話。訊息會進目前的對話，回傳講出來的內容給排程器當通知文案。
   * 詳見 `reminderSpeak.ts`：提醒是「角色來提醒你」，不是行事曆通知。
   */
  private speakReminder(reminder: Reminder): Promise<ReminderSpeakResult | null> {
    return speakStandaloneReminder({
      adapters: this.adapters,
      events: this.events,
      settings: this.settings,
      characters: this.characters,
      getActiveConversation: () => this.activeConversation,
      saveConversation: (c) => this.saveConversation(c),
      getPersona: () => this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null,
      getWorld: () => this.worlds.find((w) => w.id === this.settings.activeWorldId) ?? null,
      getActiveScene: () => this.scenes.find((s) => s.id === this.settings.activeSceneId) ?? null,
      loadLorebook: (id) => this.getLorebook(id),
      reminder
    })
  }
}

/** 給測試／App 用的啟動入口。 */
export async function bootStandaloneSession(
  adapters: PlatformAdapters,
  opts: BootStandaloneOptions = {}
): Promise<StandaloneSession> {
  return StandaloneSession.boot(adapters, opts)
}
