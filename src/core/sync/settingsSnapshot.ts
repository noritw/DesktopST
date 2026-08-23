import { sha1Hex } from '../util/sha1'
import { stableStringify } from '../util/stableJson'

/**
 * 設定同步的比對子集（S2 M5）。
 *
 * ⚠️ **這是這個子集唯一的定義**，桌面端（`main/mobileServer.ts` 的
 * `buildSettingsManifestHash`／新的 `GET /api/settings/sync-snapshot`）與手機端
 * （`mobile/runtime/syncManifest.ts` 的 `buildLocalManifest`、新的
 * `buildLocalSettingsSnapshot`）都要 import 這裡，不要各自組一份物件字面量。
 *
 * 這條規矩是從 M4 的教訓來的：`contentHash.ts` 在改之前，桌面與手機的
 * `settingsHash` 子集是兩邊分別手打的物件字面量，欄位只要漂移一個，
 * 雜湊就永遠對不起來——而且不會有任何錯誤訊息，使用者只會看到「設定一直
 * 顯示不同步」。同一份定義，兩端 import，這個錯誤類別直接消失。
 *
 * 只放「使用者在乎、而且值得為它多按一次同步」的欄位。API Key **不在這裡**——
 * S2 任何情況都不碰金鑰（roadmap §4.7），子集裡連欄位都不能出現。
 */

/** provider 順序固定，UI 逐 provider 顯示模型比對列時用同一個順序，不要動態排序造成畫面跳動。 */
export const SYNC_LLM_PROVIDERS = ['openai', 'claude', 'gemini', 'grok', 'local'] as const

export interface LlmSyncSubset {
  provider: string
  /** 每個供應商各自記住的模型；比對時逐 provider 拆成一列，不是整包比。 */
  models: Record<string, string>
  /**
   * 每個供應商各自的端點；比照 `models` 逐 provider 拆成一列。
   *
   * ⚠️ **本機端點同步過去不一定連得到**：手機在外面時 `localhost:11434`
   * 指向手機自己、內網 IP 也不通。但仍然要同步——使用者回到家就會通，
   * 而且「同步了卻連不上」比「兩邊設定不一樣、要手動再填一次」好懂。
   * 連不連得上是連線測試的事，不是同步該擋的。
   */
  endpoints: Record<string, string>
  /** 附加在 system prompt 尾端的自訂指示，對所有供應商生效。 */
  extraInstruction: string
  maxResponseTokens: number
  maxGroupRounds: number
  maxImagesPerMessage: number
  /**
   * 輔助模型（提醒發話、情緒分類、天氣潤飾）的設定（§2.1，2026-08-17）。
   *
   * 跟 `provider`／`models`／`endpoints` 是同一張表的另外幾欄——`utilityProvider`
   * 沒設定時 `applyUtilitySettings()` 會跟隨 `provider`，換句話說這組欄位跟
   * `endpoints` 共用同一份端點表，只同步 `endpoints` 不同步這幾欄，使用者會看到
   * 「輔助模型端點跟著換了，但供應商／模型本身沒有」這種一半同步的怪狀態。
   */
  utilityEnabled: boolean
  utilityProvider: string
  /** 每個供應商各自記住的輔助模型；比照 `models` 逐 provider 拆成一列。 */
  utilityModels: Record<string, string>
}

/**
 * ⚠️ **只有這三欄，不要把整包 `settings.memory` 塞進來**。
 * `settings.memory` 還有第四個欄位 `keepDebugPromptN`（桌面 Log 視窗專用，手機沒有
 * 對應 UI），而桌面端 `getMemorySettingsDirect()` 只回這三欄——手機那邊 2026-08-23
 * 之前直接寫 `memory: session.settings.memory`，多帶一個欄位進來，於是
 * `settingsSnapshotHash()` **永遠對不起來**，摘要一直說「設定不同步」但逐欄看每列都相同
 * （逐欄比對只挑這三欄，所以畫面上看不出原因）。這正是本檔檔頭警告的那個錯誤類別。
 */
export interface MemorySyncSubset {
  keepRecentN: number
  autoSummarizeAfter: number
  autoSummarizeEnabled: boolean
}

export interface ModuleSyncItem {
  id: string
  label: string
  enabled: boolean
}

