/**
 * 「貼網址讓角色讀內文」的型別與設定（2026-09-13）。
 *
 * 範圍刻意只做**公開網頁**：需要登入才看得到的頁面（社群貼文、私人文件）
 * 一律讀不到，而且是設計如此不是 bug——抓取是從 Electron 主行程／手機原生層
 * 發出的，那邊沒有、也拿不到使用者瀏覽器的 cookie。要支援登入牆得另外走
 * 「App 內建瀏覽器登入」或「瀏覽器擴充功能」，兩條都是獨立的大工程。
 */

/**
 * 連結閱讀設定（型別本體在 `core/types.ts`，跟其他模組設定放一起）。
 *
 * ⚠️ **刻意只有一個欄位**：能調的數字（一次最多讀幾個連結、多長才丟輔助模型
 * 濃縮）全部寫成常數。模組底下多一個子設定，就多一個 S2 M5 同步子集要記得
 * 補的欄位——`weather.polish` 那次就是這樣漏掉的（CLAUDE.md §4）。開關本身
 * 走既有的「模組開關」清單（`desktopst.link-reader`），那條路同步早就通了。
 */
import type { LinkReaderSettings } from '../types'

export type { LinkReaderSettings }

export const DEFAULT_LINK_READER_SETTINGS: LinkReaderSettings = { enabled: true }

export function normalizeLinkReaderSettings(raw: Partial<LinkReaderSettings> | undefined): LinkReaderSettings {
  return { enabled: raw?.enabled !== false }
}

/**
 * 一個連結的處理結果。
 *
 * `status` 不只是 log——**讀不到的連結也要進 prompt**，明講「這個沒讀到」，
 * 否則模型會照著網址猜內容講得煞有其事（貼網址最怕的就是這個）。
 */
export type LinkFetchStatus =
  /** 成功拿到正文 */
  | 'ok'
  /** 社群／影片站：內文由 JS 產生或需要登入，抓 HTML 一定是空殼，連試都不試 */
  | 'js-rendered'
  /** 內網／本機位址，不抓 */
  | 'private-host'
  /** 抓到了但看起來是登入牆／付費牆 */
  | 'login-required'
  /** 對方明確擋下（401／403／429） */
  | 'blocked'
  /** PDF、圖片等非 HTML */
  | 'unsupported-type'
  /** 連不上、逾時、其他 HTTP 錯誤 */
  | 'fetch-failed'
  /** 抓到了、也不是登入牆，但抽不出足夠的正文 */
  | 'empty'

export interface LinkFetchOutcome {
  url: string
  /** 頁面標題；抓不到時是空字串 */
  title: string
  status: LinkFetchStatus
  /** `status === 'ok'` 時的正文（已裁切或濃縮過） */
  text?: string
  /** 這一則有沒有打輔助模型濃縮 */
  usedUtility: boolean
  /**
   * 抓到的東西是哪一種。
   *
   * `video-description` ＝ 影片的**說明欄**，不是影片內容本身（YouTube）。
   * 注入時一定要講明，否則角色會照著說明裝作看過影片——跟「不要憑網址
   * 猜內容」是同一類問題。未設定時視為 `page`（一般網頁正文）。
   *
   * `social-post` ＝ 社群貼文的完整內容（噗浪、FB 粉專貼文、Threads）。
   * `social-excerpt` ＝ **只有預覽摘要**（FB 社團貼文，以及嵌入失敗退回 og 的
   * 情況）。後者結尾是 `...`，注入時一定要標「這不是全文」——否則角色會把
   * 一段被腰斬的貼文當完整內容認真討論，跟 `video-description` 同一類問題。
   */
  sourceKind?: 'page' | 'video-description' | 'social-post' | 'social-excerpt'
}

export interface LinkContextResult {
  /** 要注入 system context 的字串；沒有任何連結時是 null */
  context: string | null
  outcomes: LinkFetchOutcome[]
}
