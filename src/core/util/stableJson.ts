/**
 * 穩定序列化（key 依字母排序後才 `JSON.stringify`）。
 *
 * S2 M2 差異預覽的 `settingsHash`（`core/sync/diff.ts`）雙邊各自算一次，
 * 桌面與手機的物件字面量寫法不保證屬性順序一致——`JSON.stringify` 對
 * 屬性順序敏感，同樣的內容換個寫法就會雜湊出不同值，兩邊永遠對不起來。
 * 這裡先排序 key 再序列化，讓雜湊只反映**內容**，不反映**寫法**。
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}
