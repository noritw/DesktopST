/**
 * 設定與資料的正規化純函式（B2.7）。
 *
 * 全部是「資料進、資料出」，不碰檔案系統、不碰平台 API。
 * 桌面（`main/fileStore.ts`）與手機端各自負責讀寫，中間的判斷一律走這裡，
 * 避免同一份遷移邏輯在兩地長歪（roadmap §4.1）。
 */

import type { PinnedNote } from '../types'

/**
 * 官方改名／下架的模型 ID 對照。舊 settings.json 存的值在載入時自動換成新 ID，
 * 避免打到已失效的 endpoint。新增項目時左邊放舊 ID、右邊放官方現行 ID。
 */
export const RENAMED_MODEL_IDS: Record<string, string> = {
  // xAI 官方文件改用帶日期的完整 ID
  'grok-4.20-reasoning': 'grok-4.20-0309-reasoning',
  'grok-4.20-non-reasoning': 'grok-4.20-0309-non-reasoning',
  // xAI 已下架 grok-4-1-fast 系列
  'grok-4-1-fast-reasoning': 'grok-4.3',
  'grok-4-1-fast-non-reasoning': 'grok-4.3',
  // OpenAI 已下架 o1-mini
  'o1-mini': 'o4-mini'
}

export function renameModelId(id: string | undefined): string | undefined {
  if (!id) return id
  return RENAMED_MODEL_IDS[id] ?? id
}

export function renameModelIdMap(map: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!map) return map
  const out: Record<string, string> = {}
  for (const [provider, id] of Object.entries(map)) out[provider] = renameModelId(id) ?? id
  return out
}

export function isPinnedNote(value: unknown): value is PinnedNote {
  if (!value || typeof value !== 'object') return false
  const note = value as PinnedNote
  return typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    typeof note.color === 'string' &&
    typeof note.visible === 'boolean' &&
    !!note.position &&
    typeof note.position.x === 'number' &&
    typeof note.position.y === 'number'
}
