import type { CollectionDiff, Manifest, SyncDiff } from '@core/sync/types'

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
