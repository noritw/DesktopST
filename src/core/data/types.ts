import type {
  Character,
  ColorTheme,
  Conversation,
  Message,
  NewsLinkInfo,
  PendingRandomTool,
  PersonaPreset,
  RandomResult,
  Reminder,
  ReminderSchedule,
  ScenePreset,
  WorldPreset
} from '../types'
import type { Lorebook } from '../lore'
import type { NewsItem, NewsKeywordGroup, NewsSource, SpeakMode } from '../news/types'

/**
 * 資料來源（B3 階段 0-③）。
 *
 * 階段 0-② 的 `EventSource` 管「事情發生了」（推播方向），
 * 這支管「我要讀資料／我要下指令」（拉取方向）。兩者合起來就是手機 UI 的全部外界接觸面。
 *
 *   獨立模式：直接呼叫 `core/` ＋ Capacitor adapter
 *   遙控模式：打電腦上 `mobileServer` 的 `/api/*`
 *
 * **UI 元件不應該知道自己在哪種模式**（`docs/mobile-html-feature-inventory.md` §3 決議③
 * 對 `EventSource` 的要求，同樣適用於這裡）。
 *
 * ## 三條硬規則
 *
 * 1. **全部方法都是 `async`**，即使獨立模式手上是同步資料也一樣。
 *    否則遙控實作接不上，UI 會被迫為兩種模式寫兩種寫法 —— 正是 roadmap §4.1 要防的 drift。
 *
 * 2. **介面裡不得出現任何 UI 文案**（roadmap §3.3）。失敗一律回錯誤代碼，
 *    翻成中文是 UI 層的事（比照 §4.4b 的 `PngCardError` + `toUserFacingError` 慣例）。
 *
 * 3. **編輯類方法兩種模式都要實作，不設能力旗標。**
 *    遙控模式下手機沒有自己那份資料，編輯就是一次 RPC，改的是電腦上的唯一一份，
 *    不可能分歧。真正的同步（獨立模式本機資料 ↔ 電腦）是 roadmap §4.7 的 S1／S2，
 *    B5 之後才做，與這裡無關。唯一的例外是 API Key，見 `Capabilities.apiKeyAccess`。
 */

// ── 能力旗標 ────────────────────────────────────────────────

/**
 * 兩種模式的**真實**差異。UI 讀這個決定顯示／隱藏，
 * **元件裡不得出現 `mode === 'remote'`**。
 *
 * 刻意很短：差異越少，「UI 不知道自己在哪種模式」越站得住腳。
 * 想加旗標之前先確認那真的是模式差異，而不是還沒實作。
 */
export interface Capabilities {
  /**
   * 可讀寫 API Key。
   *
   * ⚠️ **條件是「是否區網直連」，不是「哪種模式」**（roadmap §4.7）：
   * 獨立模式恆為 true；遙控模式只有手機與電腦在同一區網直連時才是 true，
   * 經 relay 轉發時為 false —— 金鑰不得流經第三方。
   *
   * **由電腦端檢查來源 IP 判定，不可信任手機端自稱。**
   */
  apiKeyAccess: boolean
  /** 遙控面板（H1–H11）。B6 才實作，先留旗標避免日後改介面形狀。 */
  remoteControl: boolean
  /** 電腦螢幕截圖。遙控專屬（決議②：獨立模式不做手機自身截圖）。 */
  screenshot: boolean
}

// ── 錯誤 ────────────────────────────────────────────────────

/** 失敗一律用這些代碼，UI 層翻中文。 */
export type DataErrorCode =
  | 'unauthorized'
  | 'unreachable'
  | 'not-found'
  | 'invalid-input'
  | 'conflict'
  | 'not-supported'
  | 'unknown'

