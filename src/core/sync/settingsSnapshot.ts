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
}

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
 * 天氣模組的子設定。**只有 `polish`**——`enabled` 走 `modules` 那組既有的
 * 開關列，位置座標／地名／定位來源刻意不在這裡：CLAUDE.md §4 天氣段落
 * 「地點不帶：手機會移動、也有 GPS，帶座標只會讓它出門顯示家裡的天氣」，
 * S1 初始化匯入就已經是這個規則，設定同步沒有理由破例。
 */
export interface WeatherSyncSubset {
  polish: boolean
}

export interface SettingsSnapshot {
  llm: LlmSyncSubset
  memory: MemorySyncSubset
  colorTheme: string
  modules: ModuleSyncItem[]
  weather: WeatherSyncSubset
}

export function settingsSnapshotHash(snapshot: SettingsSnapshot): string {
  return sha1Hex(stableStringify(snapshot))
}
