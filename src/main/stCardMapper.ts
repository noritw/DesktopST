import type { Character } from './types'

type AnyRecord = Record<string, unknown>

function trimStr(v: unknown): string {
  return String(v ?? '').trim()
}

function asRecord(v: unknown): AnyRecord | null {
  if (!v || typeof v !== 'object') return null
  return v as AnyRecord
}

function toStringMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as AnyRecord)) {
    const key = trimStr(k)
    const value = trimStr(val)
    if (!key || !value) continue
    out[key] = value
  }
  return out
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .map(x => trimStr(x))
    .filter(Boolean)
}

function toOptionalString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  return trimStr(v)
}

function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v
}

/** ST `description` + 換行 + `personality` → Character.personality（欄位各自 trim，僅接非空片段） */
export function mergeStPersonality(description: unknown, personality: unknown): string {
  const d = trimStr(description)
  const p = trimStr(personality)
  if (d && p) return `${d}\n${p}`
  return d || p
}

function readData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const inner = o.data
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>
  return o
}

function readDesktopExtension(raw: unknown, data: Record<string, unknown>): Record<string, unknown> {
  const dataExt = asRecord(data.extensions)
  const dataDesktop = asRecord(dataExt?.desktopst)
  if (dataDesktop) return dataDesktop

  const root = asRecord(raw)
  const rootExt = asRecord(root?.extensions)
  const rootDesktop = asRecord(rootExt?.desktopst)
  if (rootDesktop) return rootDesktop
  return {}
}

function isDesktopCharacterLike(raw: unknown): boolean {
  const o = asRecord(raw)
  if (!o) return false
  return (
    'firstMessage' in o ||
    'exampleDialogue' in o ||
    'avatar' in o ||
    'nicknames' in o ||
    'lastDesktopPosition' in o
  )
}

function importDesktopCharacter(raw: AnyRecord, id: string): Character {
  const now = Date.now()
  const spriteIds = toStringMap(raw.spriteIds)
  const createdAt = toFiniteNumber(raw.createdAt) ?? now
  return {
    id,
    name: trimStr(raw.name) || 'Unknown',
    nicknames: toStringArray(raw.nicknames),
    avatar: trimStr(raw.avatar),
    description: trimStr(raw.description),
    personality: trimStr(raw.personality),
    firstMessage: trimStr(raw.firstMessage ?? raw.first_mes),
    exampleDialogue: trimStr(raw.exampleDialogue ?? raw.mes_example),
    emotions: toStringMap(raw.emotions),
    spriteIds: Object.keys(spriteIds).length > 0 ? spriteIds : undefined,
    scenario: toOptionalString(raw.scenario),
    systemPromptOverride: toOptionalString(raw.systemPromptOverride ?? raw.system_prompt),
    creatorNotes: toOptionalString(raw.creatorNotes ?? raw.creator_notes ?? raw.creatorcomment),
    lorebook: null,
    lastDesktopSize: toFiniteNumber(raw.lastDesktopSize),
    lastDesktopFlipped: typeof raw.lastDesktopFlipped === 'boolean' ? raw.lastDesktopFlipped : undefined,
    lastDesktopPosition: asRecord(raw.lastDesktopPosition) && typeof (raw.lastDesktopPosition as AnyRecord).x === 'number' && typeof (raw.lastDesktopPosition as AnyRecord).y === 'number'
      ? { x: (raw.lastDesktopPosition as AnyRecord).x as number, y: (raw.lastDesktopPosition as AnyRecord).y as number }
      : undefined,
    createdAt,
    updatedAt: toFiniteNumber(raw.updatedAt) ?? createdAt
  }
}

/**
 * 將 ST JSON（含 chara_card_v2）或 DesktopST JSON 轉為 Character。
 */
export function importStJson(raw: unknown, id: string): Character {
  if (isDesktopCharacterLike(raw)) {
    return importDesktopCharacter(raw as AnyRecord, id)
  }

  const data = readData(raw)
  const ext = readDesktopExtension(raw, data)
  const nameRaw = trimStr(data.name)
  const name = nameRaw || 'Unknown'

  const personality = mergeStPersonality(data.description, data.personality)

  const now = Date.now()
  const creatorRaw = data.creator_notes ?? (data as { creatorcomment?: unknown }).creatorcomment
  const spriteIds = toStringMap(data.spriteIds)
  const nicknames = toStringArray(ext.nicknames)
  const avatarHint = trimStr(ext.avatar)

  // 從 DesktopST 擴充欄位恢復情緒和精靈 ID（如果存在）
  const emotions = toStringMap(data.emotions)

  return {
    id,
    name,
    nicknames,
    avatar: avatarHint,
    description: trimStr(ext.description),
    personality,
    firstMessage: trimStr(data.first_mes),
    exampleDialogue: trimStr(data.mes_example),
    emotions,
    spriteIds: Object.keys(spriteIds).length > 0 ? spriteIds : undefined,
    scenario: data.scenario !== undefined ? trimStr(data.scenario) : undefined,
    systemPromptOverride: data.system_prompt !== undefined ? trimStr(data.system_prompt) : undefined,
    creatorNotes: creatorRaw !== undefined ? trimStr(creatorRaw) : undefined,
    lorebook: null,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 產出 ST chara_card_v2 JSON 字串。
 */
export function exportToStJson(char: Character): string {
  const desktopExt: Record<string, unknown> = {
    description: char.description ?? '',
    nicknames: Array.isArray(char.nicknames) ? char.nicknames : []
  }
  if (char.avatar?.trim()) desktopExt.avatar = char.avatar.trim()

  const data = {
    name: char.name,
    description: char.personality ?? '',
    personality: '',
    first_mes: char.firstMessage ?? '',
    mes_example: char.exampleDialogue ?? '',
    scenario: char.scenario ?? '',
    creator_notes: char.creatorNotes ?? '',
    system_prompt: char.systemPromptOverride ?? '',
    // DesktopST 擴充欄位：情緒和精靈 ID 映射
    emotions: char.emotions ?? {},
    spriteIds: char.spriteIds ?? {},
    extensions: {
      desktopst: desktopExt
    }
  }
  return JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data
  })
}
