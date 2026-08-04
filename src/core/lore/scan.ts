import {
  type Lorebook,
  type LoreEntry,
  DEFAULT_PRIORITY,
  DEFAULT_SCAN_DEPTH,
  DEFAULT_TOKEN_BUDGET
} from './types'

/**
 * Lorebook 掃描與裁切 —— 零 I/O 純函式（規格 `docs/future-lorebook.md` §5.3／§6）。
 *
 * 呼叫端負責「掃描文字怎麼來」（要用 `contextMessages()` 的結果，見規格 §6.2），
 * 這裡只負責「給定文字，哪些條目該進去、順序如何、超預算砍誰」。
 */

/** 掃描文字的組成來源（規格 §6.3）。 */
export interface ScanTextParts {
  /** 記憶摘要；術語很可能只留在摘要裡，故納入掃描 */
  summary?: string
  /**
   * 已經過 `contextMessages()` 過濾的近期訊息內容（舊 → 新）。
   * **必須是實際會送進上下文的那批**，否則會出現「角色手上沒有那段對話，
   * 卻收到對應的術語解說」。
   */
  recentContents?: string[]
  /** 使用者這一句（尚未進 messages 時傳這裡） */
  currentInput?: string
}

/**
 * 依 `scan_depth` 取近期訊息的後 N 則，接上摘要與當前輸入，組成掃描文字。
 *
 * `scanDepth` 是在 `keepRecentN` **之內**再取後 N 則，不會超出上下文範圍。
 * **`0`／負數／NaN ＝ 跟隨上下文**，`recentContents` 全取（見 `DEFAULT_SCAN_DEPTH`）。
 */
export function buildScanText(parts: ScanTextParts, scanDepth: number = DEFAULT_SCAN_DEPTH): string {
  const depth = Number.isFinite(scanDepth) && scanDepth > 0 ? Math.floor(scanDepth) : 0
  const recent = (parts.recentContents ?? []).filter(s => typeof s === 'string' && s.length > 0)
  const tail = depth === 0 || depth >= recent.length ? recent : recent.slice(recent.length - depth)
  return [parts.summary ?? '', ...tail, parts.currentInput ?? '']
    .map(s => (s ?? '').trim())
    .filter(Boolean)
    .join('\n')
}

function hitsAnyKey(scanText: string, lowerScanText: string, keys: string[], caseSensitive: boolean): boolean {
  for (const raw of keys) {
    const key = (raw ?? '').trim()
    if (!key) continue
    if (caseSensitive) {
      if (scanText.includes(key)) return true
    } else if (lowerScanText.includes(key.toLowerCase())) {
      return true
    }
  }
  return false
}

/**
 * 單一條目是否觸發。
 *
 * - `constant` 為 true → 一律觸發，不看關鍵字
 * - 否則 `keys` 任一命中即觸發
 * - `selective` 且 `secondary_keys` 非空 → keys 命中後還要 secondary_keys 也命中（AND）
 */
export function matchesEntry(entry: LoreEntry, scanText: string, lowerScanText?: string): boolean {
  if (!entry.enabled) return false
  if (entry.constant) return true

  const lower = lowerScanText ?? scanText.toLowerCase()
  const caseSensitive = entry.case_sensitive === true
  if (!hitsAnyKey(scanText, lower, entry.keys ?? [], caseSensitive)) return false

  const secondary = (entry.secondary_keys ?? []).filter(k => (k ?? '').trim().length > 0)
  if (entry.selective && secondary.length > 0) {
    return hitsAnyKey(scanText, lower, secondary, caseSensitive)
  }
  return true
}

/** 條目的預算佔用（字元數近似，非真 token）。 */
export function entryCost(entry: LoreEntry): number {
  return (entry.content ?? '').trim().length
}

export interface SelectLoreOptions {
  /**
   * 注入上限（字元數）。未給時取參與的 lorebook 中**最大**的 `token_budget` ——
   * 一本書的小上限不該把另一本書的條目連坐砍掉。全部沒有時用 `DEFAULT_TOKEN_BUDGET`。
   */
  budgetChars?: number
}

/**
 * 選出這一輪要注入的條目。
 *
 * 順序：`books` 的傳入順序即優先順序（規格 §4.2：角色卡的排在世界觀之前），
 * 同一本內依 `insertion_order` 由小到大，同值時維持原始順序（穩定）。
 *
 * 超出預算時**先砍低 `priority`**；同 `priority` 砍排在後面的。
 * 砍完後回傳的仍是排序後的順序。
 */
export function selectLoreEntries(
  books: Lorebook[],
  scanText: string,
  opts: SelectLoreOptions = {}
): LoreEntry[] {
  const lower = (scanText ?? '').toLowerCase()

  // 1. 攤平 + 觸發判定。bookIndex／seq 一起帶著，作為穩定排序的次要鍵。
  const hits: { entry: LoreEntry; bookIndex: number; seq: number }[] = []
  let seq = 0
  books.forEach((book, bookIndex) => {
    for (const entry of book?.entries ?? []) {
      if (matchesEntry(entry, scanText ?? '', lower)) {
        hits.push({ entry, bookIndex, seq: seq++ })
      }
    }
  })
  if (hits.length === 0) return []

  // 2. 排序：書的順序 → insertion_order → 原始順序
  const ordered = hits.slice().sort((a, b) => {
    if (a.bookIndex !== b.bookIndex) return a.bookIndex - b.bookIndex
    const oa = a.entry.insertion_order ?? 0
    const ob = b.entry.insertion_order ?? 0
    if (oa !== ob) return oa - ob
    return a.seq - b.seq
  })

  // 3. 預算裁切
  const budget = resolveBudget(books, opts.budgetChars)
  let total = ordered.reduce((sum, h) => sum + entryCost(h.entry), 0)
  if (total <= budget) return ordered.map(h => h.entry)

  // 砍的順序：priority 小的先砍；同 priority 砍排序後面的
  const victims = ordered
    .map((h, index) => ({ ...h, index }))
    .sort((a, b) => {
      const pa = a.entry.priority ?? DEFAULT_PRIORITY
      const pb = b.entry.priority ?? DEFAULT_PRIORITY
      if (pa !== pb) return pa - pb
      return b.index - a.index
    })

  const dropped = new Set<number>()
  for (const victim of victims) {
    if (total <= budget) break
    dropped.add(victim.index)
    total -= entryCost(victim.entry)
  }

  return ordered.filter((_, index) => !dropped.has(index)).map(h => h.entry)
}

function resolveBudget(books: Lorebook[], override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override
  let max = -1
  for (const book of books) {
    const b = book?.token_budget
    if (typeof b === 'number' && Number.isFinite(b) && b >= 0 && b > max) max = b
  }
  return max >= 0 ? max : DEFAULT_TOKEN_BUDGET
}

/**
 * 參與掃描的 lorebook 共同的掃描深度（決定要取幾則訊息）。
 *
 * 取各本中**要求最多**的那個：只要有一本是「跟隨上下文」（`0`／未設），結果就是 `0`
 * ——一本書的小視窗不該把另一本書的觸發範圍連坐縮掉，比照 `token_budget` 取最大的邏輯。
 */
export function resolveScanDepth(books: Lorebook[]): number {
  let max = 0
  for (const book of books) {
    const d = book?.scan_depth
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return 0
    if (d > max) max = Math.floor(d)
  }
  return max > 0 ? max : DEFAULT_SCAN_DEPTH
}
