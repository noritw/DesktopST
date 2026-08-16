import { normalizeName } from './pair'
import type { ManifestConversation } from './types'

/**
 * S2 對話同步：對話的逐項比對。
 *
 * ## 為什麼不沿用 `pair.ts` 的 `PairRow`／`PairChoice`
 *
 * `mobile-sync-m4-compare.md` §6 已經預告過這件事：`PairRow` 是「單一名稱＋
 * 單一時間戳，選左邊或右邊」，而對話是**訊息層的聯集**——同一則對話裡，
 * 兩邊都有對方沒有的訊息是**正常狀態，不是衝突**。
 *
 * 硬套 `local`／`remote` 三選一的話，使用者每次都被逼在「要手機的還是電腦的」
 * 之間選一個**必然丟資料**的答案，而規格（§3.1／§6.2 ②）講的是聯集追加。
 * 所以對話有自己的一套選項：
 *
 * | 狀態 | 選項 | 預設 |
 * |---|---|---|
 * | 兩邊都有、訊息集合不同 | `merge`／`keep` | `merge` |
 * | 兩邊都有、完全相同 | （不必決定） | `keep` |
 * | 只有一邊有 | `copy`／`keep`／`delete` | `copy` |
 *
 * ## 「兩邊都有」的列仍然不會刪東西
 *
 * `merge`／`keep` 沒有刪除語意——訊息聯集裡少的一律當成「還沒收到」，
 * 不是「被刪的」（階段二才會處理墓碑，見下方 B-1）。
 *
 * ## 單邊獨有的列可以刪（2026-08-16，B-1 階段一）
 *
 * owner 實機測試回報：故意刪掉的對話，同步後又被另一邊補回來（`copy` 的
 * 預設行為）。原因是「單邊獨有」有兩種成因——真的還沒同步過，或是
 * 使用者在其中一邊刪掉了——這一版之前完全沒分辨。`delete` 選項讓使用者
 * 明講「這是我刪的，另一邊也刪掉」：對還沒同步過的新對話沒有影響
 * （反正它本來就不該被刪），只有使用者自己選了才會動。
 *
 * `delete` 只在單邊獨有時有意義，語意是「刪掉現在有這則的那一邊」——
 * `localId` 有值就刪本機（`delete-local`），只有 `remoteId` 就刪電腦
 * （`delete-remote`），完全複用 `pair.ts` 已驗證過的警告色＋逐筆確認清單。
 * **`delete` 不適用於兩邊都有的列**（那是階段二的範圍，見下方）。
 *
 * 訊息層的刪除（階段二）還沒做：`merge` 光看指紋分不出「對面新增的」跟
 * 「這邊被刪的」，要墓碑紀錄或逐句確認清單，等階段一用一陣子再決定。
 */

/** 比對用的對話描述：清單端點給的輕量欄位 ＋ 指紋。 */
export interface ConvEntity extends ManifestConversation {
  messageIdsHash?: string
  summaryHash?: string
  summaryCoversTs?: number
  /**
   * 這則對話在**對面那台**的 id（手機端才有值，來自 `importedFrom.sourceId`）。
   *
   * ⚠️ **配對一定要看這個欄位，漏了就會每次切換都多一份。** S1 匯入進來的
   * 對話，本地 id 是手機自己發的、跟電腦端那則完全不同，只有 `sourceId`
   * 記得它們是同一則。少了這一步，每一則匯入過的對話都會被判成「手機獨有」
   * 而再推一份回電腦——這正是 S2 M3 重複增生的失敗模式
   * （`mobile-sync-m4-compare.md` §1.1），只是換了個地方重演。
   */
  linkedRemoteId?: string
}

export type ConvChoice =
  /** 兩邊互相補齊缺的訊息（兩邊都有時的預設） */
  | 'merge'
  /** 把這則整個複製到對面（只有一邊有時的預設） */
  | 'copy'
  /** 這列不動 */
  | 'keep'
  /** 刪掉現在有這則的那一邊，只在單邊獨有時有意義（B-1 階段一） */
  | 'delete'

