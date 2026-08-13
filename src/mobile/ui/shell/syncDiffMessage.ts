import type { CollectionDiff, Manifest, SyncDiff } from '@core/sync/types'
import type { PairKind } from '@core/sync/pair'
import type { PushSummary } from '../../runtime/syncPush'
import type { SyncResult } from '../../runtime/syncImport'
import type { ApplyResult } from '../../runtime/syncApply'
import type { SettingsApplyResult } from '../../runtime/syncSettingsApply'

/** M4 摘要的顯示順序與字樣。 */
const APPLY_LABELS: [PairKind, string][] = [
  ['characters', '角色'],
  ['personas', '使用者設定'],
  ['worlds', '世界觀'],
  ['scenes', '情境'],
  ['lorebooks', '用語解說']
]

/**
 * S2 M2 差異預覽的文字呈現（`ModeSwitcher.tsx` 用 `ui.confirm` 顯示）。
 *
 * 拆成獨立檔案是為了不用 mock React／Sheet 就能單元測試格式化邏輯。
 */

const COLLECTION_LABELS: [keyof Pick<SyncDiff, 'characters' | 'personas' | 'worlds' | 'scenes' | 'lorebooks' | 'conversations'>, string][] = [
  ['characters', '角色'],
  ['personas', '人設'],
  ['worlds', '世界觀'],
  ['scenes', '情境'],
  ['lorebooks', '用語解說'],
  ['conversations', '對話']
]

function summarizeCollection(label: string, c: CollectionDiff): string | null {
  const parts: string[] = []
  if (c.localNew.length) parts.push(`手機新增 ${c.localNew.length}`)
  if (c.localModified.length) parts.push(`手機修改 ${c.localModified.length}`)
  if (c.localDeleted.length) parts.push(`手機刪除 ${c.localDeleted.length}（電腦上還在，不會被推掉）`)
  if (c.remoteNew.length) parts.push(`電腦新增 ${c.remoteNew.length}`)
  if (c.remoteModified.length) parts.push(`電腦修改 ${c.remoteModified.length}`)
  if (c.remoteDeleted.length) parts.push(`電腦刪除 ${c.remoteDeleted.length}（手機上還在，不會被拉掉）`)
  if (c.conflicts.length) parts.push(`衝突 ${c.conflicts.length}（兩邊都改過，這個版本不處理）`)
  if (parts.length === 0) return null
  return `${label}：${parts.join('、')}`
}

/**
 * 手機上還沒有任何基準（第一次切換）時的訊息——只列雙邊目前各有幾筆
 * 中性統計，**不逐筆貼「新增」標籤**。理由見 `core/sync/types.ts` 的
 * `SyncDiff.hasBaseline` 註解：第一次切換沒有基準可比，硬套規則只是在
 * 重述「你有資料」，不是有意義的差異。
 */
export function formatFirstRunMessage(local: Manifest, remote: Manifest): string {
  const countLine = (m: Manifest): string =>
    `角色 ${m.characters.length}、人設 ${m.personas.length}、世界觀 ${m.worlds.length}、` +
    `情境 ${m.scenes.length}、用語解說 ${m.lorebooks.length}、對話 ${m.conversations.length}`
  return [
    '這是第一次比對，還沒有基準可以算差異——這裡只列出雙邊目前各有多少資料。',
    `手機：${countLine(local)}`,
    `電腦：${countLine(remote)}`,
    '',
    '這個版本只預覽，不會搬動任何資料。'
  ].join('\n')
}

/** 有基準、且比對出差異時的訊息。 */
export function formatDiffMessage(diff: SyncDiff): string {
  const lines = COLLECTION_LABELS.map(([key, label]) => summarizeCollection(label, diff[key])).filter(
    (l): l is string => l !== null
  )
  if (diff.settingsChanged) lines.push('設定：兩邊不一樣')
  lines.push('', '這個版本只預覽，不會搬動任何資料。')
  return lines.join('\n')
}

const PUSH_SUMMARY_LABELS: [keyof PushSummary, string][] = [
  ['characters', '角色'],
  ['personas', '人設'],
  ['worlds', '世界觀'],
  ['scenes', '情境'],
  ['lorebooks', '用語解說']
]

