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
  ReminderHistoryItem,
  ReminderSchedule,
  ScenePreset,
  WeatherLocationSource,
  WorldPreset
} from '../types'
import type { Lorebook, LoreEntry } from '../lore'
import type { NewsItem, NewsKeywordGroup, NewsSource, SpeakMode } from '../news/types'
import type { FaceCropRect } from '../character/displayImage'
import type { LlmExportPayload } from '../llm/exportPayload'

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
  /** 使用者訊息旁顯示發話身分名字（`settings.ui.showPersonaName`，未設定＝開） */
  showPersonaName: boolean
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
  /** 記憶摘要：目前存的內容、涵蓋到哪個時間點、已涵蓋幾則舊訊息。 */
  getMemory(id: string): Promise<{ summary: string; coversTs: number; coveredCount: number }>
  /** 手動觸發：忽略自動閾值，立即把視窗外未涵蓋的舊訊息濃縮進摘要。 */
  summarizeMemoryNow(id: string): Promise<{ ok: boolean; noNew?: boolean; error?: string; summary?: string; coveredCount?: number }>
  /** 使用者手動編輯／改寫摘要內容（不動涵蓋點，下次增量摘要以此為基礎）。 */
  updateMemory(id: string, summary: string): Promise<void>
  /** 清除摘要（連涵蓋點一起重設，之後重新摘要會從頭讀舊訊息）。 */
  clearMemory(id: string): Promise<void>
}

export interface MessagesApi {
  remove(messageId: string): Promise<void>
  edit(messageId: string, content: string): Promise<void>
  /** 重送：刪掉該則之後的內容並重新產生回覆。 */
  resend(messageId: string): Promise<void>
  /**
   * 取這則訊息保留的完整 prompt（除錯用，對應桌面 Log 視窗的「查看完整 Prompt」）。
   *
   * ⚠️ **只有最近幾則留著** —— `core/store/prune.ts` 會把更舊的剝掉，
   * 不然對話檔會被 prompt 撐爆。所以要先看 `hasDebugPrompt` / `hasNewsDebug`
   * 再決定要不要顯示入口，找不到就回 `null`，不要當成錯誤。
   */
  getDebug(messageId: string): Promise<MessageDebug | null>
  /**
   * 使用者手動指定這則訊息要顯示的表情，覆蓋 AI 判斷的 `emotion`
   * （`docs/mobile-character-expression-plan.md` §3.2／§6.2）。
   * `emotion` 傳 `null`＝清掉覆蓋，回到「跟隨 AI 判斷」。
   */
  setEmotionOverride(messageId: string, emotion: string | null): Promise<void>
}

/** 一則訊息保留的除錯資料（各欄位可能都是空的）。 */
export interface MessageDebug {
  /** 主要回覆那次 LLM 呼叫的完整 request。 */
  debugPrompt?: string | null
  /** 輔助模型（情緒判定等）那次呼叫。 */
  utilityDebugPrompt?: string | null
  /** 對話新聞搜尋的意圖萃取呼叫。 */
  convSearchDebugPrompt?: string | null
  /** 新聞陪聊的抽選記錄（結構化，非 prompt 字串）。 */
  newsDebug?: unknown
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

  /**
   * 框選的臉部顯示範圍（`docs/mobile-character-expression-plan.md` §3.1）。
   * 對話記錄與小工具共用同一份設定；`null`＝沒框選過，顯示時不裁切。
   */
  getFaceCrop(id: string): Promise<FaceCropRect | null>
  /** 存框選範圍；傳 `null` 清掉（回到不裁切）。 */
  setFaceCrop(id: string, rect: FaceCropRect | null): Promise<void>