export class DataError extends Error {
  constructor(
    public code: DataErrorCode,
    /** 供除錯與埋點，**不要直接顯示給使用者**。 */
    public detail?: string
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`)
    this.name = 'DataError'
  }
}

// ── 讀取用的快照型別 ────────────────────────────────────────

/**
 * 「這次對話有誰在場」（決議① 的用語）。
 *
 * 同步時對應桌面版的桌面角色清單（同一組角色 id）；
 * **座標不在這裡** —— 位置是桌面平台獨有的顯示狀態，由電腦端自行產生。
 */
export interface PresentCharacter {
  id: string
  name: string
  muted: boolean
}

/** 角色庫清單用的精簡列。完整資料走 `characters.get()`。 */
export interface CharacterListItem {
  id: string
  name: string
  present: boolean
}

export interface ConversationListItem {
  id: string
  title: string
  updatedAt: number
  active: boolean
}

/**
 * 訊息在傳輸時會被瘦身：`images` 的 base64 太肥不隨快照走，
 * 改以 `imageCount` 告知張數，實際內容按需向 `getMessageImageUrl()` 取。
 * 獨立模式手上雖然有完整資料，仍走同一形狀，UI 才只有一種寫法。
 */
export type MessageSnapshot = Omit<Message, 'images' | 'debugPrompt' | 'utilityDebugPrompt'> & {
  imageCount?: number
}

export interface ConversationSnapshot {
  id: string
  title: string
  messages: MessageSnapshot[]
}

/** 開啟 app 或收到 `state-invalidated` 時重抓的那一包。 */
export interface AppStateSnapshot {
  presentCharacters: PresentCharacter[]
  conversation: ConversationSnapshot | null
  colorTheme: ColorTheme
  randomToolsEnabled: boolean
  /** 訊息旁顯示生成模型的小圖示（`settings.ui.showLlmBadge`，未設定＝開） */
  showLlmBadge: boolean
  maxImagesPerMessage: number
  activeSceneId?: string
  activePersonaId?: string
  activeWorldId?: string
  /**
   * 使用中情境與目前狀態（配色／Persona／世界觀／對話／在場角色）是否不一致。
   * UI 在情境名稱旁加星號，提示可「覆寫為目前狀態」存回情境。
   */
  activeSceneDirty?: boolean
}

export interface SendMessageInput {
  content: string
  /** 已壓縮的 data URI（長邊 1024／JPEG 0.8，見清單 B2）。壓縮在 UI 層做。 */
  images?: string[]
  randomResults?: RandomResult[]
  pendingRandomTools?: PendingRandomTool[]
  /** 不呼叫 LLM，只把訊息放進對話（清單 A7）。 */
  skipLlm?: boolean
  /** 「聊這個」確認後掛上的新聞連結（含 promptContext） */
  newsLink?: NewsLinkInfo | null
}

// ── 分組介面 ────────────────────────────────────────────────

export interface ConversationsApi {
  list(): Promise<ConversationListItem[]>
  load(id: string): Promise<void>
  create(title?: string): Promise<ConversationListItem>
  rename(id: string, title: string): Promise<ConversationListItem>
  remove(id: string): Promise<{ activeConversationId: string }>
}

export interface MessagesApi {
  remove(messageId: string): Promise<void>
  edit(messageId: string, content: string): Promise<void>
  /** 重送：刪掉該則之後的內容並重新產生回覆。 */
  resend(messageId: string): Promise<void>
}

/**
 * 角色卡檔案（匯入匯出）。
 *
 * ⚠️ **二進位一律 `Uint8Array`，不用 `Buffer`**（roadmap §4.4b）：`Buffer` 是 Node 專屬，
 * core 必須在瀏覽器 tsconfig 下也編得過。base64 編解碼在平台層做。
 */
export interface CardFile {
  bytes: Uint8Array
  /** 建議檔名（含副檔名）。UI 拿去當下載檔名，不必自己拼。 */
  filename: string
}

/** 匯入 DST Pack 時遇到「本機已有同 id／同名角色」怎麼辦。 */
export type PackConflictPolicy = 'skip' | 'overwrite' | 'new'

export interface CharactersApi {
  /** 角色庫清單（含是否在場）。 */
  list(): Promise<CharacterListItem[]>
  /** 完整角色卡。編輯器用。 */
  get(id: string): Promise<Character>
  save(character: Character): Promise<void>
  remove(id: string): Promise<void>
  /**
   * 建立一張空白角色卡並存檔，回傳完整卡（含新的 id）。
   *
   * ⚠️ **id 由資料來源產生，不由 UI 產生。** 遙控模式下 id 必須是電腦端認得的那一個；
   * 而手機上 `crypto.randomUUID()` 在非安全內容（`http://192.168.x.x`）根本不存在
   * —— 計畫書 §4.10 第 3 點踩過同一個坑。
   */
  create(name: string): Promise<Character>

  /**
   * 換主圖。回傳新的 `avatar` 欄位值（平台自訂：桌面是檔案路徑、手機是沙箱路徑）。
   *
   * 呼叫端拿到之後要寫回草稿再 `save()` —— 與桌面版 `character:save-avatar` 同語意：
   * **圖檔先落地、角色卡後存**，這樣中途放棄編輯不會留下半張壞卡。
   */
  saveAvatar(id: string, image: { bytes: Uint8Array; ext: string }): Promise<string>

  /** 匯入單張角色卡（SillyTavern PNG 或 JSON）。回傳建立出來的角色。 */
  importCard(file: { bytes: Uint8Array; kind: 'png' | 'json' }): Promise<Character>
  /** 匯出單張角色卡。 */
  exportCard(id: string, kind: 'png' | 'json'): Promise<CardFile>

  /** 匯入 DST Pack（多角色 ＋ 可選的世界觀／使用者）。 */
  importPack(
    bytes: Uint8Array,
    opts: { onConflict: PackConflictPolicy; applyGlobalSettings: boolean }
  ): Promise<{ imported: number; skipped: number }>
  /** 打包 DST Pack。`includeLorebooks` 預設不勾（私人資料，規格 §7.3）。 */
  exportPack(
    ids: string[],
    opts: { includeGlobalSettings: boolean; includeLorebooks: boolean }
  ): Promise<CardFile>

  setPresent(id: string, present: boolean): Promise<void>
  toggleMute(id: string): Promise<boolean>
  /** 說點什麼（清單 D2）。 */
  speak(id: string): Promise<void>

  /**
   * 頭像可顯示的位址。
   *
   * 遙控是 `/api/avatar/:id`，獨立是 data URI 或沙箱位址 ——
   * **兩邊都不是「角色卡裡那個字串」**（本機檔案路徑 WebView 載不動），
   * 所以必須經過這支，不可讓 UI 直接讀 `character.avatar`。
   * 找不到回 `null`，UI 顯示 🐾 placeholder（清單 D6）。
   */
  avatarUrl(id: string): Promise<string | null>
}

/**
 * 預設組清單列。
 *
 * ⚠️ **與完整預設組分開，是刻意的**：切換用的下拉選單只需要 id 與名字，
 * 編輯器才需要全部欄位。遙控端現行的 `/api/presets` 也只回傳精簡欄位
 * （`worldSetting` 甚至被截成 100 字），若讓 `personas()` 宣稱回傳完整
 * `PersonaPreset[]`，型別就在說謊。比照 `CharactersApi` 的 list／get 分法。
 */
export interface PresetListItem {
  id: string
  name: string
}

export interface PresetsApi {
  listPersonas(): Promise<PresetListItem[]>
  listWorlds(): Promise<PresetListItem[]>
  listScenes(): Promise<PresetListItem[]>