/**
 * 推送完成後的結果訊息（M3，`ModeSwitcher.tsx` 用 `ui.confirm` 顯示）。
 *
 * 使用者選「帶過去並切換」之前只看得到差異統計數字（`formatDiffMessage`）；
 * 推送完之後應該要能看到「實際推了哪些名字」，不然使用者只知道按鈕按了、
 * 不知道究竟改了什麼。
 */
export function formatPushSummaryMessage(summary: PushSummary): string {
  const lines = PUSH_SUMMARY_LABELS.map(([key, label]) => {
    const names = summary[key]
    if (names.length === 0) return null
    return `${label}（${names.length}）：${names.join('、')}`
  }).filter((l): l is string => l !== null)

  // 略過的一定要講出來，不能默默不推——使用者會以為推成功了。
  const skipped =
    summary.skippedByName.length > 0
      ? ['', `未推送（電腦上有同名角色、你沒有勾選覆蓋）：${summary.skippedByName.join('、')}`]
      : []

  if (lines.length === 0) {
    return skipped.length > 0 ? skipped.slice(1).join('\n') : '沒有東西被推送。'
  }
  return ['已推送到電腦：', ...lines, ...skipped].join('\n')
}

/**
 * 從電腦拉取完成後的結果訊息（M3 P1 修正，`ModeSwitcher.tsx` 遙控 → 獨立時用）。
 *
 * 沿用 S1 `runSyncImport` 的既有回傳形狀，不重新設計——這裡只是把數字排成
 * 使用者看得懂的一句話。
 */
export function formatPullSummaryMessage(result: SyncResult): string {
  const lines: string[] = []
  if (result.charactersImported > 0) lines.push(`角色：${result.charactersImported}`)
  if (result.presetsImported > 0) lines.push(`人設／世界觀／情境：${result.presetsImported}`)
  if (result.lorebooksImported > 0) lines.push(`用語解說：${result.lorebooksImported}`)
  if (result.charactersFailed > 0) lines.push(`⚠️ 角色下載失敗：${result.charactersFailed}`)

  if (lines.length === 0) return '沒有東西需要從電腦帶回。'
  return ['已從電腦帶回：', ...lines].join('\n')
}

/**
 * S2 M4 逐項同步完成後的摘要。
 *
 * 兩個方向會出現在同一趟裡（比對畫面是逐列決定的），所以推與拉分開列，
 * 不能像 M3 那樣假設整趟只有一個方向。
 *
 * **失敗一定要列出來**：`applySync` 刻意讓單筆失敗不中斷整趟，
 * 不講出來的話使用者會以為十筆都成功了。
 */
/**
 * 資料與設定各自跑一套 apply（`syncApply.ts`／`syncSettingsApply.ts`），
 * 但使用者只在乎「這趟同步到底做了什麼」，所以合成一則訊息，不分兩個對話框。
 */
export function formatApplyMessage(data: ApplyResult, settings?: SettingsApplyResult): string {
  const section = (title: string, bucket: Record<PairKind, string[]>): string[] => {
    const lines = APPLY_LABELS.map(([key, label]) => {
      const names = bucket[key]
      return names.length === 0 ? null : `${label}（${names.length}）：${names.join('、')}`
    }).filter((l): l is string => l !== null)
    return lines.length === 0 ? [] : [title, ...lines]
  }

  const out = [
    ...section('送到電腦：', data.pushed),
    ...section('帶回手機：', data.pulled),
    ...section('已從手機刪除：', data.deletedLocal),
    ...section('已從電腦刪除：', data.deletedRemote)
  ]
  if (settings) {
    if (settings.pushed.length > 0) out.push('設定 送到電腦：', `・${settings.pushed.join('、')}`)
    if (settings.pulled.length > 0) out.push('設定 帶回手機：', `・${settings.pulled.join('、')}`)
  }

  const failed = [...data.failed, ...(settings?.failed.map((f) => ({ name: f.label, error: f.error })) ?? [])]
  if (failed.length > 0) {
    out.push('', `⚠️ 有 ${failed.length} 筆沒成功：`)
    for (const f of failed) out.push(`・${f.name}（${f.error}）`)
  }
  return out.length === 0 ? '沒有任何資料被搬動。' : out.join('\n')
}