  /**
   * 新增／替換一張表情圖片，指定給某個情緒 key（`EMOTION_OPTIONS` 之一，見
   * `core/character/emotionCatalog.ts`）。**這是真正的角色卡內容變更**——
   * 跟 `saveAvatar` 同語意：**圖檔先落地、角色卡後存**，回傳新的圖片位址，
   * 呼叫端要自己把 `character.emotions[emotionKey] = 位址` 寫回草稿再 `save()`。
   */
  saveEmotionSprite(id: string, emotionKey: string, image: { bytes: Uint8Array; ext: string }): Promise<string>
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
   * 把目前桌面／設定狀態存成情境（含配色）。
   * `id` 給既有情境 id＝覆寫（對應桌面「覆寫為目前狀態」），不自動套用。
   * `id` 給 `null`＝新增一個情境並直接套用（手機版「新增情境」＝當下狀態就是這個情境）。
   */
  captureScene(id: string | null, name: string): Promise<ScenePreset>

  savePersona(preset: PersonaPreset): Promise<void>
  saveWorld(preset: WorldPreset): Promise<void>
  saveScene(preset: ScenePreset): Promise<void>
  removePersona(id: string): Promise<void>
  removeWorld(id: string): Promise<void>
  removeScene(id: string): Promise<void>
}

/**
 * 供應商，與桌面 `AppSettings['llm']['provider']` 同一組值。
 *
 * `local` = 使用者自架的 OpenAI 相容端點（Ollama、LM Studio、llama.cpp server…）。
 * 刻意不叫 `ollama`：協定才是重點，Ollama 只是其中一種伺服器，
 * 而且這個字串會寫進設定檔，之後很難改名。細節見 `docs/local-llm-provider-plan.md`。
 */
export type LlmProvider = 'openai' | 'claude' | 'gemini' | 'grok' | 'local'

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
  /**
   * 目前供應商生效的端點（等同 `endpoints[provider]`，攤平方便顯示）。
   * @deprecated 顯示用；要改值請走 `endpoints`。
   */
  endpoint?: string
  /**
   * 各供應商各自的端點。**主模型與輔助模型共用這張表**——
   * 兩者 provider 不同時自然拿到不同端點，這就是
   * 「主＝Claude 雲端／輔助＝本機 Ollama」得以成立的機制。
   */
  endpoints: Partial<Record<LlmProvider, string>>
  /** 附加在 system prompt 尾端的自訂指示，對所有供應商生效（不限本機模型）。 */
  extraInstruction: string
  hasApiKey: Record<LlmProvider, boolean>
  /** 最大回應字數（token 上限，與桌面「最大回應字數」同一欄）。 */
  maxResponseTokens: number
  /** 群組對話每次送出後最多幾位角色回應。 */
  maxGroupRounds: number
  /** 單則訊息圖片上限。 */
  maxImagesPerMessage: number
  /**
   * 取樣溫度，越高回應越發散、越低越保守收斂。與桌面同一顆設定共用，
   * 兩邊供應商都吃這個值——**但部分較新的 Claude 模型已不接受自訂溫度**，
   * 送出後由 `core/llm/claude.ts` 偵測「temperature is deprecated」自動退回不帶這個參數重打，
   * 不會讓對話失敗，只是那些模型底下這顆設定不生效。
   */
  temperature: number
  /**
   * 提醒發話、情緒分類是否改用獨立的輔助模型（群組對話一律用扮演主模型，不受此影響）。
   * 關閉時 `utilityProvider`／`utilityModel` 仍可能有值（記得上次選過什麼），
   * 只是不生效——與桌面 `llm.utilityEnabled` 同一顆開關。
   */
  utilityEnabled: boolean
  /** 輔助模型的供應商；未曾設定時預設跟隨 `provider`。 */
  utilityProvider: LlmProvider
  /** 目前輔助供應商生效的那個模型（等同 `utilityModels[utilityProvider]`，攤平方便顯示）。 */
  utilityModel: string
  utilityModels: Partial<Record<LlmProvider, string>>
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

