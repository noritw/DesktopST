/** 純字串工具，無平台依賴。 */

export function normalizeText(s: string): string {
  return s.toLowerCase()
}

export function normalizeForCompare(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[，、。！？!?,.]+/g, '')
    .toLowerCase()
}

export function escapeRegExp(s: string): string {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