  getPersona(id: string): Promise<PersonaPreset>
  getWorld(id: string): Promise<WorldPreset>
  getScene(id: string): Promise<ScenePreset>

  activePersonaId(): Promise<string>
  activeWorldId(): Promise<string>
  activeSceneId(): Promise<string | undefined>

  activatePersona(id: string): Promise<void>
  activateWorld(id: string): Promise<void>
  applyScene(id: string): Promise<void>
  /**
   * 把目前桌面／設定狀態覆寫進既有情境（含配色）。
   * 對應桌面「覆寫為目前狀態」；名稱沿用情境既有名稱。
   */
  captureScene(id: string): Promise<void>

  savePersona(preset: PersonaPreset): Promise<void>
  saveWorld(preset: WorldPreset): Promise<void>
  saveScene(preset: ScenePreset): Promise<void>
  removePersona(id: string): Promise<void>
  removeWorld(id: string): Promise<void>
  removeScene(id: string): Promise<void>
}

/** 四家供應商，與桌面 `AppSettings['llm']['provider']` 同一組值。 */
export type LlmProvider = 'openai' | 'claude' | 'gemini' | 'grok'

/**
 * LLM 設定的手機端快照。
 *
 * ⚠️ **刻意不含 API Key 的實際內容**（roadmap §4.7）：
 * 就算 `Capabilities.apiKeyAccess` 為 true（區網直連），也不透過這支把金鑰明文
 * 傳到手機顯示 —— 那是不必要的曝光面，使用者要換金鑰直接覆寫即可，不需要先看到舊的。
 * `hasApiKey` 只回答「有沒有設定」，UI 用來顯示「已設定」／「尚未設定」。
 */
export interface LlmSettingsSnapshot {
  provider: LlmProvider
  /** 目前供應商生效的那個模型（等同 `models[provider]`，先攤平方便顯示）。 */
  model: string
  models: Partial<Record<LlmProvider, string>>
  endpoint?: string
  hasApiKey: Record<LlmProvider, boolean>
  /** 最大回應字數（token 上限，與桌面「最大回應字數」同一欄）。 */
  maxResponseTokens: number
  /** 群組對話每次送出後最多幾位角色回應。 */
  maxGroupRounds: number
  /** 單則訊息圖片上限。 */
  maxImagesPerMessage: number
}

export interface MemorySettingsSnapshot {
  keepRecentN: number
  autoSummarizeAfter: number
  autoSummarizeEnabled: boolean
}

/** 「進階」摺疊區裡的模組開關一列（清單外的 B3 決議④項目）。 */
export interface ModuleToggle {
  id: string
  label: string
  enabled: boolean
}

/** 手機可編輯的天氣基本設定（不含 CWA API Key）。 */
export interface WeatherSettingsSnapshot {
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: 'ip' | 'manual' | ''
  /** 輔助模型是否啟用；潤飾勾選要靠它，只讀。 */
  utilityEnabled: boolean
}

export interface WeatherNowSnapshot {
  description: string
  temperatureC: number
  humidity: number
  windSpeed: number
}

/**
 * 設定。
 *
 * ⚠️ **主題不是手機的本機偏好**，是 `settings.ui.colorTheme` 的一部分。
 * 只存在手機上的話，換裝置或重新整理就會不一致 ——
 * owner 2026-08-04 回報「配色不會儲存、也不會和桌面同步」正是這個。
 *
 * 依 §2 目標 4，第一層只露「填 API Key」＋供應商／模型；endpoint、記憶參數、
 * 模組開關收進 UI 的「進階」摺疊區，但介面本身不分層——分層是 UI 的事。
 */
export interface SettingsApi {
  setColorTheme(theme: ColorTheme): Promise<void>
  /** 訊息旁的模型小圖示要不要顯示。 */
  setShowLlmBadge(show: boolean): Promise<void>

