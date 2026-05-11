import OpenAI from 'openai'
import type { AppSettings, Message, PersonaPreset, WorldPreset } from '../types'

const EMOTION_LIST = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval',
  'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
  'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
  'gratitude', 'grief', 'joy', 'love', 'nervousness',
  'optimism', 'pride', 'realization', 'relief', 'remorse',
  'sadness', 'surprise', 'neutral'
]

type PromptCharacter = {
  id?: string
  name: string
  personality: string
  scenario?: string
  systemPromptOverride?: string
  exampleDialogue?: string
}

function sanitizePromptText(text: string | undefined | null): string {
  return String(text ?? '')
    .replace(/\[object Object\]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function applyStStyleTags(
  text: string | undefined | null,
  vars: { userName: string; charName: string }
): string {
  const clean = sanitizePromptText(text)
  return clean
    .replace(/\{\{\s*user\s*\}\}/gi, vars.userName)
    .replace(/\{\{\s*char\s*\}\}/gi, vars.charName)
}

function buildTimeMoodGuideline(hours: number): string {
  if (hours < 5) return 'Late night / early morning — tone may lean toward companionship and tenderness.'
  if (hours < 8) return 'Early morning — naturally reference waking up or not having slept.'
  if (hours < 11) return 'Morning — tone may reflect the start of a new day.'
  if (hours < 14) return 'Around noon / lunchtime — can naturally mention meals or taking a break.'
  if (hours < 18) return 'Afternoon — tone may reflect being mid-day or busy with routine.'
  if (hours < 22) return 'Evening — tone may lean toward winding down, relaxing, or spending time together.'
  return 'Late night — tone may be more intimate, but keep it natural.'
}

function parseEmotion(text: string): { emotion: string; content: string } {
  const source = sanitizePromptText(text)
  let detectedEmotion = 'neutral'
  let content = source

  const pickEmotion = (raw: string | undefined | null): string | null => {
    const normalized = String(raw ?? '').trim().toLowerCase()
    return EMOTION_LIST.includes(normalized) ? normalized : null
  }

  // Preferred format: [emotion]
  const bracketMatch = content.match(/^\[\s*([a-z_]+)\s*\]\s*/i)
  const bracketEmotion = pickEmotion(bracketMatch?.[1])
  if (bracketMatch && bracketEmotion) {
    detectedEmotion = bracketEmotion
    content = content.slice(bracketMatch[0].length).trim()
  }

  // Fallback formats: emotion: xxx / 情緒: xxx / xxx: ...
  if (!content || detectedEmotion === 'neutral') {
    const kvMatch = content.match(/^(?:emotion|mood|feeling|情緒)\s*[:=：]\s*([a-z_]+)\s*/i)
    const kvEmotion = pickEmotion(kvMatch?.[1])
    if (kvMatch && kvEmotion) {
      detectedEmotion = kvEmotion
      content = content.slice(kvMatch[0].length).trim()
    }
  }

  // Last fallback: output starts with bare emotion token (e.g. "confusion ...")
  if (!content || detectedEmotion === 'neutral') {
    const bareMatch = content.match(/^([a-z_]+)(?=\s|$|[：:,.!?，。！？])/i)
    const bareEmotion = pickEmotion(bareMatch?.[1])
    if (bareMatch && bareEmotion) {
      detectedEmotion = bareEmotion
      content = content.slice(bareMatch[0].length).trim()
      // Drop one punctuation token if model emitted "confusion: ..."
      content = content.replace(/^[：:,\-–—\s]+/, '').trim()
    }
  }

  return {
    emotion: detectedEmotion,
    content: content || source
  }
}

function buildSystemPrompt(settings: AppSettings, char: PromptCharacter, persona?: PersonaPreset | null, world?: WorldPreset | null): string {
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

  parts.push([
    '[Output Contract]',
    `- Start with [emotion], allowed: ${EMOTION_LIST.join(', ')}`,
    '- Then spoken dialogue only (no narration, no stage directions, no inner monologue).',
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

  return parts.join('\n\n')
}

function toOpenAIInputContent(text: string, images?: string[]) {
  const cleanText = sanitizePromptText(text)
  if (!images || images.length === 0) return cleanText
  return [
    { type: 'input_text' as const, text: cleanText },
    ...images.map(url => ({ type: 'input_image' as const, image_url: url }))
  ]
}

function extractInputText(
  content: string | Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>
): string {
  if (typeof content === 'string') return content
  const textPart = content.find(part => part.type === 'input_text')
  return textPart?.text ?? ''
}

function messageSpeakerLabel(
  message: Message,
  persona?: PersonaPreset | null,
  speakerNameById?: Record<string, string>
): string {
  if (message.role === 'user') {
    return persona?.displayName?.trim()
      || persona?.nickname?.trim()
      || '使用者'
  }
  if (message.role === 'character') {
    return (message.characterId && speakerNameById?.[message.characterId]) || '其他角色'
  }
  return '系統'
}

function shouldOmitTemperature(model: string): boolean {
  return /^gpt-5(\.|-|$)/i.test(model) || /^o\d/i.test(model)
}

function extractResponseText(resp: unknown): string {
  const anyResp = resp as { output_text?: string; output?: unknown[] }
  if (typeof anyResp?.output_text === 'string') return anyResp.output_text

  const out = Array.isArray(anyResp?.output) ? anyResp.output : []
  for (const item of out) {
    const it = item as { type?: string; role?: string; content?: unknown[] }
    if (it?.type !== 'message' || it?.role !== 'assistant' || !Array.isArray(it.content)) continue
    for (const c of it.content) {
      const cc = c as { type?: string; text?: string }
      if (cc?.type === 'output_text' && typeof cc.text === 'string') return cc.text
    }
  }
  return ''
}

export async function chatWithOpenAI(params: {
  settings: AppSettings
  character: PromptCharacter
  messages: Message[]
  images?: string[]
  speakerNameById?: Record<string, string>
  persona?: PersonaPreset | null
  world?: WorldPreset | null
}): Promise<{ content: string; emotion: string; debugPrompt: string }> {
  const { settings, character, messages, images, speakerNameById, persona, world } = params

  const client = new OpenAI({
    apiKey: settings.llm.apiKey,
    baseURL: settings.llm.endpoint || undefined
  })

  const systemPrompt = buildSystemPrompt(settings, character, persona, world)

  const input: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>
  }> = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => {
      const isOwnCharacterMessage = m.role === 'character' && !!character.id && m.characterId === character.id
      const role: 'user' | 'assistant' = isOwnCharacterMessage ? 'assistant' : 'user'
      const label = messageSpeakerLabel(m, persona, speakerNameById)
      const cleanContent = sanitizePromptText(m.content)
      const text = isOwnCharacterMessage ? cleanContent : `【${label}】\n${cleanContent}`
      const content = role === 'user'
        ? toOpenAIInputContent(text, m.images && m.images.length > 0 ? m.images : undefined)
        : text
      return { role, content }
    })
  ]

  // If the caller passes fresh images, attach to the last user message.
  if (images && images.length > 0 && input.length > 0) {
    for (let i = input.length - 1; i >= 0; i--) {
      const item = input[i]
      if (item.role === 'user') {
        const baseText = extractInputText(item.content)
        input[i] = { role: 'user', content: toOpenAIInputContent(baseText, images) }
        break
      }
    }
  }

  const body: Record<string, unknown> = {
    model: settings.llm.model,
    input: input as unknown as any,
    max_output_tokens: settings.llm.maxResponseTokens * 3
  }
  if (!shouldOmitTemperature(settings.llm.model)) {
    body.temperature = settings.llm.temperature
  }
  const debugPrompt = JSON.stringify({
    provider: 'openai',
    model: settings.llm.model,
    endpoint: settings.llm.endpoint || 'default',
    max_output_tokens: body.max_output_tokens,
    temperature: body.temperature,
    input
  }, null, 2)

  const resp = await client.responses.create(body as any)

  const raw = extractResponseText(resp)
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Empty response from model: ${settings.llm.model}`)
  }
  return { ...parseEmotion(raw), debugPrompt }
}
