import type { Manifest, ManifestEntity } from './types'


/**
 * S2 M4 逐項比對（取代 M3 的「整包帶過去」）。
 *
 * ## 為什麼不繼續用 `diff.ts` 的基準比對
 *
 * `computeDiff()` 判斷「兩邊是不是同一個東西」完全押在 `sync-baseline.json`
 * 的 id 對應表上。而那張表在 M3 是**寫錯的**：`syncPush.ts` 推完之後記
 * `remoteId: id`（手機自己的 id），但電腦端 `savePersonaPresetDirect()` 的
 * 寫法是 `id: existing?.id ?? uuidv4()` —— 電腦上沒有那個 id 就丟掉手機送來的
 * id、自己發一顆新的。於是基準每一筆都指向電腦上不存在的 id，`computeDiff`
 * 永遠判成「電腦上沒有這筆」，每推一次就多一份重複。owner 2026-08-13 的
 * 電腦上因此長出 23 個情境（真正的只有 7 個）、各 10 份的世界觀與使用者設定。
 *
 * 基準壞掉之後**沒有任何自我修復路徑**——它只會愈錯愈多。所以 M4 改成
 * **每次切換當下即時配對**：身分由「id 相同」或「名稱相同」當場判定，
 * 不依賴任何歷史記錄。基準退化成純粹的最佳化提示（可有可無），
 * 就算整份是錯的也不會再累積傷害。
 *
 * ## 配對規則（owner 2026-08-13 拍板：「名稱／ID 相同視為同個物件」）
 *
 * 1. 先做 id 精確配對。
 * 2. 剩下的用正規化名稱（去頭尾空白＋轉小寫）配對。
 * 3. 同一側有多筆同名時，照 `updatedAt` 由新到舊依序配對，多出來的自成一列。
 */

/** 比對用的實體描述。`contentHash` 沒有時退化成「無法判定內容是否相同」。 */
export interface PairEntity extends ManifestEntity {
  /** 內容雜湊，見 `contentHash.ts`。兩邊都有值才能判斷內容一不一樣。 */
  contentHash?: string
}

/** 一列比對結果：左邊手機、右邊電腦。 */
export interface PairRow {
  /** React key 用的穩定字串。 */
  key: string
  /** 顯示用名稱（兩邊都有且不同名時是不可能的——配對就是靠名字或 id）。 */
  name: string
  /** 電腦端的名稱，只有在「id 相同但名字被改過」時才和 `name` 不同。 */
  remoteName?: string

  localId?: string
  remoteId?: string
  localUpdatedAt?: number
  remoteUpdatedAt?: number

  /**
   * 兩邊都有時的內容比對結果：
   * - `'same'`：內容雜湊相同，這列不需要動
   * - `'differs'`：雜湊不同，要使用者選一邊
   * - `'unknown'`：至少一邊沒有雜湊（舊版電腦端），無法判定 → 當成要使用者選
   *
   * 只有一邊有的列不設這個欄位。
   */
  compare?: 'same' | 'differs' | 'unknown'
}

/**
 * 使用者對一列的決定。語意一律是「**以這一邊為準**」——包含那一邊是空的情況。
 *
 * | 選了 | 兩邊都有 | 只有手機 | 只有電腦 |
 * |---|---|---|---|
 * | `local` | 覆蓋電腦 | 推過去 | **刪掉電腦那份** |
 * | `remote` | 覆蓋手機 | **刪掉手機那份** | 拉回來 |
 * | `keep` | 不動 | 不動 | 不動 |
 *
 * 「選了空的那一邊 ＝ 刪除」是 owner 2026-08-14 要求的：在電腦上刪掉測試資料後，
 * 想讓手機跟著刪，但那一列的電腦側是空的、按鈕原本是停用的，沒有任何辦法表達
 * 「我要的就是沒有」。UI 必須把這種選取畫成**警告色**並在同步前**再確認一次**
 * （`SyncComparePicker.tsx`）——這是這個畫面唯一會刪東西的路徑。
 */
export type PairChoice =
  /** 以手機為準 */
  | 'local'
  /** 以電腦為準 */
  | 'remote'
  /** 這列不動（兩邊各自維持原狀） */
  | 'keep'

export const KINDS = ['characters', 'personas', 'worlds', 'scenes', 'lorebooks', 'reminders'] as const
export type PairKind = (typeof KINDS)[number]

/** 每個 collection 一組列。 */
export type PairTable = Record<PairKind, PairRow[]>

