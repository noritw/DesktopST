import OpenAI from 'openai'
import type { AppSettings, Message } from '../types'

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

function parseEmotion(text: string): { emotion: string; content: string } {
  const match = text.match(/^\[([a-z_]+)\]\s*/i)
  if (match) {
    const emotion = match[1].toLowerCase()
    return {
      emotion: EMOTION_LIST.includes(emotion) ? emotion : 'neutral',
      content: text.slice(match[0].length).trim()
    }
  }
  return { emotion: 'neutral', content: text }
}

function buildSystemPrompt(settings: AppSettings, char: PromptCharacter): string {
  const now = new Date()
  const hours = now.getHours()
  const timeLabel =
    hours < 5 ? '深夜' : hours < 8 ? '清晨' : hours < 12 ? '上午' :
    hours < 13 ? '中午' : hours < 18 ? '下午' : hours < 19 ? '傍晚' :
    hours < 23 ? '晚上' : '深夜'
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timeLabel}`

  const parts: string[] = []

  if (settings.worldSetting?.trim()) {
    parts.push(`【世界觀】\n${settings.worldSetting.trim()}`)
  }

  if (char.systemPromptOverride?.trim()) {
    parts.push(`【角色卡系統提示】\n${char.systemPromptOverride.trim()}`)
  }

  parts.push(`你正在扮演「${char.name}」。請始終以這個角色的口吻、知識範圍與情緒反應回答。`)

  if (char.personality?.trim()) {
    parts.push(`【角色設定】\n${char.personality.trim()}`)
  }

  if (char.scenario?.trim()) {
    parts.push(`【目前情境】\n${char.scenario.trim()}`)
  }

  if (settings.persona.displayName?.trim() || settings.persona.nickname?.trim() || settings.persona.description?.trim()) {
    const displayName = settings.persona.displayName?.trim() || '使用者'
    const nickname = settings.persona.nickname?.trim() || displayName
    const description = settings.persona.description?.trim()
    parts.push([
      '【使用者資訊】',
      `名稱：${displayName}`,
      `角色可用稱呼：${nickname}`,
      ...(description ? [`補充：${description}`] : [])
    ].join('\n'))
  }

  if (settings.interactionExample?.trim()) {
    parts.push(`【互動範例】\n${settings.interactionExample.trim()}`)
  }

  if (settings.injectSystemTime) {
    parts.push(`【系統時間】\n${timeStr}`)
    parts.push('除非使用者詢問時間、日期、天氣感受或當下情境，請不要主動報時；只把它作為角色理解目前時段的背景。')
  }

  parts.push(`回覆格式：請在回答最前面加上一個情緒標籤，格式為 [emotion]，emotion 必須是以下其中之一：\n${EMOTION_LIST.join(', ')}\n例如：[joy] 今天也一起慢慢來吧。`)

  parts.push(`請用繁體中文自然回覆，保持角色扮演，不要跳出角色。回覆長度以 ${settings.llm.maxResponseTokens} tokens 以內為目標。`)

  if (char.exampleDialogue?.trim()) {
    parts.push(`【對話範例】\n${char.exampleDialogue.trim()}`)
  }

  return parts.join('\n\n')
}

function toOpenAIInputContent(text: string, images?: string[]) {
  if (!images || images.length === 0) return text
  return [
    { type: 'input_text' as const, text },
    ...images.map(url => ({ type: 'input_image' as const, image_url: url }))
  ]
}

function messageSpeakerLabel(
  message: Message,
  settings: AppSettings,
  speakerNameById?: Record<string, string>
): string {
  if (message.role === 'user') {
    return settings.persona.displayName?.trim()
      || settings.persona.nickname?.trim()
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
}): Promise<{ content: string; emotion: string; debugPrompt: string }> {
  const { settings, character, messages, images, speakerNameById } = params

  const client = new OpenAI({
    apiKey: settings.llm.apiKey,
    baseURL: settings.llm.endpoint || undefined
  })

  const systemPrompt = buildSystemPrompt(settings, character)

  const input: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | Array<{ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string }>
  }> = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => {
      const isOwnCharacterMessage = m.role === 'character' && !!character.id && m.characterId === character.id
      const role: 'user' | 'assistant' = isOwnCharacterMessage ? 'assistant' : 'user'
      const label = messageSpeakerLabel(m, settings, speakerNameById)
      const text = isOwnCharacterMessage ? m.content : `【${label}】\n${m.content}`
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
        const baseText = typeof item.content === 'string' ? item.content : ''
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
