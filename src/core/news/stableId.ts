import { sha1Hex } from '../util/sha1'

/**
 * 同一篇 URL / guid 永遠算出同一個 id（news-feed-spec §4 規則）。
 *
 * ⚠️ **這個值會被寫進使用者資料**（`seenIds`、新聞報的釘選與「不看了」都以它當鍵），
 * 所以演算法與截斷長度都**不可以再改**——改了等於那些狀態靜默失效。
 */
export function stableId(prefix: string, key: string): string {
  return `${prefix}-${sha1Hex(key).slice(0, 12)}`
}
