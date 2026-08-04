import type {
  Character,
  ColorTheme,
  Conversation,
  Message,
  PendingRandomTool,
  PersonaPreset,
  RandomResult,
  ScenePreset,
  WorldPreset
} from '../types'

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
  maxImagesPerMessage: number
}

export interface SendMessageInput {
  content: string
  /** 已壓縮的 data URI（長邊 1024／JPEG 0.8，見清單 B2）。壓縮在 UI 層做。 */
  images?: string[]
  randomResults?: RandomResult[]
  pendingRandomTools?: PendingRandomTool[]
  /** 不呼叫 LLM，只把訊息放進對話（清單 A7）。 */
  skipLlm?: boolean
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

export interface CharactersApi {
  /** 角色庫清單（含是否在場）。 */
  list(): Promise<CharacterListItem[]>
  /** 完整角色卡。編輯器用。 */
  get(id: string): Promise<Character>
  save(character: Character): Promise<void>
  remove(id: string): Promise<void>

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

  activatePersona(id: string): Promise<void>
  activateWorld(id: string): Promise<void>
  applyScene(id: string): Promise<void>

  savePersona(preset: PersonaPreset): Promise<void>
  saveWorld(preset: WorldPreset): Promise<void>
  saveScene(preset: ScenePreset): Promise<void>
  removePersona(id: string): Promise<void>
  removeWorld(id: string): Promise<void>
  removeScene(id: string): Promise<void>
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
}

/**
 * 完整對話（含 `images` 與 debug 欄位）目前只有獨立模式拿得到，
 * 且只有 Log 類畫面需要。**刻意不放進 `DataSource`** ——
 * 放進去等於逼遙控實作回傳它拿不到也不該傳的東西。
 * 之後真的需要時，走另一個可選介面，不要污染主介面。
 */
export type FullConversation = Conversation
