import type { NewsSource, NewsWeight } from './types'

/** 內建「預設組」id；未綁組的情境與沒有 groupId 的關鍵字都落在這裡。 */
export const DEFAULT_KEYWORD_GROUP_ID = 'default'

/** undefined / 空字串視為預設組。 */
export function effectiveGroupId(groupId: string | undefined): string {
  return groupId && groupId.length > 0 ? groupId : DEFAULT_KEYWORD_GROUP_ID
}

/** 該 keyword 來源是否屬於指定情境組（rss/json 不分組，由呼叫端判斷）。 */
export function keywordSourceInGroup(source: NewsSource, sceneGroupId: string | undefined): boolean {
  return effectiveGroupId(source.groupId) === effectiveGroupId(sceneGroupId)
}

/**
 * 新聞報：關鍵字是否落在選中的多組內。
 * `selectedIds` 為 null／空 = 全部組都收。
 */
export function keywordSourceInReaderGroups(
  source: NewsSource,
  selectedIds: string[] | null | undefined
): boolean {
  if (!selectedIds || selectedIds.length === 0) return true
  const gid = effectiveGroupId(source.groupId)
  return selectedIds.some(id => effectiveGroupId(id) === gid)
}

/** design §5：常聊 / 普通 / 偶爾 ≈ 3 / 2 / 1 */
export function weightToValue(weight: NewsWeight): number {
  switch (weight) {
    case 'often': return 3
    case 'rarely': return 1
    case 'normal':
    default: return 2
  }
}
