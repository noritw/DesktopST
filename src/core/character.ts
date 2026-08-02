import type { Character } from './types'

/** 角色的所有稱呼（本名 ＋ 暱稱），供點名判定與對白前綴剝除共用。 */
export function characterAliases(char: Character): string[] {
  const nn = Array.isArray(char.nicknames) ? char.nicknames : []
  return [char.name, ...nn].map(s => String(s ?? '').trim()).filter(Boolean)
}
