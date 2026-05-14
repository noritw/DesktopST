import type { AppSettings, Message, PersonaPreset, WorldPreset } from '../types'

/** Returns the API key for the active provider, falling back to legacy apiKey field */
export function resolveApiKey(settings: AppSettings): string {
  return settings.llm.apiKeys?.[settings.llm.provider] || settings.llm.apiKey || ''
}

/** Returns the model for the active provider, falling back to the legacy single model field */
export function resolveModel(settings: AppSettings): string {
  return settings.llm.models?.[settings.llm.provider] || settings.llm.model || ''
}

export const EMOTION_LIST = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval',
  'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
  'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
  'gratitude', 'grief', 'joy', 'love', 'nervousness',
  'optimism', 'pride', 'realization', 'relief', 'remorse',
  'sadness', 'surprise', 'neutral'
]

const EMOTION_ALIASES: Record<string, string> = {
  admire: 'admiration',
  admired: 'admiration',
  amused: 'amusement',
  angry: 'anger',
  annoyed: 'annoyance',
  approving: 'approval',
  caring: 'caring',
  confused: 'confusion',
  curious: 'curiosity',
  disappointed: 'disappointment',
  disapproving: 'disapproval',
  disgusted: 'disgust',
  embarrassed: 'embarrassment',
  excited: 'excitement',
  fearful: 'fear',
  afraid: 'fear',
  grateful: 'gratitude',
  grieving: 'grief',
  joyful: 'joy',
  loving: 'love',
  nervous: 'nervousness',
  optimistic: 'optimism',
  proud: 'pride',
  realized: 'realization',
  relieved: 'relief',
  remorseful: 'remorse',
  sad: 'sadness',
  surprised: 'surprise',
  calm: 'neutral',
  normal: 'neutral'
}

export function normalizeEmotion(raw: string | undefined | null): string | null {
  const normalized = String(raw ?? '').trim().toLowerCase()
  if (EMOTION_LIST.includes(normalized)) return normalized
  return EMOTION_ALIASES[normalized] ?? null
}

export type PromptCharacter = {
  id?: string
  name: string
  personality: string
  scenario?: string
  systemPromptOverride?: string
  exampleDialogue?: string
  emotions?: Record<string, string>
  spriteIds?: Record<string, string>
}

export type ChatLLMParams = {
  settings: AppSettings
  character: PromptCharacter
  messages: Message[]
  images?: string[]
  speakerNameById?: Record<string, string>
  persona?: PersonaPreset | null
  world?: WorldPreset | null
  desktopCharacterNames?: string[]  // names of all characters currently on desktop
}

export type ChatLLMResult = {
  content: string
  emotion: string
  debugPrompt: string
}

export function sanitizePromptText(text: string | undefined | null): string {
  return String(text ?? '')
    .replace(/\[object Object\]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function applyStStyleTags(
  text: string | undefined | null,
  vars: { userName: string; charName: string }
): string {
  const clean = sanitizePromptText(text)
  return clean
    .replace(/\{\{\s*user\s*\}\}/gi, vars.userName)
    .replace(/\{\{\s*char\s*\}\}/gi, vars.charName)
}

function stemFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '')
}

/**
 * Builds the emotion ID list for the Output Contract.
 * If the character has sprites with assigned emotions, returns custom IDs with descriptions.
 * Otherwise returns the default 28-emotion list string.
 */
export function buildEmotionContract(char: PromptCharacter): { ids: string; descriptions: string[] } {
  const emotions = char.emotions ?? {}
  const spriteIds = char.spriteIds ?? {}

  // Group emotions by imagePath
  const pathToEmotions = new Map<string, string[]>()
  for (const [emo, p] of Object.entries(emotions)) {
    if (!p?.trim()) continue
    const list = pathToEmotions.get(p) ?? []
    list.push(emo)
    pathToEmotions.set(p, list)
  }

  if (pathToEmotions.size === 0) {
    return { ids: EMOTION_LIST.join(', '), descriptions: [] }
  }

  const entries: { id: string; emotions: string[] }[] = []
  for (const [imagePath, assignedEmotions] of pathToEmotions) {
    const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
    const id = spriteIds[imagePath]?.trim() || stemFromFilename(filename)
    entries.push({ id, emotions: assignedEmotions })
  }

  const ids = entries.map(e => e.id).join(', ')
  const descriptions = entries.map(e => `  - ${e.id}: use for ${e.emotions.join(', ')}`)
  return { ids, descriptions }
}