  getLlm(): Promise<LlmSettingsSnapshot>
  setLlmProvider(provider: LlmProvider): Promise<void>
  setLlmModel(provider: LlmProvider, model: string): Promise<void>
  setLlmEndpoint(endpoint: string): Promise<void>
  /**
   * 覆寫金鑰。**只能寫、讀不到舊值**（見 `LlmSettingsSnapshot` 的說明）。
   * 遙控模式下電腦端會依來源 IP 拒絕非區網直連的請求
   * （`DataError('unauthorized')`）——正常情況下 UI 應該先靠
   * `Capabilities.apiKeyAccess` 隱藏欄位，不應該讓使用者走到這步。
   */
  setLlmApiKey(provider: LlmProvider, apiKey: string): Promise<void>
  /** 回應字數／群組回應數／圖片上限（與桌面 LLM 設定同一欄）。 */
  setLlmChatLimits(limits: {
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
  }): Promise<void>

  getMemory(): Promise<MemorySettingsSnapshot>
  setMemory(settings: MemorySettingsSnapshot): Promise<void>

  /** 只涵蓋有簡單全域開關的模組（天氣／Spotify／日曆／新聞）。遙控（B6）不在其中。 */
  listModules(): Promise<ModuleToggle[]>
  setModuleEnabled(id: string, enabled: boolean): Promise<void>

