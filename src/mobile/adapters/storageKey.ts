/**
 * 把 core 的平台無關 key 正規化；非法就丟錯。
 * 與桌面 `electronStorage` 同一套規則（`/` 分隔、不以 `/` 開頭、不含 `..`）。
 */
export function assertValidStorageKey(key: string): string {
  const normalized = key.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`invalid storage key: ${key}`)
  }
  return normalized
}

/** `personas` → `personas`；`personas/` → `personas`。 */
export function cleanPrefix(prefix: string): string {
  return assertValidStorageKey(prefix).replace(/\/+$/, '')
}