export function buildTimeMoodGuideline(hours: number): string {
  if (hours < 5) return 'Late night / early morning — tone may lean toward companionship and tenderness.'
  if (hours < 8) return 'Early morning — naturally reference waking up or not having slept.'
  if (hours < 11) return 'Morning — tone may reflect the start of a new day.'
  if (hours < 14) return 'Around noon / lunchtime — can naturally mention meals or taking a break.'
  if (hours < 18) return 'Afternoon — tone may reflect being mid-day or busy with routine.'
  if (hours < 22) return 'Evening — tone may lean toward winding down, relaxing, or spending time together.'
  return 'Late evening (around 10–11 PM) — tone may relax slightly, but keep it natural.'
}

// Matches ASCII word chars or CJK unified ideographs — used for custom emotion IDs
const EMOTION_TOKEN = /[a-z_一-鿿㐀-䶿]+/i

/** Returns the flat list of effective emotion IDs for a character (used to parse bare CJK tags). */
export function buildEmotionIdList(char: PromptCharacter): string[] {
  const { ids } = buildEmotionContract(char)
  return ids.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * knownEmotionIds — pass the character's sprite ID list so bare CJK tags on their own line
 * (e.g. "閉眼臉紅\n...") can be identified and stripped. Without this list the function will
 * not attempt to parse bare CJK tokens (safe fallback).
 */
export function parseEmotion(text: string, knownEmotionIds?: string[]): { emotion: string; content: string } {
  const source = sanitizePromptText(text)
  let detectedEmotion = 'neutral'
  let content = source

  for (let i = 0; i < 3; i++) {
    const before = content

    // Match "[amused]" or "[emotion: 微笑]" etc.
    const bracketRe = new RegExp(
      `^\\s*\\[\\s*(?:(?:emotion|mood|feeling|情緒)\\s*[:=：]\\s*)?(${EMOTION_TOKEN.source})\\s*\\]\\s*`,
      'i'
    )
    const bracketMatch = content.match(bracketRe)
    if (bracketMatch) {
      const raw = bracketMatch[1]
      detectedEmotion = normalizeEmotion(raw) ?? raw
      content = content.slice(bracketMatch[0].length).trim()
      continue
    }

    // Match "emotion: xxx" or "emotion: 微笑" on the first line.
    const kvRe = new RegExp(
      `^\\s*(?:emotion|mood|feeling|情緒)\\s*[:=：]\\s*(${EMOTION_TOKEN.source})\\s*(?:\\r?\\n|$)`,
      'i'
    )
    const kvMatch = content.match(kvRe)
    if (kvMatch) {
      const raw = kvMatch[1]
      detectedEmotion = normalizeEmotion(raw) ?? raw
      content = content.slice(kvMatch[0].length).trim()
      continue
    }

    // Match a bare leading ASCII emotion token (e.g. "amused會。") — intentionally no CJK
    // to avoid consuming the start of Chinese dialogue.
    const bareMatch = content.match(/^\s*([a-z_]+)(?=$|[\s:=,，.。!！?？;；\-]|[㐀-鿿])/i)
    const bareEmotion = normalizeEmotion(bareMatch?.[1])
    if (bareMatch && bareEmotion) {
      detectedEmotion = bareEmotion
      content = content
        .slice(bareMatch[0].length)
        .replace(/^\s*[:=,，.。!！?？;；\-]?\s*/, '')
        .trim()
      continue
    }

    // Match a bare CJK-only token on its own line — only when it exactly matches a known sprite ID.
    // No heuristic fallback to avoid accidentally stripping the start of Chinese dialogue.
    if (knownEmotionIds && knownEmotionIds.length > 0) {
      const bareCjkMatch = content.match(/^\s*([一-鿿㐀-䶿]{1,12})\s*(?:\r?\n)/)
      if (bareCjkMatch && knownEmotionIds.includes(bareCjkMatch[1])) {
        detectedEmotion = bareCjkMatch[1]
        content = content.slice(bareCjkMatch[0].length).trim()
        continue
      }
    }

    if (content === before) break
  }

  return {
    emotion: detectedEmotion,
    content: content || source
  }
}

export function messageSpeakerLabel(
  message: Message,
  persona?: PersonaPreset | null,
  speakerNameById?: Record<string, string>
): string {
  if (message.role === 'user') {
    return persona?.displayName?.trim() || persona?.nickname?.trim() || '使用者'
  }
  if (message.role === 'character') {
    return (message.characterId && speakerNameById?.[message.characterId]) || '其他角色'
  }
  return '系統'
}

export function buildSystemPrompt(
  settings: AppSettings,
  char: PromptCharacter,
  persona?: PersonaPreset | null,
  world?: WorldPreset | null,
  desktopCharacterNames?: string[]
): string {
  const now = new Date()
  const hours = now.getHours()
  const timeLabel =
    hours < 5 ? '深夜' : hours < 8 ? '清晨' : hours < 12 ? '上午' :
    hours < 13 ? '中午' : hours < 18 ? '下午' : hours < 19 ? '傍晚' :
    hours < 23 ? '晚上' : '深夜'
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timeLabel}`

  const parts: string[] = [
    [
      '[Identity]',
      `You are "${char.name}". Stay in character at all times.`,
      'Do not mention AI/model/system prompt.'
    ].join('\n'),
    [
      '[Priority]',
      '1) Character consistency > generic helpful tone.',
      '2) Character DNA > neutral assistant phrasing.',
      '3) Write only the next in-character reply.'
    ].join('\n')
  ]

  const displayName = sanitizePromptText(persona?.displayName) || '使用者'
  const nickname = sanitizePromptText(persona?.nickname) || displayName
  const tagVars = {
    userName: nickname || displayName,
    charName: sanitizePromptText(char.name) || '角色'
  }

  const override = applyStStyleTags(char.systemPromptOverride, tagVars)
  const personality = applyStStyleTags(char.personality, tagVars)
  const scenario = applyStStyleTags(char.scenario, tagVars)
  const exampleDialogue = applyStStyleTags(char.exampleDialogue, tagVars)
  if (override || personality || scenario || exampleDialogue) {
    parts.push([
      '[Character DNA]',
      ...(override ? [override] : []),
      ...(personality ? [personality] : []),
      ...(scenario ? [`[Current Scene]\n${scenario}`] : []),
      ...(exampleDialogue ? [`[Style Examples]\n${exampleDialogue}`] : [])
    ].join('\n\n'))
  }

  const { ids: emotionIds, descriptions: emotionDescs } = buildEmotionContract(char)
  const emotionLine = emotionDescs.length > 0
    ? `- First line MUST be a bracket tag "[{emotion_id}]" where emotion_id is one of: ${emotionIds}\n  Emotion guide:\n${emotionDescs.join('\n')}\n  Example first line: [${emotionIds.split(',')[0].trim()}]`
    : `- First line MUST be "emotion: {emotion_name}" where emotion_name is one of: ${emotionIds}`

  parts.push([
    '[Output Contract]',
    emotionLine,
    '- Then spoken dialogue only (no narration, no stage directions, no inner monologue).',
    '- Do NOT write long narrative paragraphs. Do NOT include environmental descriptions (e.g. no "陽光灑落", no "魔法粒子在空中飛舞"). Desktop pets speak in quick, casual bursts, not roleplay novels.',
    '- Never prefix lines with the character name (e.g. "Name: …"). Output the dialogue directly.',
    '- Do not wrap the entire reply in outer quotation marks (「」/『』/""). Use quotes only when quoting someone else.',
    '- If the reply has multiple sentences, put each on its own line.',
    '- Show at least 1 voice trait and 1 relationship attitude from Character DNA.',
    '- Never use assistant-style offers such as "要不要我幫你", "我可以幫你", "你可以試試".',
    '- Do not adopt a tutorial, customer-service, consultant, or task-breakdown tone.',
    `- You speak only as "${tagVars.charName}". Never speak for other characters or output lines starting with another character's name.`,
    '- Default reply length: 1–3 sentences, unless the user explicitly asks for more.',
    '- Write entirely in Traditional Chinese (Taiwan usage).'
  ].join('\n'))

  const worldSetting = applyStStyleTags(world?.worldSetting, tagVars)
  if (worldSetting) {
    parts.push(`[World Context]\n${worldSetting}`)
  }

  if (persona?.displayName?.trim() || persona?.nickname?.trim() || persona?.description?.trim()) {
    const description = sanitizePromptText(persona?.description)
    parts.push([
      '[User Profile]',
      `name: ${displayName}`,
      `preferred_name: ${nickname}`,
      ...(description ? [`notes: ${description}`] : [])
    ].join('\n'))
  }

  const interactionExample = applyStStyleTags(world?.interactionExample, tagVars)
  if (interactionExample) {
    parts.push(`[Interaction Hints]\n${interactionExample}`)
  }

  if (settings.injectSystemTime) {
    parts.push(`[System Time]\n${timeStr}`)
    parts.push([
      '[Time Tone]',
      `- ${buildTimeMoodGuideline(hours)}`,
      '- Keep time references brief (1-2 short lines), natural, and in character.',
      '- Never turn time cues into workflow advice or coaching tone.'
    ].join('\n'))
  }

  if (desktopCharacterNames && desktopCharacterNames.length > 0) {
    const others = desktopCharacterNames.filter(n => n !== char.name)
    const selfLine = `- ${char.name}（你）`
    const otherLines = others.map(n => `- ${n}`)
    parts.push([
      '[Co-present Characters]',
      'Characters currently on the desktop (visible together):',
      selfLine,
      ...otherLines
    ].join('\n'))
  }

  return parts.join('\n\n')
}