  /**
   * 天氣基本設定（位置／開關／潤飾）。
   * CWA API Key 等進階仍只在桌面；Spotify／日曆授權同樣不走這支。
   */
  getWeather(): Promise<WeatherSettingsSnapshot>
  setWeather(patch: Partial<Omit<WeatherSettingsSnapshot, 'utilityEnabled'>>): Promise<WeatherSettingsSnapshot>
  detectWeatherLocation(): Promise<WeatherSettingsSnapshot>
  geocodeWeatherLocation(name: string): Promise<WeatherSettingsSnapshot>
  fetchWeatherNow(): Promise<WeatherNowSnapshot>
}

/**
 * 提醒 CRUD（資料面；排程本身是 B5）。
 *
 * ⚠️ **id 由資料來源產生**（`create()`），理由同 `CharactersApi.create()`：
 * 手機上 `crypto.randomUUID()` 在非安全內容下不存在，讓 UI 自己生 id 會重踩
 * 計畫書 §4.10 第 3 點那個坑。建立流程是 `create()` 拿到空白提醒 → 編輯 → `save()`。
 */
export interface RemindersApi {
  list(): Promise<Reminder[]>
  create(): Promise<Reminder>
  save(reminder: Reminder): Promise<Reminder>
  remove(id: string): Promise<void>
  toggle(id: string, enabled: boolean): Promise<void>
}

/**
 * 用語解說（Lorebook）。
 *
 * B3 階段 3 只做了**清單**：角色卡編輯器要讓使用者勾「這個角色帶哪幾本」
 * （`Character.lorebookIds`，疊加式）。內容編輯（get／save／remove／create）
 * 是階段 9 補的缺口，比照 `PresetsApi` 的 list（摘要）／get（完整）分法——
 * 編輯器必須逐本讀完整資料，不可拿 list 給的 `{id, name}` 直接存回去。
 */
export interface LorebooksApi {
  list(): Promise<PresetListItem[]>
  get(id: string): Promise<Lorebook>
  save(book: Lorebook): Promise<Lorebook>
  remove(id: string): Promise<void>
  create(name?: string): Promise<Lorebook>
}

/**
 * 個人新聞報（清單 F1–F13，B3 階段 6）。
 *
 * ## 為什麼欄位設定也在這裡
 *
 * 每欄則數／關鍵字組／欄位順序寫回去之後，畫面上的新聞就得跟著換 ——
 * 端點本來就設計成「改設定順便回該欄的新內容」（`mobileRoutes.ts`），
 * 拆成 settings 與 news 兩支反而要 UI 自己再抓一次。
 *
 * ## 抓取失敗不丟例外
 *
 * 「新聞模組尚未啟用」「熱門話題未啟用」這類是**正常的拒絕**不是錯誤，
 * 而且訊息由電腦端產生（模組自己最清楚為什麼拒絕）。
 * 所以走 `{ ok: false, error }` 而不是 `DataError` ——
 * ⚠️ `error` 是電腦端給的字串，UI 直接顯示；連線層面的失敗仍照常丟 `DataError`。
 */
export interface NewsReaderSnapshot {
  enabled: boolean
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  readerKeywordGroupIds: string[]
  readerMaxItems: number
  readerPerKeyword: number
  readerBreakoutQuota: number
  /** 釘選與「不看了」是**內容狀態**，桌機與手機共用同一份（規劃書 §3 方案 B）。 */
  pinnedItems: NewsItem[]
  dismissedIds: string[]
}

/** 抓取回應：成功時順便帶回設定快照，UI 一次拿齊欄位資訊。 */
export type NewsFetchResult =
  | {
      ok: true
      items: NewsItem[]
      fetchedAt: number
      sectionGroupId?: string
      sources: NewsSource[]
      keywordGroups: NewsKeywordGroup[]
      readerKeywordGroupIds: string[]
      readerMaxItems: number
      readerPerKeyword: number
      readerBreakoutQuota: number
    }
  | { ok: false; error: string }

export interface NewsBatchRequest {
  excludeIds?: string[]
  /** true＝絕不回填已排除的 id（「換一批」用）。 */
  strictExclude?: boolean
}

export interface NewsSectionRequest extends NewsBatchRequest {
  sectionGroupId: string
}

/**
 * 手機能改的新聞設定（清單 6.1 最後一項）。
 *
 * 刻意**不是整份 `NewsModuleSettings`**：語言處理、破圈、學習權重那些屬於
 * 桌面設定面板的深水區，手機上要的是「加個關鍵字、封鎖一個詞、加個 RSS」。
 * 總開關（`enabled`）已在設定的模組開關那裡，這裡只讀不寫。
 */
export interface NewsEditableSettings {
  enabled: boolean
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  blacklist: string[]
  /** 「說點什麼」抓新聞頻率（關／偶爾／每次）。 */
  speakButton: SpeakMode
}

/** 定時新聞陪聊。與桌面 `news:get-scheduler`／`news:sync-scheduler` 同一份資料。 */
export interface NewsScheduleSnapshot {
  enabled: boolean
  schedule?: ReminderSchedule
}

export interface NewsApi {
  /** 開啟新聞報時的一次性狀態（含共用的釘選／不看了）。 */
  getReaderState(): Promise<NewsReaderSnapshot>