/** 單值欄位的衝突：這些走「二選一」，跟訊息的聯集是兩回事。 */
export type ConvFieldKey = 'title' | 'summary'
export type ConvFieldChoice = 'local' | 'remote' | 'keep'

export interface ConvFieldConflict {
  field: ConvFieldKey
  localValue: string
  remoteValue: string
  /**
   * 摘要專用：這一邊涵蓋到的時間。UI 拿來標「涵蓋到 8/12 14:30」——
   * 摘要本文不進清單端點（可能很長），使用者靠涵蓋範圍就足以判斷要哪一份。
   */
  localCoversTs?: number
  remoteCoversTs?: number
}

export interface ConvRow {
  key: string
  /** 顯示用標題（以手機那邊為主）。 */
  title: string
  /** 電腦端的標題，只有兩邊不同時才有值。 */
  remoteTitle?: string

  localId?: string
  remoteId?: string
  localUpdatedAt?: number
  remoteUpdatedAt?: number

  /** 兩邊各自的則數，UI 直接顯示。 */
  localCount?: number
  remoteCount?: number

  /**
   * 訊息集合的比對結果：
   * - `'same'`：指紋相同，訊息不必動（單值欄位仍可能有衝突）
   * - `'differs'`：指紋不同，要合併
   * - `'unknown'`：至少一邊沒有指紋（舊版電腦端）→ 當成要合併，合併本身是冪等的
   */
  compare?: 'same' | 'differs' | 'unknown'

  /** 單值欄位的衝突，沒有就是空陣列。 */
  conflicts: ConvFieldConflict[]
}

/**
 * 配對一批對話。
 *
 * 身分判定順序（**順序不能改**）：
 * 1. id 相同
 * 2. 手機的 `linkedRemoteId`（＝`importedFrom.sourceId`）指到電腦某則
 * 3. 正規化標題相同
 *
 * 第 2 步是最容易漏掉、漏了症狀最嚴重的一步，理由見 `ConvEntity.linkedRemoteId`。
 * 第 3 步的標題配對是最後手段：對話標題重複的機會比角色名字高得多
 * （一堆「新對話」），所以同名多筆時照 `updatedAt` 由新到舊依序配對，
 * 多出來的自成一列，跟 `pair.ts` 同一套規則。
 */
export function pairConversations(local: ConvEntity[], remote: ConvEntity[]): ConvRow[] {
  const rows: ConvRow[] = []
  const usedRemote = new Set<string>()
  const remoteById = new Map(remote.map((r) => [r.id, r]))

  const pendingLocal: ConvEntity[] = []

  // ── 1＋2. id 精確配對，接著看 linkedRemoteId ──
  for (const l of local) {
    const byId = remoteById.get(l.id)
    const byLink = l.linkedRemoteId ? remoteById.get(l.linkedRemoteId) : undefined
    const r = byId && !usedRemote.has(byId.id) ? byId : byLink && !usedRemote.has(byLink.id) ? byLink : undefined
    if (r) {
      usedRemote.add(r.id)
      rows.push(makeRow(l, r))
    } else {
      pendingLocal.push(l)
    }
  }

  // ── 3. 標題配對（只在雙方都還沒配到的之間找）──
  const remoteByTitle = new Map<string, ConvEntity[]>()
  for (const r of remote) {
    if (usedRemote.has(r.id)) continue
    const k = normalizeName(r.title)
    if (!remoteByTitle.has(k)) remoteByTitle.set(k, [])
    remoteByTitle.get(k)!.push(r)
  }
  for (const list of remoteByTitle.values()) list.sort((a, b) => b.updatedAt - a.updatedAt)

  const localOnly = new Set<string>()
  for (const l of [...pendingLocal].sort((a, b) => b.updatedAt - a.updatedAt)) {
    const r = remoteByTitle.get(normalizeName(l.title))?.shift()
    if (r) {
      usedRemote.add(r.id)
      rows.push(makeRow(l, r))
    } else {
      localOnly.add(l.id)
    }
  }

  // ── 剩下的各自成列 ──
  // 保持原始清單順序（不是上面排序過的），畫面才不會每次開都跳動。
  for (const l of local) if (localOnly.has(l.id)) rows.push(makeRow(l, undefined))
  for (const r of remote) if (!usedRemote.has(r.id)) rows.push(makeRow(undefined, r))

  return rows
}