/** key → 使用者的決定。 */
export type ChoiceMap = Record<PairKind, Record<string, PairChoice>>

export function normalizeName(name: string): string {
  return String(name ?? '').trim().toLowerCase()
}

/**
 * 配對單一 collection。
 *
 * 回傳順序刻意固定：先「兩邊都有」（依名稱），再「只有手機」，最後「只有電腦」——
 * UI 靠這個順序分段顯示，不必自己排。
 */
export function pairCollection(local: PairEntity[], remote: PairEntity[]): PairRow[] {
  const rows: PairRow[] = []
  const usedRemote = new Set<string>()

  const remoteById = new Map(remote.map((r) => [r.id, r]))

  const makeRow = (l: PairEntity | undefined, r: PairEntity | undefined): PairRow => {
    const row: PairRow = {
      key: l ? `L:${l.id}` : `R:${r!.id}`,
      name: l?.name ?? r!.name,
      localId: l?.id,
      remoteId: r?.id,
      localUpdatedAt: l?.updatedAt,
      remoteUpdatedAt: r?.updatedAt
    }
    if (l && r) {
      if (normalizeName(l.name) !== normalizeName(r.name)) row.remoteName = r.name
      row.compare = !l.contentHash || !r.contentHash ? 'unknown' : l.contentHash === r.contentHash ? 'same' : 'differs'
    }
    return row
  }

  // ── 1. id 精確配對 ──
  const pendingLocal: PairEntity[] = []
  for (const l of local) {
    const r = remoteById.get(l.id)
    if (r) {
      usedRemote.add(r.id)
      rows.push(makeRow(l, r))
    } else {
      pendingLocal.push(l)
    }
  }

  // ── 2. 名稱配對（只在雙方都還沒配到的之間找）──
  /** 正規化名稱 → 尚未配對的電腦端實體，新的排前面。 */
  const remoteByName = new Map<string, PairEntity[]>()
  for (const r of remote) {
    if (usedRemote.has(r.id)) continue
    const k = normalizeName(r.name)
    if (!remoteByName.has(k)) remoteByName.set(k, [])
    remoteByName.get(k)!.push(r)
  }
  for (const list of remoteByName.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)

  const localOnly: PairEntity[] = []
  for (const l of [...pendingLocal].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const bucket = remoteByName.get(normalizeName(l.name))
    const r = bucket?.shift()
    if (r) {
      usedRemote.add(r.id)
      rows.push(makeRow(l, r))
    } else {
      localOnly.push(l)
    }
  }

  // ── 3. 剩下的各自成列 ──
  // 這裡刻意保持原始清單順序（不是上面排序過的），畫面才不會每次開都跳動。
  for (const l of local) {
    if (localOnly.some((x) => x.id === l.id)) rows.push(makeRow(l, undefined))
  }
  for (const r of remote) {
    if (!usedRemote.has(r.id)) rows.push(makeRow(undefined, r))
  }

  return rows
}

/** 一次配對全部 collection。 */
export function pairManifests(local: Manifest, remote: Manifest): PairTable {
  const out = {} as PairTable
  for (const kind of KINDS) {
    // `?? []`：舊桌面端還沒升級到支援 reminders 之前，回應裡根本沒有這個欄位
    // （同 `contentHash.ts` 對缺 `contentHash` 欄位的相容處理）
    out[kind] = pairCollection((local[kind] ?? []) as PairEntity[], (remote[kind] ?? []) as PairEntity[])
  }
  return out
}

/**
 * 一列的預設決定。
 *
 * 只有單邊有的 → 補到另一邊（這是「保留差異」的語意：不覆蓋任何已存在的東西，
 * 只把缺的補齊，owner 2026-08-13 選定）。兩邊都有的 → 除非內容相同，
 * 否則預設不動，逼使用者自己選一邊，不替他決定。
 */
export function defaultChoice(row: PairRow): PairChoice {
  if (row.localId && !row.remoteId) return 'local'
  if (!row.localId && row.remoteId) return 'remote'
  return 'keep'
}

/** 整張表的預設決定。 */
export function defaultChoices(table: PairTable): ChoiceMap {
  const out = {} as ChoiceMap
  for (const kind of KINDS) {
    out[kind] = {}
    for (const row of table[kind]) out[kind][row.key] = defaultChoice(row)
  }
  return out
}