  fetchBatch(req?: NewsBatchRequest): Promise<NewsFetchResult>
  fetchSection(req: NewsSectionRequest): Promise<NewsFetchResult>

  setPinned(items: NewsItem[]): Promise<void>
  setDismissed(ids: string[]): Promise<void>

  /** 改配額；回傳該欄重抓後的內容，UI 就地換掉那一欄。 */
  setQuota(sectionGroupId: string, quota: number): Promise<NewsFetchResult>
  /** 空陣列＝全部組。 */
  setKeywordGroups(ids: string[]): Promise<void>
  /** 欄位上移／下移。傳完整順序，回傳電腦端排定後的結果。 */
  setSourceOrder(orderedSourceIds: string[]): Promise<NewsSource[]>

  /** 開原文的隱性回饋加分（清單 F9）。 */
  markOpened(sourceId: string): Promise<void>

  /**
   * 整理一則新聞的 promptContext（抓原文／摘要）。
   * 遙控版走電腦端；獨立模式之後再說。
   */
  enrichForChat(item: NewsItem, forceRefresh?: boolean): Promise<{
    ok: boolean
    promptContext: string
    source?: string
    usedUtility?: boolean
    warning?: string
  }>

  /** 覆寫已送出訊息上的 promptContext（只影響後續延續話題）。 */
  updatePromptContext(messageId: string, promptContext: string): Promise<{ ok: boolean; error?: string }>

  getSettings(): Promise<NewsEditableSettings>
  saveSettings(patch: Partial<Omit<NewsEditableSettings, 'enabled'>>): Promise<NewsEditableSettings>

  getSchedule(): Promise<NewsScheduleSnapshot>
  setSchedule(next: NewsScheduleSnapshot): Promise<void>
}

/**
 * 遙控面板（清單 H1–H11，B6）。
 *
 * ⚠️ **獨立模式永久不支援**（不是「之後補」的 pending stage）——
 * 遙控在獨立模式沒有意義，因為沒有電腦可控。`LocalDataSource` 的每個方法
 * 都回 `DataError('not-supported')`，介面形狀留著只是為了讓兩個實作維持同一個型別。
 *
 * 電腦端的截圖／點擊／視窗列舉／程式白名單／系統動作全部已經有現成端點
 * （`mobileServer.ts` ＋ `modules/remote-control/`），這裡只是把它們對映成
 * `DataSource` 的形狀，**不寫任何新的業務邏輯**。
 */
export type RemoteCapability =
  | 'remote.pointer.click'
  | 'remote.pointer.scroll'
  | 'remote.keyboard.type'
  | 'remote.keyboard.hotkey'
  | 'remote.program.launch'
  | 'remote.program.close'
  | 'remote.monitor.power'
  | 'remote.system.shutdown'
  | 'remote.system.restart'

/**
 * 桌面設定面板已經設定好的權限狀態。手機端只讀，**不重做管理介面**——
 * 白名單、裝置限制、需要二次確認的能力清單全部由桌面設定，
 * 手機只是照著顯示／隱藏對應的按鈕。
 */
export interface RemoteControlState {
  enabled: boolean
  allowedCapabilities: RemoteCapability[]
  requireConfirmation: RemoteCapability[]
  restrictToAllowedDevices: boolean
  currentDeviceAllowed?: boolean
}

export interface RemoteDisplay {
  index: number
  label: string
  isPrimary: boolean
  bounds: { x: number; y: number; width: number; height: number }
}

export interface RemoteWindow {
  hwnd: number
  pid: number
  title: string
  proc: string
  minimized: boolean
  displayIndex: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * 截圖對應的桌面物理座標範圍（`mobileServer.ts` 的 `X-Display-Bounds` /
 * `X-Window-Bounds`）。**點擊／滾動座標換算一律要用這個**，不可自行假設
 * 螢幕解析度或重新推導公式——不同電腦的螢幕縮放比例（`scaleFactor`）不一樣。
 */
export interface RemoteScreenBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface RemoteScreenshot {
  /** 可直接餵給 `<img src>` 的位址（object URL）。**呼叫端用完要自行 `URL.revokeObjectURL()`**。 */
  url: string
  bounds: RemoteScreenBounds | null
}

export interface RemoteProgram {
  id: string
  name: string
  iconDataUrl?: string
  running: boolean
}

export type RemoteSystemAction = 'shutdown' | 'restart' | 'monitor-off' | 'wake'

export interface RemoteActionResult {
  ok: boolean
  /** 電腦端給的除錯訊息，UI 顯示前先翻中文，不可直接顯示。 */
  error?: string
}

export interface RemoteControlApi {
  getState(): Promise<RemoteControlState>