function makeRow(l: ConvEntity | undefined, r: ConvEntity | undefined): ConvRow {
  const row: ConvRow = {
    key: l ? `L:${l.id}` : `R:${r!.id}`,
    title: l?.title ?? r!.title,
    localId: l?.id,
    remoteId: r?.id,
    localUpdatedAt: l?.updatedAt,
    remoteUpdatedAt: r?.updatedAt,
    localCount: l?.messageCount,
    remoteCount: r?.messageCount,
    conflicts: []
  }
  if (!l || !r) return row

  if (normalizeName(l.title) !== normalizeName(r.title)) {
    row.remoteTitle = r.title
    row.conflicts.push({ field: 'title', localValue: l.title, remoteValue: r.title })
  }

  row.compare =
    !l.messageIdsHash || !r.messageIdsHash
      ? 'unknown'
      : l.messageIdsHash === r.messageIdsHash
        ? 'same'
        : 'differs'

  /*
   * 摘要的衝突只在「兩邊都有摘要、內容不同、而且涵蓋範圍一樣」時才成立。
   * 其餘情況有客觀答案（涵蓋比較多的那份贏、或只有一邊有），由
   * `convHash.pickSummary()` 自動決定，不必打擾使用者。
   */
  const la = l.summaryHash ?? ''
  const ra = r.summaryHash ?? ''
  if (la && ra && la !== ra && (l.summaryCoversTs ?? 0) === (r.summaryCoversTs ?? 0)) {
    row.conflicts.push({
      field: 'summary',
      localValue: '手機的摘要',
      remoteValue: '電腦的摘要',
      localCoversTs: l.summaryCoversTs,
      remoteCoversTs: r.summaryCoversTs
    })
  }

  return row
}

/** 一列的預設決定。 */
export function defaultConvChoice(row: ConvRow): ConvChoice {
  const both = !!row.localId && !!row.remoteId
  if (!both) return 'copy'
  return row.compare === 'same' ? 'keep' : 'merge'
}

export type ConvChoiceMap = Record<string, ConvChoice>
/** key → 欄位 → 選擇。 */
export type ConvFieldChoiceMap = Record<string, Partial<Record<ConvFieldKey, ConvFieldChoice>>>

export function defaultConvChoices(rows: ConvRow[]): ConvChoiceMap {
  const out: ConvChoiceMap = {}
  for (const row of rows) out[row.key] = defaultConvChoice(row)
  return out
}

/**
 * 單值欄位的預設一律是 `keep`（不動）。
 *
 * 跟設定同步（`settingsPair.ts` §8.1）同一個道理：兩邊都有值、都是使用者
 * 自己取的名字，沒有客觀上比較對的那個，不替他決定。
 */
export function defaultConvFieldChoices(rows: ConvRow[]): ConvFieldChoiceMap {
  const out: ConvFieldChoiceMap = {}
  for (const row of rows) {
    if (row.conflicts.length === 0) continue
    out[row.key] = Object.fromEntries(row.conflicts.map((c) => [c.field, 'keep' as ConvFieldChoice]))
  }
  return out
}

/**
 * 兩顆快捷鍵。
 *
 * ⚠️ **對話分頁刻意只有兩顆，不是其他分頁的三顆。** 「全部用手機」「全部用電腦」
 * 對聯集合併沒有意義——它們的語意是「用這一邊蓋掉另一邊」，而對話的正確處置
 * 是兩邊都補齊。硬做的話只會讓使用者以為自己選了一個安全的選項，實際上
 * 每按一次就丟掉對面獨有的訊息。
 *
 * 單值欄位的選擇**不受快捷鍵影響**（維持 `keep`）：標題要用哪個是逐則的判斷，
 * 一顆按鈕一次改掉幾十則對話的標題只會讓人找不回來。
 */
