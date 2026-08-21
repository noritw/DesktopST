import { SECRET_PREFIX, type PlatformAdapters } from '@core/adapters'
import { hydrateSettings, toPersistedSettings } from '@core/store/settings'
import { applySceneSettings } from '@core/scene/apply'
import { stampCharacterNames } from '@core/chat/characterName'
import { hasUsableApiKey } from '@core/prompt/promptUtils'
import { isActiveSceneDirty } from '@core/scene/dirty'
import * as keys from '@core/store/keys'
import type {
  AppSettings,
  Character,
  Conversation,
  PersonaPreset,
  Reminder,
  ReminderHistoryItem,
  WorldPreset,
  ScenePreset
} from '@core/types'
import {
  appendHistory,
  buildHistoryItem,
  normalizeHistory,
  removeHistoryItem,
  type ReminderHistoryDraft
} from '@core/reminder/history'
import { nextFireDelayMs } from '@core/reminder/nextFire'
import { decideReminderFire, occurrenceAlreadyHandled } from '@core/reminder/gate'
import {
  isCacheUsable,
  needsRefresh,
  normalizeCache,
  pruneCache,
  reminderFingerprint,
  type ReminderCache
} from '@core/reminder/cache'
import { DEFAULT_SETTINGS } from '@core/types'
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER } from '@core/llm/modelCatalog'
import { testLLMConnection } from '@core/llm'
import { DataError } from '@core/data'
import type {
  AppStateSnapshot,
  LlmProvider,
  LlmSettingsSnapshot,
  LoreGenerateResult,
  MessageDebug,
  ModuleToggle,
  PackConflictPolicy,
  SendMessageInput,
  StopGeneratingResult
} from '@core/data'
import { extractCharaJson, embedCharaJson, MINIMAL_TRANSPARENT_PNG_BASE64, PngCardError } from '@core/card/pngCard'
import { importStJson, exportToStJson } from '@core/card/stCardMapper'
import {
  DEFAULT_SCAN_DEPTH,
  DEFAULT_TOKEN_BUDGET,
  generateLoreEntryForCharacter,
  normalizeLorebook,
  type Lorebook,
  type LoreEntry
} from '@core/lore'
import { bytesToBase64, base64ToBytes } from '@core/util/base64'
import type { CardFile } from '@core/data'
import JSZip from 'jszip'
import { fetchWeather, geocodeCity, invalidateWeatherCache, type WeatherData } from '@core/weather'
import * as newsReaderState from '@core/news/readerState'
import type { NewsReaderState } from '@core/news/readerState'
import * as newsReaderFetch from '@core/news/readerFetch'
import { loadNewsModuleSettings, saveNewsModuleSettings, applyNewsFeedbackDelta } from '@core/news/settings'
import { getNewsSchedulerState, applyNewsSchedulerToReminders } from '@core/news/schedule'
import * as newsEnrich from '@core/news/enrich'
import type { NewsItem } from '@core/news/types'
import type { NewsReaderSnapshot, NewsEditableSettings, NewsScheduleSnapshot } from '@core/data'
import { domRssParser } from '../adapters/rssParseAdapter'
import { LocalEventSource } from '../events/localEventSource'
import { detectMobileLocation } from './weather'
import { newId } from './id'
import { toConversationSnapshot } from './messages'
import { buildConversationManifestEntry } from '@core/sync/manifestBuild'
import type { ManifestConversation } from '@core/sync/types'
import {
  blankCharacter,
  importCharactersFromDstPack,
  seedDefaultCharactersIfEmpty,
  seedDefaultPresetsIfEmpty
} from './seedDefaults'
import { forceSpeakStandalone, sendStandaloneMessage } from './chat'
import { listSummarizableMessages, summarizeConversation } from '@core/llm/summarizer'
import { speakStandaloneReminder, type ReminderSpeakResult } from './reminderSpeak'
import {
  initReminderScheduler,
  updateReminders,
  stopReminderScheduler,
  flushDeferredReminders,
  rearmNativeAlarms
} from './reminderScheduler'

const MODULE_DEFS: ModuleToggle[] = [
  { id: 'desktopst.weather', label: '天氣', enabled: false },
  { id: 'desktopst.news', label: '個人新聞報', enabled: false },
  { id: 'desktopst.spotify', label: 'Spotify 音樂偵測', enabled: false },
  { id: 'desktopst.calendar', label: 'Google 日曆', enabled: false }
]

const ALLOWED_AVATAR_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp']