/**
 * 天氣模組的子設定。**`polish` 之外只加 `realtimeQuery.enabled`／`forecastCounty`**——
 * `enabled`（天氣模組總開關）走 `modules` 那組既有的開關列，位置座標／地名／
 * 定位來源刻意不在這裡：CLAUDE.md §4 天氣段落「地點不帶：手機會移動、也有
 * GPS，帶座標只會讓它出門顯示家裡的天氣」，S1 初始化匯入就已經是這個規則，
 * 設定同步沒有理由破例。
 *
 * `realtimeQuery.cwaApiKey` **絕對不進這裡**——S2 任何情況都不碰金鑰
 * （roadmap §4.7），子集裡連欄位都不能出現。金鑰本身的實際傳輸走既有的
 * S1 一次性匯入（區網直連才附值，見 `getWeatherSyncSettingsDirect`），
 * 這裡只同步「要不要開」「用哪個縣市」這兩個非機密欄位。
 */
export interface WeatherSyncSubset {
  polish: boolean
  realtimeQueryEnabled: boolean
  realtimeQueryForecastCounty: string
}

/**
 * 新聞模組的子設定。`speakButton` ＋ **對話新聞搜尋那三欄**——其餘欄位（`langMode`／`replyModel`／
 * `maxAgeDays`／`readerMaxItems` 等）手機端目前**沒有讀寫路徑**：
 * `NewsApi.getSettings()/saveSettings()`（`session.getNewsEditableSettings()`）
 * 本身就只認 `enabled`／`sources`／`keywordGroups`／`blacklist`／`speakButton`
 * 這五個欄位，桌面端 `POST /api/news/settings` 的白名單也是同一組——同步一個
 * 兩端都碰不到的欄位沒有意義。`sources`／`keywordGroups`／`blacklist` 是清單／
 * 聯集型，owner 2026-08-17 決定先擱著（見 `docs/handoff/module-settings-audit.md`）。
 */
export interface NewsSyncSubset {
  speakButton: string
  /**
   * 對話新聞搜尋（2026-08-23 補進來）。這三欄是 2026-08-22 加的，而且**手機端本來就
   * 可以編輯**（owner 當時特別要求開放），卻沒有一起進比對子集——症狀跟
   * `weather.polish` 那次一模一樣：兩台裝置各自為政，比對畫面連一列都不會出現。
   * 「模組除了 `enabled` 還有自己的子設定」這個坑第二次踩到，加欄位時記得回頭看這裡。
   */
  conversationSearchEnabled: boolean
  /**
   * 觸發詞清單。**`SettingsFieldRow` 的值只能是純量**（`settingsPair.ts`），
   * 所以這裡存成串好的單一字串，兩端一律走 `joinTriggerWords()`／`splitTriggerWords()`，
   * 不要有人自己 `join(',')`——分隔符一旦不一致，雜湊永遠對不起來。
   */
  conversationSearchTriggerWords: string
  /** 查詢時效（小時）；0 ＝ 不限制。 */
  conversationSearchMaxAgeHours: number
}

/** 觸發詞的串接分隔符。改這個會讓所有既有比對結果一次全變「不同」，不要隨手動。 */
const SEP = '\n'

/** 觸發詞陣列 → 比對用字串。兩端共用，見 `NewsSyncSubset.conversationSearchTriggerWords`。 */
export function joinTriggerWords(words: readonly string[] | undefined): string {
  return (words ?? []).map((w) => w.trim()).filter(Boolean).join(SEP)
}

/** 比對用字串 → 觸發詞陣列。`joinTriggerWords()` 的反向。 */
export function splitTriggerWords(joined: string): string[] {
  return joined.split(SEP).map((w) => w.trim()).filter(Boolean)
}

/**
 * 外觀裡跟 `colorTheme` 同一類的純偏好：兩邊都有這個功能、語意完全一致，
 * 只是原本跟 `colorTheme` 沒放進同一組定義（§2.2，2026-08-17）。
 */
export interface AppearanceSyncSubset {
  showLlmBadge: boolean
  showPersonaName: boolean
}

export interface SettingsSnapshot {
  llm: LlmSyncSubset
  memory: MemorySyncSubset
  colorTheme: string
  modules: ModuleSyncItem[]
  weather: WeatherSyncSubset
  news: NewsSyncSubset
  appearance: AppearanceSyncSubset
}

export function settingsSnapshotHash(snapshot: SettingsSnapshot): string {
  return sha1Hex(stableStringify(snapshot))
}