/**
 * 三顆快捷鍵（owner 指定的「全部用手機」「全部用電腦」「保留差異」）。
 *
 * ⚠️ **三顆都不會刪東西。** 「全部用手機」只把**兩邊都有**的那些列一律選手機
 * 那份，單邊獨有的仍然照預設補到對面去——不會因為電腦上有一隻手機沒有的角色
 * 就把它刪掉。
 *
 * 這一條在 owner 2026-08-14 加入「選空的那一邊＝刪除」之後**更重要**，不是
 * 更不重要：一顆按鈕如果能一次刪掉幾十筆，那使用者總有一天會手滑按到。
 * 刪除一律只能逐列明確指定。
 *
 * ## 「保留差異」是真的全部不動（B-2，2026-08-16 修正）
 *
 * 這顆原本沿用 `defaultChoice()` 當結果，於是**兩邊都有**的列變成不動沒錯，
 * 但**單邊獨有**的列會被 `defaultChoice` 判成 `local`／`remote`（＝照樣補到
 * 對面去），跟按鈕字面上「保留差異」的意思不符。owner 實機測試時就是照字面
 * 理解——按下去預期整批維持原樣，結果單邊獨有的還是被同步過去了，等於
 * 這顆按鈕名不符實。改成 `preset === 'keep'` 時**一律回 `'keep'`**，不再呼叫
 * `defaultChoice()`；要補齊單邊缺的資料，逐列自己按或用「全部用手機／電腦」。
 */
export function applyPreset(table: PairTable, preset: PairChoice): ChoiceMap {
  const out = {} as ChoiceMap
  for (const kind of KINDS) {
    out[kind] = {}
    for (const row of table[kind]) {
      if (preset === 'keep') {
        out[kind][row.key] = 'keep'
        continue
      }
      const both = !!row.localId && !!row.remoteId
      out[kind][row.key] = both ? preset : defaultChoice(row)
    }
  }
  return out
}

/**
 * 這一列選了之後實際上要做什麼。
 *
 * `'delete-local'`／`'delete-remote'` ＝ 使用者選了**空的那一邊**，也就是
 * 「以那邊為準」而那邊沒有這筆 → 另一邊要刪掉（見 `PairChoice` 的表）。
 */
export type PairAction = 'none' | 'push' | 'pull' | 'delete-local' | 'delete-remote'

export function actionFor(row: PairRow, choice: PairChoice): PairAction {
  if (choice === 'keep') return 'none'
  if (choice === 'local') {
    if (!row.localId) return row.remoteId ? 'delete-remote' : 'none'
    // 兩邊內容已經一樣就不必再送一次
    return row.compare === 'same' ? 'none' : 'push'
  }
  if (!row.remoteId) return row.localId ? 'delete-local' : 'none'
  return row.compare === 'same' ? 'none' : 'pull'
}

/** 這列選了之後真的不必做事嗎（`same` 的列選哪邊都不必動）。 */
export function isNoop(row: PairRow, choice: PairChoice): boolean {
  return actionFor(row, choice) === 'none'
}

/** 統計：這次會推幾筆、拉幾筆、刪幾筆、不動幾筆。UI 的摘要列與確認訊息共用。 */
export interface PairPlanCounts {
  push: number
  pull: number
  /** 要從手機刪掉的筆數。 */
  deleteLocal: number
  /** 要從電腦刪掉的筆數。 */
  deleteRemote: number
  untouched: number
}

export function countPlan(table: PairTable, choices: ChoiceMap): PairPlanCounts {
  const counts: PairPlanCounts = { push: 0, pull: 0, deleteLocal: 0, deleteRemote: 0, untouched: 0 }
  for (const kind of KINDS) {
    for (const row of table[kind]) {
      switch (actionFor(row, choices[kind][row.key] ?? defaultChoice(row))) {
        case 'push': counts.push++; break
        case 'pull': counts.pull++; break
        case 'delete-local': counts.deleteLocal++; break
        case 'delete-remote': counts.deleteRemote++; break
        default: counts.untouched++
      }
    }
  }
  return counts
}

/** 這次會被刪掉的東西，給確認視窗逐筆列出來（不能只說數量）。 */
export function listDeletions(
  table: PairTable,
  choices: ChoiceMap
): { kind: PairKind; name: string; side: 'local' | 'remote' }[] {
  const out: { kind: PairKind; name: string; side: 'local' | 'remote' }[] = []
  for (const kind of KINDS) {
    for (const row of table[kind]) {
      const action = actionFor(row, choices[kind][row.key] ?? defaultChoice(row))
      if (action === 'delete-local') out.push({ kind, name: row.name, side: 'local' })
      else if (action === 'delete-remote') out.push({ kind, name: row.name, side: 'remote' })
    }
  }
  return out
}