/** storage key → 相對於角色資料夾的路徑，配 `exportPack` 寫進 `.dstpack` 用。 */
function relativeToCharacterDir(dirKey: string, key: string): string {
  const norm = key.replace(/\\/g, '/')
  return norm.startsWith(`${dirKey}/`) ? norm.slice(dirKey.length + 1) : (norm.split('/').pop() ?? norm)
}

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
  /**
   * headless 模式（提醒到點時由原生起的隱藏 WebView）。
   *
   * 這一趟只為了生一句話就結束，所以**不要啟動提醒排程器**——
   * 那會在背景排一堆 setTimeout、還會去要通知權限（headless 沒有
   * Capacitor Bridge，要不到），純屬浪費而且會拖慢啟動。
   * 通知由原生發，下一輪排程等使用者下次打開 App 時再算。
   */
  headless?: boolean
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
  reminderHistory: ReminderHistoryItem[] = []
  /** 每則提醒最近一次生成的台詞；只在現場生成失敗時當底線 */
  private reminderCache: ReminderCache = {}
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
    await this.reloadReminderHistory()
    await this.reloadReminderCache()

    // 啟動提醒排程器：觸發時讓角色用自己的口吻把提醒講出來
    // （headless 那一趟不需要——見 BootStandaloneOptions.headless）
    if (opts.headless) return
    await initReminderScheduler(
      async (reminder) => {
        await this.recordReminderTriggered(reminder)
        return this.speakReminder(reminder)
      },
      {
        getActiveSceneId: () => this.settings.activeSceneId ?? null,
        getCachedSpeech: (id) => {
          const c = this.reminderCache[id]
          return isCacheUsable(c) ? { title: c.characterName, body: c.text } : null
        },
        occurrenceHandled: async (id, fireAtMs) => {
          /*
           * 一定要**重讀磁碟**。背景那條（headless）跑完會把 lastTriggeredAt
           * 寫進 reminders.json，但前景記憶體裡的還是舊的——
           * 拿記憶體比對等於沒比對。檔案很小，這個成本可以接受。
           */
          const list = await this.adapters.storage.readJson<Reminder[]>(keys.REMINDERS_KEY)
          const fresh = Array.isArray(list) ? list.find((r) => r.id === id) : undefined
          return occurrenceAlreadyHandled(fresh?.lastTriggeredAt, fireAtMs)
        },
        lastFailureReason: () => this.lastSpeakFailure,
        recordHistory: (reminder, draft) => {
          void this.appendReminderHistory(reminder, draft)
        }
      }
    )
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
    await this.preserveEncryptedSecrets(persisted)
    await this.adapters.storage.writeJson(keys.SETTINGS_KEY, persisted)
  }

  /**
   * **金鑰保險絲：secrets 還沒解封時，絕對不可以把磁碟上的密文蓋掉。**
   *
   * 血淋淋的教訓（2026-08-13，owner 回報「獨立版的 API Key 不見了」）：
   * `initCapacitorSecrets()` 沒被呼叫時 `capacitorSecrets` 會退化成
   * `unavailableSecrets`，它的 `decrypt()` 原封不動回傳 `enc:v1:…` 密文。
   * `hydrateSettings()` 看到解出來的東西還是密文，就依既有規則把記憶體裡那把
   * 金鑰設成 `''`（本意是「別讓使用者看到亂碼、以為要自己清掉」）。
   * 這時只要有任何人呼叫 `saveSettings()`，`encrypt('')` 又原封不動回傳 `''`，
   * **磁碟上的密文就被空字串覆蓋、永久消失**。
   *
   * 真正踩到的路徑：`ModeSwitcher` 在遙控模式下臨時 boot 一份 standalone
   * session（那時整個 app 從沒初始化過 secrets，因為 `App.tsx` 只在獨立模式
   * 分支呼叫），接著 S2 M3 的「從電腦帶回資料」跑 `runSyncImport()` →
   * `session.saveSettings()` → 金鑰歸零。呼叫端當然要補上初始化（已補），
   * 但**那是第二道防線**：這種「安靜地毀掉使用者資料」的失敗，不能只靠
   * 每個呼叫端都記得先做某件事。
   *
   * 只在「secrets 不可用 ＋ 磁碟上是密文 ＋ 準備寫入的是空字串」三者同時成立時
   * 才把舊值留著 —— secrets 正常時使用者真的要清空金鑰仍然清得掉。
   */
  private async preserveEncryptedSecrets(persisted: AppSettings): Promise<void> {
    if (this.adapters.secrets.isAvailable()) return
    const onDisk = await this.adapters.storage.readJson<AppSettings>(keys.SETTINGS_KEY)
    if (!onDisk) return

    const keepEncrypted = (next: string | undefined, old: string | undefined): string | undefined =>
      !next?.trim() && old?.startsWith(SECRET_PREFIX) ? old : next

    for (const [provider, old] of Object.entries(onDisk.llm?.apiKeys ?? {})) {
      const kept = keepEncrypted(persisted.llm.apiKeys[provider], old)
      if (kept !== undefined) persisted.llm.apiKeys[provider] = kept
    }

    const oldCwa = onDisk.weather?.realtimeQuery?.cwaApiKey
    const rq = persisted.weather?.realtimeQuery
    if (rq) {
      const kept = keepEncrypted(rq.cwaApiKey, oldCwa)
      if (kept !== undefined) rq.cwaApiKey = kept
    }
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
    // 優先還原上次關 app 時的對話（`lastActiveConversationId` 在每次切換時都會存進 settings）。
    // 純按 `updatedAt` 選的話，關 app 前切到日常情境、但 TRPG 對話 updatedAt 較新，
    // 重開後 active 就跑回 TRPG——startup 提醒若在 3 秒後觸發，訊息會說進錯的對話（owner 2026-08-10）。
    const lastId = this.settings.ui.lastActiveConversationId
    this.activeConversation =
      (lastId ? this.conversationIndex.get(lastId) : null) ?? newest
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
    // 存檔時補上角色名字快照，與桌面 `fileStore.saveConversation` 同一份邏輯
    // （理由見 `Message.characterName` 的註解：角色 id 會因為同步而斷掉）。
    stampCharacterNames(conv, this.characters)
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

  /**
   * 「連線」按鈕：獨立版直接對端點打 `GET /v1/models`（走 `adapters.http`，
   * 不是桌面的 Node fetch）。local 供應商沒有寫死的型號目錄，這是唯一能拿到
   * 型號清單的管道，見 `docs/local-llm-provider-plan.md` §3.5。
   */
  async testLlmConnection(provider: LlmProvider, endpoint?: string): Promise<{ ok: true; models?: string[] } | { ok: false; error: string }> {
    const apiKey = this.settings.llm.apiKeys?.[provider]?.trim() || ''
    const r = await testLLMConnection(
      {
        provider,
        apiKey,
        apiKeys: this.settings.llm.apiKeys,
        endpoint: endpoint?.trim() || this.settings.llm.endpoints?.[provider] || (provider === this.settings.llm.provider ? this.settings.llm.endpoint : undefined)
      },
      { http: this.adapters.http }
    )
    if (!r.ok) {
      const errorText = r.error || (r.errorCode === 'no-api-key' ? '尚未填寫 API Key' : r.errorCode === 'no-model' ? '尚未填寫模型名稱' : '連線失敗')
      return { ok: false, error: errorText }
    }
    return { ok: true, models: r.models }
  }

  llmSnapshot(): LlmSettingsSnapshot {
    const providers = ['openai', 'claude', 'gemini', 'grok', 'local'] as const
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
      // 攤平值取目前 provider 的端點（比照上面的 model）；舊的單一欄位只在
      // 設定檔尚未被遷移寫回時才有值，所以放在後備位置。
      endpoint: this.settings.llm.endpoints?.[provider] ?? this.settings.llm.endpoint,
      endpoints: { ...(this.settings.llm.endpoints ?? {}) },
      extraInstruction: this.settings.llm.extraInstruction ?? '',
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

  /**
   * ⚠️ **新聞的開關不在 `settings.json`，在模組自己的設定檔**
   * （`modules/desktopst.news/settings.json` 的 `enabled`），所以這支是 async。
   *
   * 之前這裡把新聞寫死成 `false`、`setModuleEnabled` 對新聞是空的 no-op，
   * 於是「打勾 → 切走再回來又變回沒開」——owner 2026-08-12 實機回報。
   */
  async listModules(): Promise<ModuleToggle[]> {
    const newsEnabled = (await loadNewsModuleSettings(this.adapters.storage)).enabled
    return MODULE_DEFS.map((m) => ({
      ...m,
      enabled:
        m.id === 'desktopst.weather'
          ? !!this.settings.weather?.enabled
          : m.id === 'desktopst.spotify'
            ? !!this.settings.spotify?.enabled
            : m.id === 'desktopst.calendar'
              ? !!this.settings.calendar?.enabled
              : m.id === 'desktopst.news'
                ? newsEnabled
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
        // 新聞的開關住在模組自己的設定檔，不是 settings.json（見 `listModules`）。
        await saveNewsModuleSettings(this.adapters.storage, { enabled })
        this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
        return
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

  /** 對話的輕量清單，多帶 `messageCount`。給 S2 M2 差異預覽用（見 `syncManifest.ts`）。 */
  /**
   * S2 比對用的對話清單。
   *
   * 欄位一律走 `buildConversationManifestEntry`，**不要在這裡手打物件**——
   * 電腦端 `getConversationsManifestDirect()` 算的是同一支，兩邊漂移的話
   * 比對畫面會把每一則都判成「不一樣」而且零錯誤訊息（`contentHash.ts`
   * 與 `settingsSnapshot.ts` 都踩過這個坑）。
   *
   * `importedFrom.sourceId` 要一起帶出去當 `linkedRemoteId`：那是 S1 匯入
   * 進來的對話唯一的身分線索，漏掉的話每則都會被判成「手機獨有」再推一份
   * 回電腦（見 `core/sync/convPair.ts`）。
   */
  listConversationsManifest(): ManifestConversation[] {
    return [...this.conversationIndex.values()].map((c) =>
      buildConversationManifestEntry(c, c.importedFrom?.sourceId)
    )
  }

  /**
   * S2 對話同步：取一整則對話（含訊息）。合併時要拿它算「對面缺哪些」。
   */
  getConversation(id: string): Conversation | null {
    return this.conversationIndex.get(id) ?? null
  }

  /**
   * S2 對話同步：記住「這則對話在電腦上是哪一則」。
   *
   * ⚠️ **推送完一定要呼叫這支。** 電腦端新建對話時會自己發 uuid，手機不記
   * 回來的話下一趟配不起來，每次切換都多推一份 —— S2 M3 就是死在這裡
   * （`docs/mobile-sync-m4-compare.md` §1.1）。
   *
   * 沿用 S1 的 `importedFrom` 欄位而不是另開一個：兩者記的是同一件事
   * （「這則對話對應到電腦上的哪一則」），分成兩份只會讓配對邏輯要查兩個
   * 地方，而且遲早不同步。
   */
  async linkConversationToRemote(localId: string, remoteId: string, sourceUpdatedAt: number): Promise<void> {
    const conv = this.conversationIndex.get(localId)
    if (!conv) return
    conv.importedFrom = {
      sourceId: remoteId,
      sourceUpdatedAt,
      importedAt: conv.importedFrom?.importedAt ?? Date.now()
    }
    await this.saveConversation(conv)
  }

  async loadConversation(id: string): Promise<void> {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    this.activeConversation = conv
    // 切對話時同步更新當前場景記的 lastActiveConversationId，
    // 否則場景的 dirty 判定會一直顯示「修改過」（owner 2026-08-10）。
    await this.updateActiveSceneConversation()
    // 也要寫進 settings，否則重啟後 reloadConversations 讀不到正確的 id
    // （owner 2026-08-10：開啟提醒一直跳到最後有更新的對話）。
    this.settings.ui.lastActiveConversationId = conv.id
    await this.saveSettings()
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  /**
   * 把當前對話 id 寫進使用中的場景。
   * `applyScene` 只會在「切走時」更新之前那個場景，
   * 所以場景內切對話時得自己寫回去，不然場景會一直 dirty。
   */
  private async updateActiveSceneConversation(): Promise<void> {
    const sceneId = this.settings.activeSceneId
    if (!sceneId || !this.activeConversation) return
    const scene = this.scenes.find((s) => s.id === sceneId)
    if (!scene) return
    scene.lastActiveConversationId = this.activeConversation.id
    scene.updatedAt = Date.now()
    await this.adapters.storage.writeJson(keys.sceneKey(scene.id), scene)
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
    await this.updateActiveSceneConversation()
    this.settings.ui.lastActiveConversationId = conv.id
    await this.saveSettings()
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

  /** 記憶摘要（清單 A11）：依 id 操作任一對話，不限「目前使用中」那個。 */
  async getConversationMemory(id: string): Promise<{ summary: string; coversTs: number; coveredCount: number }> {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    const coversTs = conv.summaryCoversTs ?? 0
    return {
      summary: conv.summary ?? '',
      coversTs,
      coveredCount: coversTs ? conv.messages.filter((m) => m.timestamp <= coversTs).length : 0
    }
  }

  async summarizeConversationNow(
    id: string
  ): Promise<{ ok: boolean; noNew?: boolean; error?: string; summary?: string; coveredCount?: number }> {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    if (!hasUsableApiKey(this.settings)) {
      return { ok: false, error: '尚未設定 API Key' }
    }
    if (listSummarizableMessages(conv, this.settings.memory.keepRecentN).length === 0) {
      return { ok: true, noNew: true }
    }
    try {
      const result = await summarizeConversation(
        {
          settings: this.settings,
          conv,
          persona: this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null,
          speakerNameById: Object.fromEntries(this.characters.map((c) => [c.id, c.name]))
        },
        { http: this.adapters.http }
      )
      if (!result) return { ok: true, noNew: true }
      conv.summary = result.summary
      conv.summaryCoversTs = result.coversTs
      conv.updatedAt = Date.now()
      await this.saveConversation(conv)
      this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
      const coversTs = conv.summaryCoversTs ?? 0
      return {
        ok: true,
        summary: conv.summary,
        coveredCount: coversTs ? conv.messages.filter((m) => m.timestamp <= coversTs).length : 0
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  async updateConversationSummary(id: string, summary: string): Promise<void> {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    conv.summary = String(summary ?? '').trim()
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async clearConversationSummary(id: string): Promise<void> {
    const conv = this.conversationIndex.get(id)
    if (!conv) throw new DataError('not-found', id)
    conv.summary = ''
    conv.summaryCoversTs = undefined
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
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

  /**
   * 匯出單張角色卡（缺口 #3）。PNG 走 `char.avatar` 當底圖，沒有頭像就用
   * `core/card/pngCard.ts` 內建的 1×1 透明佔位——桌面版遇到同樣情況是讀
   * `assets/icon.png`，手機沒有 app 安裝目錄可讀，佔位圖是最貼近的替代。
   */
  async exportCard(id: string, kind: 'png' | 'json'): Promise<CardFile> {
    const char = this.characters.find((c) => c.id === id)
    if (!char) throw new DataError('not-found', id)
    const safeName = char.name?.trim() || 'character'
    const jsonStr = exportToStJson(char)

    if (kind === 'json') {
      return { bytes: new TextEncoder().encode(jsonStr), filename: `${safeName}.json` }
    }

    const baseBytes =
      (char.avatar ? await this.adapters.storage.readBinary(char.avatar) : null) ??
      base64ToBytes(MINIMAL_TRANSPARENT_PNG_BASE64)
    try {
      const out = embedCharaJson(baseBytes, jsonStr)
      return { bytes: out, filename: `${safeName}.png` }
    } catch (e) {
      throw new DataError('invalid-input', e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * 打包 `.dstpack`（缺口 #3）。格式與桌面 `dstPack.ts` 完全相容——manifest／
   * `characters/<id>/card.json`／`lorebooks/<id>.json` 佈局一致，桌面能直接匯入。
   *
   * 手機儲存 key 本來就是「相對於角色資料夾」的路徑（`characters/<id>/avatar.png`），
   * 跟桌面 `dstPack.ts` 把絕對路徑轉相對路徑那步是同一件事，只是手機不必轉換。
   */
  /**
   * `remapLorebookIds`（S2 M4）：把卡片上的 `lorebookIds` 換成對方裝置上的 id。
   *
   * 用語解說在兩台機器上的 id 常常不同（同一本各自建過一次），照原樣送出去
   * 的話角色卡會掛著一串對面不存在的 id——解說不會注入，而且**完全不報錯**，
   * 只是角色對某些詞的反應莫名其妙消失。回傳 undefined 的就從清單裡拿掉。
   * 不傳這個參數時行為完全不變（桌面匯出、使用者手動匯出都走原路）。
   */
  async exportPack(
    ids: string[],
    opts: { includeGlobalSettings: boolean; includeLorebooks: boolean; remapLorebookIds?: (id: string) => string | undefined }
  ): Promise<CardFile> {
    const wanted = ids.length > 0 ? this.characters.filter((c) => ids.includes(c.id)) : this.characters
    if (wanted.length === 0) throw new DataError('invalid-input', 'no characters')

    const zip = new JSZip()
    const lorebookIds = new Set<string>()
    if (opts.includeLorebooks) {
      for (const c of wanted) for (const lid of c.lorebookIds ?? []) lorebookIds.add(lid)
    }

    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          format: 'desktopst-pack',
          version: 1,
          exportedAt: Date.now(),
          includeGlobalSettings: opts.includeGlobalSettings,
          characterIds: wanted.map((c) => c.id),
          includeLorebooks: lorebookIds.size > 0
        },
        null,
        2
      )
    )

    if (opts.includeGlobalSettings) {
      const persona = this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null
      const world = this.worlds.find((w) => w.id === this.settings.activeWorldId) ?? null
      zip.file(
        'global/settings.partial.json',
        JSON.stringify(
          {
            worldSetting: world?.worldSetting ?? '',
            interactionExample: world?.interactionExample ?? '',
            injectSystemTime: !!this.settings.injectSystemTime,
            persona: {
              displayName: persona?.displayName ?? '使用者',
              nickname: persona?.nickname ?? '主人',
              description: persona?.description ?? ''
            },
            personaName: persona?.name,
            worldName: world?.name
          },
          null,
          2
        )
      )
    }

    for (const lid of lorebookIds) {
      const book = await this.getLorebook(lid)
      if (book) zip.file(`lorebooks/${lid}.json`, JSON.stringify(book, null, 2))
    }

    for (const c of wanted) {
      const dirKey = keys.characterDirKey(c.id)
      const card: Character = { ...c }
      if (opts.remapLorebookIds && card.lorebookIds) {
        card.lorebookIds = card.lorebookIds
          .map((lid) => opts.remapLorebookIds!(lid))
          .filter((lid): lid is string => !!lid)
      }
      if (card.avatar) card.avatar = relativeToCharacterDir(dirKey, card.avatar)
      if (card.emotions) {
        const rel: Record<string, string> = {}
        for (const [k, v] of Object.entries(card.emotions)) rel[k] = relativeToCharacterDir(dirKey, v)
        card.emotions = rel
      }
      zip.file(`characters/${c.id}/card.json`, JSON.stringify(card, null, 2))

      for (const { relPath, bytes } of await this.collectCharacterFiles(dirKey)) {
        zip.file(`characters/${c.id}/${relPath}`, bytes)
      }
    }

    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
    const filename =
      wanted.length === 1
        ? `${wanted[0]!.name?.trim() || 'character'}.dstpack`
        : `DesktopST_${wanted.length}角色.dstpack`
    return { bytes, filename }
  }

  /** 遞迴列出角色資料夾底下的所有檔案（`card.json` 除外），配 `exportPack` 用。 */
  private async collectCharacterFiles(
    dirKey: string
  ): Promise<{ relPath: string; bytes: Uint8Array }[]> {
    const out: { relPath: string; bytes: Uint8Array }[] = []
    const walk = async (prefix: string): Promise<void> => {
      const entries = await this.adapters.storage.list(prefix)
      for (const entry of entries) {
        if (entry.endsWith('/card.json')) continue
        const bytes = await this.adapters.storage.readBinary(entry)
        if (bytes) out.push({ relPath: relativeToCharacterDir(dirKey, entry), bytes })
        else await walk(entry)
      }
    }
    await walk(dirKey)
    return out
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

  /**
   * 用語解說的輕量清單，多帶 `updatedAt`。給 S2 M2 差異預覽
   * （`syncManifest.ts` 的 `buildLocalManifest`）用——不改 `listLorebooks()`
   * 的既有形狀，因為那支給角色卡編輯器的綁定用，只期待 `{id,name}`。
   */
  async listLorebooksManifest(): Promise<{ id: string; name: string; updatedAt: number }[]> {
    const listed = await this.adapters.storage.list(keys.LOREBOOKS_DIR)
    const out: { id: string; name: string; updatedAt: number }[] = []
    for (const entry of listed) {
      const name = entry.split('/').pop() ?? ''
      const id = keys.idFromJsonName(name)
      if (!id) continue
      const book = await this.getLorebook(id)
      if (book) out.push({ id: book.id, name: book.name, updatedAt: book.updatedAt })
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

  // ── 個人新聞報：釘選／不看了（缺口 #6，B1 抽 core）────────────
  // 設定與抓取還在 pending（news-standalone-kickoff.md §4 步驟④／⑤），
  // 這裡先接「內容狀態」——跟桌面共用同一個 key 佈局。

  async getNewsReaderState(): Promise<NewsReaderState> {
    return newsReaderState.loadNewsReaderState(this.adapters.storage)
  }

  async saveNewsReaderPinned(items: unknown): Promise<NewsReaderState> {
    const next = await newsReaderState.saveNewsReaderPinned(this.adapters.storage, items)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return next
  }

  async saveNewsReaderDismissed(ids: unknown): Promise<NewsReaderState> {
    const next = await newsReaderState.saveNewsReaderDismissed(this.adapters.storage, ids)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return next
  }

  // ── 個人新聞報：抓取（缺口 #6，B1 抽 core，步驟④）───────────
  // RSS 解析用瀏覽器原生 DOMParser（`rss-parser` 在 WebView 下會炸，
  // 見 `core/news/rssAdapter.ts` 檔頭）。

  private get newsFetchDeps(): newsReaderFetch.ReaderFetchDeps {
    return { http: this.adapters.http, rss: domRssParser, storage: this.adapters.storage }
  }

  async getNewsReaderSnapshot(): Promise<NewsReaderSnapshot> {
    const settings = await loadNewsModuleSettings(this.adapters.storage)
    const state = await newsReaderState.loadNewsReaderState(this.adapters.storage)
    return {
      enabled: settings.enabled,
      sources: settings.sources,
      keywordGroups: settings.keywordGroups,
      readerKeywordGroupIds: settings.readerKeywordGroupIds ?? [],
      readerMaxItems: settings.readerMaxItems ?? 30,
      readerPerKeyword: settings.readerPerKeyword ?? 3,
      readerBreakoutQuota: settings.readerBreakoutQuota ?? 3,
      pinnedItems: state.pinnedItems,
      dismissedIds: state.dismissedIds
    }
  }

  async fetchNewsReaderBatch(req?: newsReaderFetch.ReaderBatchRequest): Promise<newsReaderFetch.ReaderFetchResult> {
    return newsReaderFetch.fetchReaderBatch(this.newsFetchDeps, req)
  }

  async fetchNewsReaderSection(req?: newsReaderFetch.ReaderSectionRequest): Promise<newsReaderFetch.ReaderFetchResult> {
    return newsReaderFetch.fetchReaderSection(this.newsFetchDeps, req)
  }

  async setNewsReaderQuota(sectionGroupId: string, quota: number): Promise<newsReaderFetch.ReaderFetchResult> {
    const result = await newsReaderFetch.setReaderQuota(this.newsFetchDeps, sectionGroupId, quota)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return result
  }

  async setNewsReaderSourceOrder(orderedSourceIds: string[]) {
    const sources = await newsReaderFetch.setReaderSourceOrder(this.newsFetchDeps, orderedSourceIds)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return sources
  }

  async setNewsReaderKeywordGroups(ids: string[]): Promise<void> {
    const cleaned = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id.length > 0) : []
    await saveNewsModuleSettings(this.adapters.storage, { readerKeywordGroupIds: cleaned })
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  /** 開原文的隱性回饋加分（清單 F9）。 */
  async markNewsOpened(sourceId: string): Promise<void> {
    if (!sourceId) return
    await applyNewsFeedbackDelta(this.adapters.storage, sourceId, 0.1)
  }

  // ── 個人新聞報：手機能改的設定（清單 6.1）─────────────────────
  // 刻意不是整份 NewsModuleSettings：語言處理、破圈、學習權重屬於桌面設定
  // 面板的深水區，手機上要的是「加個關鍵字、封鎖一個詞、加個 RSS」。

  async getNewsEditableSettings(): Promise<NewsEditableSettings> {
    const s = await loadNewsModuleSettings(this.adapters.storage)
    return { enabled: s.enabled, sources: s.sources, keywordGroups: s.keywordGroups, blacklist: s.blacklist, speakButton: s.speakButton }
  }

  async saveNewsEditableSettings(patch: Partial<Omit<NewsEditableSettings, 'enabled'>>): Promise<NewsEditableSettings> {
    const next = await saveNewsModuleSettings(this.adapters.storage, patch)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return { enabled: next.enabled, sources: next.sources, keywordGroups: next.keywordGroups, blacklist: next.blacklist, speakButton: next.speakButton }
  }

  // ── 個人新聞報：定時陪聊（與桌面設定面板同一份資料形狀，各自的提醒存檔流程）──
  // 比照桌面 scheduler.ts：在提醒清單裡塞一條特殊 Reminder；
  // 但獨立版走自己的原生精準鬧鐘，所以直接沿用 saveReminder 那條既有存檔＋
  // 重新註冊鬧鐘的路徑（`updateReminders`），不另造一套排程機制
  // （mobile-standalone-reminder-plan.md §2.1）。

  async getNewsSchedule(): Promise<NewsScheduleSnapshot> {
    const settings = await loadNewsModuleSettings(this.adapters.storage)
    return getNewsSchedulerState(this.reminders, settings)
  }

  async setNewsSchedule(next: NewsScheduleSnapshot): Promise<void> {
    this.reminders = applyNewsSchedulerToReminders(this.reminders, next)
    await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
    updateReminders(this.reminders)
    await saveNewsModuleSettings(this.adapters.storage, { reminder: { enabled: !!next?.enabled, schedule: next?.schedule } })
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  // ── 個人新聞報：進 Prompt 的上下文補強（缺口 #6，B1 抽 core，步驟⑥）───
  // 輔助模型設定沿用既有的 llm.utilityEnabled／utilityProvider／utilityModel，
  // 不另開一套（news-standalone-kickoff.md §5 點 5）。

  async enrichNewsForChat(item: NewsItem, forceRefresh?: boolean): Promise<{
    ok: boolean
    promptContext: string
    source?: string
    usedUtility?: boolean
    warning?: string
  }> {
    try {
      const enrich = await newsEnrich.enrichNewsForChat(
        { http: this.adapters.http, storage: this.adapters.storage },
        item,
        { forceRefresh: !!forceRefresh, appSettings: this.settings }
      )
      if (enrich.warning) console.warn('[news enrich]', item.id || item.title, enrich.warning)
      return { ok: true, promptContext: enrich.promptContext, source: enrich.source, usedUtility: enrich.usedUtility, warning: enrich.warning }
    } catch (e) {
      console.warn('[news enrich] failed', e)
      return {
        ok: true,
        promptContext: item.summary || '',
        source: 'rss-fallback',
        usedUtility: false,
        warning: e instanceof Error ? e.message : String(e)
      }
    }
  }

  /** 覆寫已送出訊息上的 promptContext（只影響後續延續話題）。 */
  async updateNewsPromptContext(messageId: string, promptContext: string): Promise<{ ok: boolean; error?: string }> {
    const pc = promptContext.trim()
    const conv = this.activeConversation
    if (!conv) return { ok: false, error: 'no-conversation' }
    const msg = conv.messages.find((m) => m.id === messageId)
    if (!msg?.newsLink) return { ok: false, error: 'no-news-link' }

    msg.newsLink = { ...msg.newsLink, promptContext: pc }
    conv.updatedAt = Date.now()
    await this.saveConversation(conv)
    if (msg.newsLink.id) newsEnrich.cacheManualPromptContext(msg.newsLink.id, pc)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    return { ok: true }
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
    /*
     * 提醒內容改了就**立刻丟掉舊快取**。
     *
     * 不能等下一次背景刷新——中間如果鬧鐘響了，發出去的會是上一版的台詞
     * （owner 2026-08-11：改成「再檢查一下功能」之後，跳出來的還是舊的「洗杯子」）。
     * 丟掉之後在重新生成之前寧可沒有離線底線，也不要拿錯的內容搪塞。
     */
    const cached = this.reminderCache[saved.id]
    if (cached && cached.fingerprint !== reminderFingerprint(saved)) {
      delete this.reminderCache[saved.id]
      await this.persistReminderCache()
    }

    await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
    updateReminders(this.reminders)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    // 內容變了 → 原生鬧鐘身上那份「App 死掉時要發什麼」也得跟著換
    void this.refreshReminderCache()
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

  // ── 提醒歷史紀錄 ─────────────────────────────────────────

  private async reloadReminderHistory(): Promise<void> {
    try {
      this.reminderHistory = normalizeHistory(await this.adapters.storage.readJson(keys.REMINDER_HISTORY_KEY))
    } catch {
      this.reminderHistory = []
    }
  }

  async listReminderHistory(): Promise<ReminderHistoryItem[]> {
    return this.reminderHistory
  }

  private async appendReminderHistory(reminder: Reminder, draft: ReminderHistoryDraft): Promise<void> {
    const char = draft.characterId
      ? this.characters.find((c) => c.id === draft.characterId)
      : reminder.characterId
        ? this.characters.find((c) => c.id === reminder.characterId)
        : undefined
    const item = buildHistoryItem(
      reminder,
      {
        ...draft,
        characterId: draft.characterId ?? char?.id,
        characterName: draft.characterName ?? char?.name,
        characterAvatar: draft.characterAvatar ?? char?.avatar
      },
      newId()
    )
    this.reminderHistory = appendHistory(this.reminderHistory, item)
    await this.adapters.storage.writeJson(keys.REMINDER_HISTORY_KEY, this.reminderHistory)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async removeReminderHistoryItem(id: string): Promise<void> {
    this.reminderHistory = removeHistoryItem(this.reminderHistory, id)
    await this.adapters.storage.writeJson(keys.REMINDER_HISTORY_KEY, this.reminderHistory)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  async clearReminderHistory(): Promise<void> {
    this.reminderHistory = []
    await this.adapters.storage.writeJson(keys.REMINDER_HISTORY_KEY, this.reminderHistory)
    this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  // ── 快取台詞（離線底線，見 reminder-plan §2.1）──────────────

  private async reloadReminderCache(): Promise<void> {
    try {
      this.reminderCache = normalizeCache(await this.adapters.storage.readJson(keys.REMINDER_CACHE_KEY))
    } catch {
      this.reminderCache = {}
    }
  }

  private async persistReminderCache(): Promise<void> {
    this.reminderCache = pruneCache(
      this.reminderCache,
      this.reminders.map((r) => r.id)
    )
    await this.adapters.storage.writeJson(keys.REMINDER_CACHE_KEY, this.reminderCache)
  }

  /**
   * 刷新「最近一次生成的台詞」。
   *
   * **時機是離開前景與對話閒置時**，不是建立提醒時——owner 的用法是先設好
   * 提醒、之後才大量互動，建立當下生成的話那段互動全都不會被吃進去
   * （見 `docs/mobile-standalone-reminder-plan.md` §2.1）。
   *
   * 省 Token 的兩道閘：只處理「已啟用、會在手機響、24 小時內會觸發」的提醒，
   * 且對話自上次生成後沒動過就跳過。
   */
  async refreshReminderCache(): Promise<void> {
    const convUpdatedAt = this.activeConversation?.updatedAt
    const horizonMs = 24 * 60 * 60 * 1000
    let dirty = false

    for (const r of this.reminders) {
      if (!r.enabled) continue
      if (r.notificationDevice === 'desktop') continue
      const delay = nextFireDelayMs(r.schedule, r.lastTriggeredAt)
      if (delay === null || delay > horizonMs) continue
      if (!needsRefresh(this.reminderCache[r.id], convUpdatedAt, Date.now(), reminderFingerprint(r))) continue

      try {
        const spoken = await speakStandaloneReminder({
          ...this.reminderSpeakDeps(r),
          mode: 'cache-refresh'
        })
        /*
         * 只存**成功生成**的台詞。降級結果（快取台詞／樸素通知）不能回存，
         * 否則快取會一路自我複製下去，而且 characterId 是空的。
         * `speakStandaloneReminder` 在 cache-refresh 模式下已經不會降級了，
         * 這裡是第二道防線。
         */
        if (!spoken?.text || spoken.status !== 'success') continue
        this.reminderCache[r.id] = {
          reminderId: r.id,
          characterId: spoken.characterId,
          characterName: spoken.characterName,
          text: spoken.text,
          generatedAt: Date.now(),
          basedOnConversationUpdatedAt: convUpdatedAt,
          fingerprint: reminderFingerprint(r)
        }
        dirty = true
      } catch (e) {
        // 刷快取失敗不是錯誤情境——它本來就只是底線，下次再試
        console.warn(`[Reminder] 快取台詞刷新失敗 "${r.label}":`, e)
      }
    }

    if (dirty) {
      await this.persistReminderCache()
      /*
       * 原生鬧鐘存的是「App 已經被劃掉時要發什麼」。
       * 只更新檔案而不重新註冊鬧鐘的話，快取等於白刷——
       * 真的響的時候用的還是上一輪的句子。
       */
      rearmNativeAlarms()
    }
  }

  /**
   * 回到前景。
   *
   * ⚠️ **一定要從磁碟重讀對話**。提醒在背景觸發時是由 headless WebView
   * （另一個 session）把角色的話寫進對話檔的；這邊記憶體裡那份是它寫入**之前**
   * 的舊狀態。不重讀的話，使用者回來隨便送一則訊息就會把整個對話存回舊版本，
   * 提醒講的那句話就這樣消失了——而且看起來像「提醒根本沒觸發」。
   *
   * 順便重讀提醒與歷史（headless 也會更新 `lastTriggeredAt` 與歷史紀錄）。
   */
  onAppResumed(): void {
    void (async () => {
      try {
        await this.reloadConversations()
        await this.reloadReminders()
        await this.reloadReminderHistory()
        this.events.push({ kind: 'state-invalidated', reason: 'desktop' })
        updateReminders(this.reminders)
      } catch (e) {
        console.warn('[Reminder] 回到前景時重讀資料失敗:', e)
      }
      flushDeferredReminders()
    })()
  }

  /** 離開前景：把接下來要響的提醒台詞先生一句起來當底線。 */
  onAppBackgrounded(): void {
    void this.refreshReminderCache()
  }

  /**
   * headless 那一趟的完整流程（提醒到點、原生把我們叫起來）。
   *
   * 放在 session 而不是 headless 入口，是因為判定／發話／歷史所需的東西
   * 全都在這裡；入口只負責把結果交回原生。**與前景走的是同一組函式**
   * （`decideReminderFire` ＋ `speakStandaloneReminder` ＋ `appendReminderHistory`），
   * 不是另一條平行實作——那正是計畫書 §2.1 要避免的事。
   *
   * `screenOn` 由原生的 `PowerManager.isInteractive()` 得來，
   * 比前景的 `screenLikelyOn()`（一律 true）準。
   */
  async runReminderHeadless(
    reminderId: string,
    screenOn: boolean,
    occurrenceAtMs = 0
  ): Promise<{ notify: boolean; title?: string; body?: string; reason: string }> {
    const reminder = this.reminders.find((r) => r.id === reminderId)
    if (!reminder) return { notify: false, reason: 'not-found' }
    if (!reminder.enabled) return { notify: false, reason: 'disabled' }

    /*
     * 前景那條是不是已經把這一次做掉了？
     *
     * 前景服務會**把整個 App 進程解凍**，於是原本被凍住的 JS 計時器可能
     * 搶在我們前面補跑。反向的防重複（JS 問磁碟）擋不住這個方向，
     * 所以兩邊都要問一次。`occurrenceAtMs` 是原本預定的觸發時刻，
     * 不是鬧鐘實際響的時間（那個刻意晚了 15 秒）。
     */
    if (occurrenceAtMs > 0 && occurrenceAlreadyHandled(reminder.lastTriggeredAt, occurrenceAtMs)) {
      return { notify: false, reason: 'already-handled' }
    }

    const decision = decideReminderFire(reminder, {
      activeSceneId: this.settings.activeSceneId ?? null,
      screenOn
    })
    if (decision.action === 'skip') {
      await this.appendReminderHistory(reminder, { status: decision.status })
      return { notify: false, reason: decision.status }
    }
    if (decision.action === 'defer') {
      // 原生那側已經把它留在 store 裡等亮屏補發，這裡不必再做什麼
      return { notify: false, reason: 'deferred' }
    }

    await this.recordReminderTriggered(reminder)
    const spoken = await this.speakReminder(reminder)
    if (!spoken) {
      await this.appendReminderHistory(reminder, {
        status: 'skipped_offline',
        errorMessage: this.lastSpeakFailure
      })
      return { notify: false, reason: 'no-speech' }
    }

    await this.appendReminderHistory(reminder, {
      status: spoken.status,
      text: spoken.text,
      characterId: spoken.characterId,
      characterName: spoken.characterName,
      errorMessage: spoken.fallbackReason
    })
    return {
      notify: true,
      title: spoken.characterName,
      body: spoken.text,
      reason: spoken.status
    }
  }

  private async recordReminderTriggered(reminder: Reminder): Promise<void> {
    const idx = this.reminders.findIndex((r) => r.id === reminder.id)
    if (idx < 0) return
    this.reminders[idx].lastTriggeredAt = Date.now()
    /*
     * 一次性提醒響過就關掉，而且要**寫進檔案**。
     *
     * 排程器原本只在記憶體裡把 `enabled` 設 false，重開 App 之後
     * 那則用過的一次性提醒在清單上還是開著的，看起來像還會再響。
     */
    if (this.reminders[idx].schedule.type === 'once') {
      this.reminders[idx].enabled = false
    }
    await this.adapters.storage.writeJson(keys.REMINDERS_KEY, this.reminders)
  }

  /**
   * 提醒觸發 → 角色發話。訊息會進目前的對話，回傳講出來的內容給排程器當通知文案。
   * 詳見 `reminderSpeak.ts`：提醒是「角色來提醒你」，不是行事曆通知。
   */
  private speakReminder(reminder: Reminder): Promise<ReminderSpeakResult | null> {
    return speakStandaloneReminder(this.reminderSpeakDeps(reminder))
  }

  /**
   * 最近一次發話失敗的原因。
   *
   * `speakStandaloneReminder` 失敗時可能回 `null`（沒有可用快取、
   * 或使用者關掉了離線降級），那條路徑本來什麼都沒留下——
   * 提醒紀錄只寫得出「跳過」，看不出是沒網路、沒金鑰還是 SDK 炸了。
   */
  private lastSpeakFailure: string | undefined

  /** `speakStandaloneReminder` 的相依組裝（現場發話與刷快取共用）。 */
  private reminderSpeakDeps(reminder: Reminder): Parameters<typeof speakStandaloneReminder>[0] {
    const cached = this.reminderCache[reminder.id]
    this.lastSpeakFailure = undefined
    return {
      onFailure: (reason) => {
        this.lastSpeakFailure = reason
      },
      adapters: this.adapters,
      events: this.events,
      settings: this.settings,
      characters: this.characters,
      /*
       * 綁定對話（`reminder.conversationId`）優先——TRPG 的劇情推進提醒要讀
       * 那條故事線的歷史，不是使用者剛好開著的那則對話。綁定的對話被刪掉時
       * 退回當前對話，不要整個不響。
       */
      getActiveConversation: () =>
        (reminder.conversationId ? this.conversationIndex.get(reminder.conversationId) : null) ??
        this.activeConversation,
      saveConversation: (c) => this.saveConversation(c),
      getPersona: () => this.personas.find((p) => p.id === this.settings.activePersonaId) ?? null,
      getWorld: () => this.worlds.find((w) => w.id === this.settings.activeWorldId) ?? null,
      /* 同理：綁定情境優先，用它的人設與世界觀脈絡發話 */
      getActiveScene: () =>
        (reminder.sceneId ? this.scenes.find((s) => s.id === reminder.sceneId) : null) ??
        this.scenes.find((s) => s.id === this.settings.activeSceneId) ??
        null,
      loadLorebook: (id) => this.getLorebook(id),
      reminder,
      cached: isCacheUsable(cached)
        ? { text: cached.text, characterId: cached.characterId, characterName: cached.characterName }
        : undefined
    }
  }
}

/** 給測試／App 用的啟動入口。 */
export async function bootStandaloneSession(
  adapters: PlatformAdapters,
  opts: BootStandaloneOptions = {}
): Promise<StandaloneSession> {
  return StandaloneSession.boot(adapters, opts)
}