  listDisplays(): Promise<RemoteDisplay[]>
  listWindows(): Promise<RemoteWindow[]>
  captureDisplay(displayIndex: number, withCharacters: boolean): Promise<RemoteScreenshot>
  captureWindow(win: { hwnd: number; title: string }): Promise<RemoteScreenshot>
  /** Windows 是否在鎖定畫面（`mobile.html` 的鎖定提示橫幅，H11 一部分）。 */
  isLocked(): Promise<boolean>

  /**
   * `confirmed` 由 UI 依 `RemoteControlState.requireConfirmation` 決定要不要先跳確認對話框，
   * 再帶著 `confirmed: true` 重打一次——比照桌面設定面板「這個能力需要每次確認」的語意。
   */
  click(x: number, y: number, opts: { button: 'left' | 'right'; double: boolean; confirmed?: boolean }): Promise<RemoteActionResult>
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<RemoteActionResult>
  typeText(text: string, opts: { pressEnter: boolean; confirmed?: boolean }): Promise<RemoteActionResult>
  sendKey(keys: string, confirmed?: boolean): Promise<RemoteActionResult>

  /** 讀桌面已設定好的程式白名單；手機端不做「新增白名單項目」的 UI。 */
  listPrograms(): Promise<RemoteProgram[]>
  launchProgram(id: string, confirmed?: boolean): Promise<RemoteActionResult>
  closeProgram(id: string, confirmed?: boolean): Promise<RemoteActionResult>

  /** 關機／重開機／關閉螢幕／喚醒螢幕。危險操作，UI 層要有二次確認。 */
  systemAction(action: RemoteSystemAction, confirmed?: boolean): Promise<RemoteActionResult>

  /** 遙控模式下暫時隱藏／恢復 DeST 自己的視窗，避免擋住截圖。 */
  hideWindows(): Promise<void>
  restoreWindows(): Promise<void>
}

export interface DataSource {
  readonly capabilities: Capabilities

  /** 開啟時與每次 `state-invalidated` 都呼叫這支。 */
  getState(): Promise<AppStateSnapshot>

  sendMessage(input: SendMessageInput): Promise<void>

  /** 第 `index` 張圖的可顯示位址；同 `avatarUrl` 的理由，不可讓 UI 直接讀 `message.images`。 */
  getMessageImageUrl(messageId: string, index: number): Promise<string | null>

  readonly conversations: ConversationsApi
  readonly messages: MessagesApi
  readonly characters: CharactersApi
  readonly presets: PresetsApi
  readonly settings: SettingsApi
  readonly lorebooks: LorebooksApi
  readonly reminders: RemindersApi
  readonly news: NewsApi
  readonly remoteControl: RemoteControlApi
}

/**
 * 完整對話（含 `images` 與 debug 欄位）目前只有獨立模式拿得到，
 * 且只有 Log 類畫面需要。**刻意不放進 `DataSource`** ——
 * 放進去等於逼遙控實作回傳它拿不到也不該傳的東西。
 * 之後真的需要時，走另一個可選介面，不要污染主介面。
 */
export type FullConversation = Conversation