export function applyConvPreset(rows: ConvRow[], preset: 'all' | 'none'): ConvChoiceMap {
  const out: ConvChoiceMap = {}
  for (const row of rows) out[row.key] = preset === 'none' ? 'keep' : defaultConvChoice(row)
  return out
}

/** 這一列選了之後實際上要做什麼。 */
export type ConvAction = 'none' | 'merge' | 'push' | 'pull' | 'delete-local' | 'delete-remote'

export function convActionFor(row: ConvRow, choice: ConvChoice): ConvAction {
  if (choice === 'keep') return 'none'
  const both = !!row.localId && !!row.remoteId
  if (choice === 'delete') {
    // 只在單邊獨有時有意義；兩邊都有的列選了也當不動處理（UI 不會給這個選項）
    if (both) return 'none'
    return row.localId ? 'delete-local' : 'delete-remote'
  }
  if (choice === 'copy') {
    if (both) return 'none'
    return row.localId ? 'push' : 'pull'
  }
  // merge：只有兩邊都有才成立；訊息完全相同時仍可能要處理單值欄位，
  // 但那條路徑由 `hasFieldWork()` 判斷，不由這裡回報。
  if (!both) return row.localId ? 'push' : 'pull'
  return row.compare === 'same' ? 'none' : 'merge'
}

/** 這次會被刪掉的對話，給確認視窗逐則列出來（不能只說數量），跟 `pair.ts` 的 `listDeletions` 同一套。 */
export function listConvDeletions(
  rows: ConvRow[],
  choices: ConvChoiceMap
): { title: string; side: 'local' | 'remote' }[] {
  const out: { title: string; side: 'local' | 'remote' }[] = []
  for (const row of rows) {
    const action = convActionFor(row, choices[row.key] ?? defaultConvChoice(row))
    if (action === 'delete-local') out.push({ title: row.title, side: 'local' })
    else if (action === 'delete-remote') out.push({ title: row.title, side: 'remote' })
  }
  return out
}

/** 這一列有沒有「訊息不用動、但單值欄位要改」的工作。 */
export function hasFieldWork(row: ConvRow, fieldChoices: ConvFieldChoiceMap): boolean {
  const picked = fieldChoices[row.key]
  if (!picked) return false
  return row.conflicts.some((c) => {
    const choice = picked[c.field]
    return choice === 'local' || choice === 'remote'
  })
}

export interface ConvPlanCounts {
  /** 要雙向補齊的則數。 */
  merge: number
  /** 整則推到電腦的則數。 */
  push: number
  /** 整則帶回手機的則數。 */
  pull: number
  /** 要從手機刪掉的則數。 */
  deleteLocal: number
  /** 要從電腦刪掉的則數。 */
  deleteRemote: number
  untouched: number
  /** 這次總共會補多少則訊息到電腦／手機（估計值，用指紋算不出來的以 0 計）。 */
  fieldEdits: number
}

export function countConvPlan(
  rows: ConvRow[],
  choices: ConvChoiceMap,
  fieldChoices: ConvFieldChoiceMap = {}
): ConvPlanCounts {
  const counts: ConvPlanCounts = { merge: 0, push: 0, pull: 0, deleteLocal: 0, deleteRemote: 0, untouched: 0, fieldEdits: 0 }
  for (const row of rows) {
    switch (convActionFor(row, choices[row.key] ?? defaultConvChoice(row))) {
      case 'merge': counts.merge++; break
      case 'push': counts.push++; break
      case 'pull': counts.pull++; break
      case 'delete-local': counts.deleteLocal++; break
      case 'delete-remote': counts.deleteRemote++; break
      default: counts.untouched++
    }
    if (hasFieldWork(row, fieldChoices)) counts.fieldEdits++
  }
  return counts
}