/**
 * 即時氣象關鍵詞查詢（地震／颱風／天氣預報）的手機端快照。
 *
 * ⚠️ **刻意不含 `cwaApiKey` 的實際內容**——跟 `LlmSettingsSnapshot.hasApiKey`
 * 同一個理由：遙控模式下這支會經由 HTTP 傳到手機，金鑰不該明文過網路。
 * 要覆寫金鑰走 `SettingsApi.setCwaApiKey`（只寫不讀）。
 */
export interface WeatherRealtimeQuerySnapshot {
  enabled: boolean
  hasCwaApiKey: boolean
  forecastCounty: string
}

/** 手機可編輯的天氣基本設定（CWA API Key 見 `WeatherRealtimeQuerySnapshot`）。 */
export interface WeatherSettingsSnapshot {
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: WeatherLocationSource
  /** 輔助模型是否啟用；潤飾勾選要靠它，只讀。 */
  utilityEnabled: boolean
  realtimeQuery: WeatherRealtimeQuerySnapshot
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
  /** 使用者訊息旁的發話身分名字要不要顯示。 */
  setShowPersonaName(show: boolean): Promise<void>

  getLlm(): Promise<LlmSettingsSnapshot>
  setLlmProvider(provider: LlmProvider): Promise<void>
  setLlmModel(provider: LlmProvider, model: string): Promise<void>
  /** 設定端點。`provider` 省略＝目前生效的供應商（各家端點各自獨立）。 */
  setLlmEndpoint(endpoint: string, provider?: LlmProvider): Promise<void>
  /** 附加在 system prompt 尾端的自訂指示；套用於所有供應商，不分主／輔助模型。 */
  setLlmExtraInstruction(text: string): Promise<void>
  /** 開關輔助模型（提醒發話、情緒分類；群組對話不受影響）。 */
  setLlmUtilityEnabled(enabled: boolean): Promise<void>
  /** 切輔助供應商；沒選過型號時比照 `setLlmProvider` 補一個目錄預設值。 */
  setLlmUtilityProvider(provider: LlmProvider): Promise<void>
  setLlmUtilityModel(provider: LlmProvider, model: string): Promise<void>
  /**
   * 覆寫金鑰。**只能寫、讀不到舊值**（見 `LlmSettingsSnapshot` 的說明）。
   * 遙控模式下電腦端會依來源 IP 拒絕非區網直連的請求
   * （`DataError('unauthorized')`）——正常情況下 UI 應該先靠
   * `Capabilities.apiKeyAccess` 隱藏欄位，不應該讓使用者走到這步。
   */
  setLlmApiKey(provider: LlmProvider, apiKey: string): Promise<void>
  /**
   * 「連線」按鈕：驗證金鑰／端點可用。local 供應商沒有寫死的型號目錄，
   * 這是手機唯一能拿到型號清單的管道（`GET /v1/models`），成功時會帶回 `models`。
   * `endpoint` 省略時沿用目前存檔的值。
   */
  testLlmConnection(provider: LlmProvider, endpoint?: string): Promise<{ ok: true; models?: string[] } | { ok: false; error: string }>
  /** 回應字數／群組回應數／圖片上限／溫度（與桌面 LLM 設定同一欄）。 */
  setLlmChatLimits(limits: {
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
    temperature: number
  }): Promise<void>
  /**
   * 匯出 AI 服務設定給食記 App 用，走 QR 或 Android 分享，不經過網路。
   * **帶走所有已經填金鑰的供應商**，不是只有目前使用中那一組（食記自己
   * 也能切供應商）。只有本機模式支援——遙控模式下金鑰屬於電腦，透過手機
   * 轉出等於繞過桌面 `isLanDirectRequest()` 那層信任邊界，直接回
   * `DataError('not-supported')`。目前沒有可匯出的設定時回傳 `null`。
   */
  exportLlmForNutrition(): Promise<LlmExportPayload | null>

  getMemory(): Promise<MemorySettingsSnapshot>
  setMemory(settings: MemorySettingsSnapshot): Promise<void>

  /** 只涵蓋有簡單全域開關的模組（天氣／Spotify／日曆／新聞）。遙控（B6）不在其中。 */
  listModules(): Promise<ModuleToggle[]>
  setModuleEnabled(id: string, enabled: boolean): Promise<void>

