import {
  type Lorebook,
  type LoreEntry,
  DEFAULT_SCAN_DEPTH,
  DEFAULT_TOKEN_BUDGET,
  LoreError
} from './types'

/**
 * SillyTavern `character_book` ↔ `Lorebook` 對映（規格 §5.2）。
 *
 * **引擎只實作子集，但格式吃全套**：不認識的欄位（`position` / `extensions` /
 * `recursive_scanning` / `use_regex` …）一律收進 `_passthrough`，匯出時原樣吐回。
 * ST → DeST → ST 來回不掉資料；日後要補完整實作時不必改格式、不必再遷移一次。
 *
 * 錯誤只給代碼，中文文案由平台層翻（比照 `PngCardError`）。
 */

type AnyRecord = Record<string, unknown>

/** 本引擎會消化掉的條目欄位；其餘進 `_passthrough`。 */
const KNOWN_ENTRY_FIELDS = new Set([
  'id', 'keys', 'content', 'enabled', 'constant', 'case_sensitive',
  'insertion_order', 'priority', 'secondary_keys', 'selective', 'comment'
])

/** 本引擎會消化掉的書層級欄位；其餘進 `_passthrough`。 */
const KNOWN_BOOK_FIELDS = new Set(['name', 'entries', 'scan_depth', 'token_budget'])

function asRecord(v: unknown): AnyRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  return v as AnyRecord
}

function trimStr(v: unknown): string {
  return String(v ?? '').trim()
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(x => trimStr(x)).filter(Boolean)
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** 未列在 known 名單裡的欄位；沒有多餘欄位時回 undefined（不留空物件）。 */
function collectPassthrough(source: AnyRecord, known: Set<string>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  let count = 0
  for (const [k, v] of Object.entries(source)) {
    if (known.has(k)) continue
    out[k] = v
    count++
  }
  return count > 0 ? out : undefined
}

export interface ImportLorebookOptions {
  /** 本書在 DeST 的 id（由呼叫端產生，core 不生亂數） */
  id: string
  /** 來源沒有 `name` 時的後備名稱（例：角色名）。core 不寫死中文，故不給預設文案 */
  fallbackName?: string
  /** 時間戳；測試可注入 */
  now?: number
  /** 條目 id 產生器；預設用來源 id，沒有則用索引 */
  makeEntryId?: (index: number, raw: AnyRecord) => string
}

/** 把 ST `character_book`（或獨立的 lorebook JSON）轉成 `Lorebook`。 */
export function importStLorebook(raw: unknown, opts: ImportLorebookOptions): Lorebook {
  const book = asRecord(raw)
  if (!book || !Array.isArray(book.entries)) {
    throw new LoreError('not-a-lorebook', 'Object has no `entries` array; not a character_book')
  }

  const now = opts.now ?? Date.now()
  const entries = (book.entries as unknown[]).map((e, index) => importEntry(e, index, opts))

  return {
    id: opts.id,
    name: trimStr(book.name) || trimStr(opts.fallbackName),
    entries,
    // 原檔有寫就照它的值（ST 相容）；沒寫＝跟隨上下文
    scan_depth: toFiniteNumber(book.scan_depth) ?? DEFAULT_SCAN_DEPTH,
    token_budget: toFiniteNumber(book.token_budget) ?? DEFAULT_TOKEN_BUDGET,
    createdAt: now,
    updatedAt: now,
    _passthrough: collectPassthrough(book, KNOWN_BOOK_FIELDS)
  }
}

function importEntry(rawEntry: unknown, index: number, opts: ImportLorebookOptions): LoreEntry {
  const e = asRecord(rawEntry) ?? {}
  const sourceId = trimStr(e.id)
  const id = opts.makeEntryId ? opts.makeEntryId(index, e) : (sourceId || String(index))

  return {
    id,
    keys: toStringArray(e.keys),
    content: typeof e.content === 'string' ? e.content : trimStr(e.content),
    // ST 慣例：沒寫 enabled 視為啟用
    enabled: e.enabled === undefined ? true : e.enabled !== false,
    constant: e.constant === true,
    case_sensitive: typeof e.case_sensitive === 'boolean' ? e.case_sensitive : undefined,
    insertion_order: toFiniteNumber(e.insertion_order) ?? index,
    priority: toFiniteNumber(e.priority),
    secondary_keys: Array.isArray(e.secondary_keys) ? toStringArray(e.secondary_keys) : undefined,
    selective: typeof e.selective === 'boolean' ? e.selective : undefined,
    comment: e.comment === undefined ? undefined : trimStr(e.comment),
    _passthrough: collectPassthrough(e, KNOWN_ENTRY_FIELDS)
  }
}

/**
 * 從 ST 角色卡（`chara_card_v2`）取出 `character_book`；沒有則回 `null`。
 *
 * 目前 `stCardMapper.importStJson` 會把它靜默丟棄（規格 §2），
 * 匯入流程要自己呼叫這支撈出來另存一本。
 */
export function extractCharacterBook(rawCard: unknown): unknown | null {
  const root = asRecord(rawCard)
  if (!root) return null
  const data = asRecord(root.data) ?? root
  const book = asRecord(data.character_book)
  return book ?? null
}

/**
 * 轉回 ST `character_book` 物件（呼叫端自行 `JSON.stringify`）。
 *
 * `_passthrough` 先鋪底再由已知欄位覆蓋 —— 已知欄位以 DeST 這邊的值為準。
 */
export function exportStLorebook(book: Lorebook): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...(book._passthrough ?? {}),
    name: book.name,
    token_budget: book.token_budget,
    entries: (book.entries ?? []).map(exportStEntry)
  }
  // 「跟隨上下文」是 DeST 專屬語意，ST 沒有對應值（那邊 0 會被讀成「不掃描」）→ 整個欄位不輸出，
  // 讓 ST 套用它自己的預設。原檔若帶過 scan_depth，_passthrough 不含此欄故不會被還原。
  if (book.scan_depth > 0) out.scan_depth = book.scan_depth
  return out
}

function exportStEntry(entry: LoreEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ...(entry._passthrough ?? {}),
    // 來源若是數字 id 就吐回數字（ST 的慣例），否則原樣給字串
    id: /^-?\d+$/.test(entry.id) ? Number(entry.id) : entry.id,
    keys: entry.keys ?? [],
    content: entry.content ?? '',
    enabled: entry.enabled,
    constant: entry.constant,
    insertion_order: entry.insertion_order
  }
  if (entry.case_sensitive !== undefined) out.case_sensitive = entry.case_sensitive
  if (entry.priority !== undefined) out.priority = entry.priority
  if (entry.secondary_keys !== undefined) out.secondary_keys = entry.secondary_keys
  if (entry.selective !== undefined) out.selective = entry.selective
  if (entry.comment !== undefined) out.comment = entry.comment
  return out
}
