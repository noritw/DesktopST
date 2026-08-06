import type { NewsKeywordGroup, NewsSource, NewsWeight } from './types'

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

// ── 關鍵字組管理（owner 2026-08-06：手機端要能新增／刪除組）─────

/**
 * 新增一個關鍵字組。**不帶 id**：由電腦端產生
 * （`main/modules/news/settings.ts` 的 `normalizeKeywordGroups`）——
 * 手機上 `crypto.randomUUID()` 在非安全內容（`http://192.168.x.x`）不存在，
 * 與 `withNewKeyword` 同一個理由（計畫書 §4.10 第 3 點）。
 * 重複名稱不擋——使用者可能就是想要兩個同名的組，id 才是唯一性依據。
 */
export function withNewGroup(groups: NewsKeywordGroup[], name: string): NewsKeywordGroup[] {
  const trimmed = name.trim()
  if (!trimmed) return groups
  return groups.concat([{ id: '', name: trimmed }])
}

/**
 * 刪除一個關鍵字組。**預設組永遠留著**——它是電腦端的內建保底
 * （`normalizeKeywordGroups` 送出的陣列裡少了它也會被自動補回來），
 * 這裡先擋掉是為了讓 UI 不必先送出去才發現沒用。
 * 組內的關鍵字不會一起被刪，電腦端會把它們的 `groupId` 清掉、落回預設組。
 */
export function withoutGroup(groups: NewsKeywordGroup[], id: string): NewsKeywordGroup[] {
  if (id === DEFAULT_KEYWORD_GROUP_ID) return groups
  return groups.filter((g) => g.id !== id)
}