  /**
   * 天氣基本設定（位置／開關／潤飾／即時氣象查詢）。
   * Spotify／日曆授權不走這支。
   */
  getWeather(): Promise<WeatherSettingsSnapshot>
  setWeather(
    patch: Partial<Omit<WeatherSettingsSnapshot, 'utilityEnabled' | 'realtimeQuery'>> & {
      realtimeQuery?: Partial<Omit<WeatherRealtimeQuerySnapshot, 'hasCwaApiKey'>>
    }
  ): Promise<WeatherSettingsSnapshot>
  detectWeatherLocation(): Promise<WeatherSettingsSnapshot>
  geocodeWeatherLocation(name: string): Promise<WeatherSettingsSnapshot>
  fetchWeatherNow(): Promise<WeatherNowSnapshot>
  /** 覆寫中央氣象署 API Key。**只能寫、讀不到舊值**，理由同 `setLlmApiKey`。 */
  setCwaApiKey(apiKey: string): Promise<void>
  /** 測試目前（或剛填入但尚未存檔的）CWA API Key 是否可用。 */
  testCwaApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }>
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
  /**
   * 觸發歷史（新到舊）。
   *
   * 提醒是「背景發生的事」——沒響、響了沒看到、被手錶轉走，
   * 使用者都只會得到同一個結論「它壞了」。歷史是唯一查得出差別的地方。
   * 遙控模式桌面端還沒記錄，回空陣列即可（不是錯誤）。
   */
  history(): Promise<ReminderHistoryItem[]>
  removeHistoryItem(id: string): Promise<void>
  clearHistory(): Promise<void>
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
  /**
   * 從角色卡自動生成一條用語（規格 §8）：輔助模型只寫 `content` 一句話，
   * `keys` 由呼叫端用角色名字＋暱稱填。**沒 API Key／模型吐空這類是常見的預期失敗**，
   * 不是連線層級的錯誤，所以跟 `NewsFetchResult` 同一個理由走 `{ ok: false, error }`
   * 而不是丟 `DataError`——`error` 是電腦端／獨立版產生的字串，UI 直接顯示。
   */
  generateEntry(characterId: string, lorebookId: string): Promise<LoreGenerateResult>
}

export type LoreGenerateResult = { ok: true; entry: LoreEntry } | { ok: false; error: string }

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
  /** 對話新聞搜尋（開關＋觸發詞＋新聞時效，與桌面設定面板同一份資料）。 */
  conversationSearch: { enabled: boolean; triggerWords: string[]; maxAgeHours: number }
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

/** 停止生成後還給輸入框的草稿；`null`＝當下沒有可停的請求。 */
export type StopGeneratingResult = {
  content: string
  images?: string[]
} | null

export interface DataSource {
  readonly capabilities: Capabilities

  /** 開啟時與每次 `state-invalidated` 都呼叫這支。 */
  getState(): Promise<AppStateSnapshot>

  sendMessage(input: SendMessageInput): Promise<void>

  /**
   * 中止進行中的生成（對齊桌面「停止」）。
   * 成功中止時回草稿，讓 UI 把字／圖還回輸入框；沒東西可停就回 `null`。
   */
  stopGenerating(): Promise<StopGeneratingResult>

  /** 第 `index` 張圖的可顯示位址；同 `avatarUrl` 的理由，不可讓 UI 直接讀 `message.images`。 */
  getMessageImageUrl(messageId: string, index: number): Promise<string | null>

  /**
   * 依訊息決定要顯示的表情圖（已套用 §3.1 框選，找不到對應表情圖時回傳主圖）。
   * `emotion` 通常是 `message.emotionOverride ?? message.emotion`。
   * 見 `docs/mobile-character-expression-plan.md` §5。
   */
  characterDisplayImageUrl(characterId: string, emotion: string | undefined): Promise<string | null>

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
