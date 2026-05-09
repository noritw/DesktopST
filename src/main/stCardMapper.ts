import type { Character } from './types'

function trimStr(v: unknown): string {
  return String(v ?? '').trim()
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

/**
 * 將 ST JSON（含 chara_card_v2 包裝）轉為 Character（不含 avatar，呼叫端填入）。
 */
export function importStJson(raw: unknown, id: string): Character {
  const data = readData(raw)
  const nameRaw = trimStr(data.name)
  const name = nameRaw || 'Unknown'

  const personality = mergeStPersonality(data.description, data.personality)

  const now = Date.now()
  const creatorRaw = data.creator_notes ?? (data as { creatorcomment?: unknown }).creatorcomment

  return {
    id,
    name,
    nicknames: [],
    avatar: '',
    description: '',
    personality,
    firstMessage: trimStr(data.first_mes),
    exampleDialogue: trimStr(data.mes_example),
    emotions: {},
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
  const data = {
    name: char.name,
    description: char.personality ?? '',
    personality: '',
    first_mes: char.firstMessage ?? '',
    mes_example: char.exampleDialogue ?? '',
    scenario: char.scenario ?? '',
    creator_notes: char.creatorNotes ?? '',
    system_prompt: char.systemPromptOverride ?? ''
  }
  return JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data
  })
}
