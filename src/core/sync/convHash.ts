// ⚠️ 這個檔案會被 Electron 主行程 import（`main/mobileServer.ts` 的
// `/api/sync-manifest`），而 main 的建置沒有 `@core` alias（見
// `electron.vite.config.ts`——只有 renderer 有）。core/ 裡凡是主行程也會用到的
// 模組一律走相對路徑，不要用 `@core/…`，否則桌面端建置會直接解析失敗。
import { sha1Hex } from '../util/sha1'
import { stableStringify } from '../util/stableJson'
import type { Conversation } from '../types'

/**
 * S2 對話同步：跨裝置的對話指紋。
 *
 * ## 為什麼不沿用 `contentHash.ts`
 *
 * 那支算的是「這一筆實體的內容是不是同一份」，用在角色／情境那類**整份覆蓋**
 * 的資料上。對話不是那樣：它是 append-only 的訊息集合，兩邊各自往後長，
 * 「內容不同」是**常態而不是衝突**——正確的處置是聯集合併，不是叫使用者選一邊。
 *
 * 所以對話要的不是「一樣／不一樣」，而是「**兩邊各自多了哪些**」。這支只算
 * 訊息 id 集合的指紋，用來快速判斷「完全相同、這列不必顯示」；真正要合併時
 * 再逐則比對 id。
 *
 * ## 為什麼只雜湊 id、不碰內容
 *
 * 訊息帶圖片 data URI，單則就可能好幾 MB。清單端點的存在意義就是**不傳內容**
 * （§6.2），把整份訊息內容雜湊一次等於在電腦端把整個資料庫讀進記憶體，
 * 而換來的資訊（「有某則被編輯過」）在這一版根本不影響決策——同 id 的衝突
 * 一律由接收端保留自己那份，不需要事先知道。
 *
 * ## 摘要為什麼分開算
 *
 * `summary` 是單值欄位，走的是「二選一」而不是聯集，跟訊息完全不同的合併規則
 * （§6.2 ② 規則 4）。混進同一個雜湊的話，只改了摘要的對話會被誤判成
 * 「訊息也不同」而觸發整套合併流程。
 *
 * ⚠️ **算法只有這一份。** 桌面端（`main/mobileServer.ts` 的 `/api/sync-manifest`）
 * 與手機端（`mobile/runtime/syncManifest.ts` 的 `buildLocalManifest`）都 import 它，
 * 不各自抄一份——`contentHash.ts` 與 `settingsSnapshot.ts` 都踩過「兩邊手打、
 * 漂移一個欄位、使用者看到一整頁假衝突而且零錯誤訊息」這個坑。
 */

/**
 * 訊息 id 集合的指紋。**排序後才雜湊**：兩邊的訊息順序可能不同
 * （各自追加、時間戳交錯），但集合相同就該判成一樣。
 */
export function messageIdsHash(messages: { id: string }[]): string {
  return sha1Hex(stableStringify([...messages.map((m) => m.id)].sort()))
}

/** 摘要內容的指紋。沒有摘要時回空字串（跟「有一份空摘要」在語意上等價）。 */
export function summaryHash(summary: string | undefined): string {
  const text = String(summary ?? '').trim()
  return text ? sha1Hex(text) : ''
}

/** 清單端點要帶的對話指紋欄位。 */
export interface ConversationFingerprint {
  messageIdsHash: string
  summaryHash: string
  summaryCoversTs?: number
}

export function conversationFingerprint(conv: Conversation): ConversationFingerprint {
  return {
    messageIdsHash: messageIdsHash(conv.messages ?? []),
    summaryHash: summaryHash(conv.summary),
    summaryCoversTs: conv.summaryCoversTs
  }
}

/**
 * 合併兩側訊息。**這是聯集，不是二選一。**
 *
 * 規則見 `docs/mobile-mode-switch-sync.md` §6.2 ②：
 * - 以 message id 聯集，`base` 已經有的 id 直接略過（同 id 內容不同時
 *   **保留 `base` 那份**——接收端的版本優先，不做欄位級合併）
 * - 合併後按 `timestamp` 重排，相同時用 id 當穩定 tiebreak
 *
 * 那個 tiebreak 不是可有可無的：少了它，兩台裝置對同時間戳的訊息會排出不同
 * 順序，雖然集合一樣、指紋也一樣，但使用者看到的對話順序在兩邊不同。
 */
export function mergeMessages<T extends { id: string; timestamp: number }>(
  base: T[],
  incoming: T[]
): { merged: T[]; written: number; skipped: number } {
  const have = new Set(base.map((m) => m.id))
  const added: T[] = []
  let skipped = 0
  for (const m of incoming) {
    if (have.has(m.id)) {
      skipped++
      continue
    }
    have.add(m.id)
    added.push(m)
  }
  const merged = [...base, ...added].sort(
    (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0) || a.id.localeCompare(b.id)
  )
  return { merged, written: added.length, skipped }
}

/**
 * 摘要二選一：取 `summaryCoversTs` 較大的那份。
 *
 * ⚠️ **不能用 `updatedAt` 判斷誰比較新**——那是寫檔時間，推送本身就會把接收端
 * 設成現在，推完永遠是對面比較新（`mobile-sync-m4-compare.md` §2.2）。
 * `summaryCoversTs` 是「摘要涵蓋到最後一則訊息的時間戳」，從訊息推導而來，
 * 跨裝置可比。
 *
 * 兩邊涵蓋範圍相同但內容不同時回 `'ambiguous'`：沒有客觀上比較好的那份，
 * 要讓使用者選（比對畫面會長出一個子列）。
 */
export type SummaryWinner = 'base' | 'incoming' | 'equal' | 'ambiguous'

export function pickSummary(
  base: { summary?: string; summaryCoversTs?: number },
  incoming: { summary?: string; summaryCoversTs?: number }
): SummaryWinner {
  const a = summaryHash(base.summary)
  const b = summaryHash(incoming.summary)
  if (a === b) return 'equal'
  // 只有一邊有摘要 → 有的那邊贏，不必問使用者（另一邊是「還沒摘要過」，不是意見）
  if (!a) return 'incoming'
  if (!b) return 'base'
  const ta = base.summaryCoversTs ?? 0
  const tb = incoming.summaryCoversTs ?? 0
  if (ta > tb) return 'base'
  if (tb > ta) return 'incoming'
  return 'ambiguous'
}
