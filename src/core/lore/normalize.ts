import { type Lorebook, LEGACY_ST_SCAN_DEPTH } from './types'

/**
 * 載入時的正規化 —— 純函式，由平台層在讀檔後套用。
 *
 * 目前只做一件事：把 B2.6 開發期間 DeST 自建的書寫死的 `scan_depth: 5`
 * 改回「跟隨上下文」（`0`）。當時那個值是照抄 ST 預設，但 DeST 從未把這個欄位開放給使用者調，
 * 留著只會讓已經在 prompt 裡的訊息掃不到（見 `DEFAULT_SCAN_DEPTH` 的說明）。
 *
 * **只動 `_passthrough` 為空的書**：ST 匯入的書幾乎都會帶上本引擎不認識的欄位，
 * 以此區分「使用者刻意設定的 5」與「DeST 自己寫進去的 5」。
 * 判斷不到 100% 精準，但誤判的方向是放寬掃描範圍，與新預設一致。
 */
export function normalizeLorebook(book: Lorebook): Lorebook {
  if (book.scan_depth === LEGACY_ST_SCAN_DEPTH && book._passthrough === undefined) {
    return { ...book, scan_depth: 0 }
  }
  return book
}
