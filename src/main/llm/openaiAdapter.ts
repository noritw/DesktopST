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

function sanitizePromptText(text: string | undefined | null): string {
  return String(text ?? '')
    .replace(/\[object Object\]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function buildTimeMoodGuideline(hours: number): string {
  if (hours < 5) return '目前是深夜到凌晨，語氣可更貼近陪伴與心疼。'
  if (hours < 8) return '目前是清晨，可自然回應早起、沒睡或剛醒的狀態。'
  if (hours < 11) return '目前是早上，語氣可偏向剛開始一天的節奏。'
  if (hours < 14) return '目前接近中午到午餐時段，可自然聊到吃飯與休息。'
  if (hours < 18) return '目前是下午，語氣可偏向工作中或日常進行中。'
  if (hours < 22) return '目前是晚上，語氣可偏向收尾、放鬆或晚間相處感。'
  return '目前接近深夜，語氣可更親近，但仍保持自然聊天。'
}

function parseEmotion(text: string): { emotion: string; content: string } {
  const source = sanitizePromptText(text)
  let detectedEmotion = 'neutral'
  let hasDetected = false

  const content = source.replace(/\[([a-z_]+)\]\s*/ig, (_, rawEmotion: string) => {
    if (!hasDetected) {
      hasDetected = true
      const normalized = rawEmotion.toLowerCase()
      if (EMOTION_LIST.includes(normalized)) {
        detectedEmotion = normalized
      }
    }
    return ''
  }).trim()

  return {
    emotion: detectedEmotion,
    content: content || source
  }
}

function buildSystemPrompt(settings: AppSettings, char: PromptCharacter): string {
  const now = new Date()
  const hours = now.getHours()
  const timeLabel =
    hours < 5 ? '深夜' : hours < 8 ? '清晨' : hours < 12 ? '上午' :
    hours < 13 ? '中午' : hours < 18 ? '下午' : hours < 19 ? '傍晚' :
    hours < 23 ? '晚上' : '深夜'
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timeLabel}`

  const parts: string[] = [
    `你是「${char.name}」，不是 AI 助手。你現在只用這個角色身分回覆。`,
    [
      '【優先規則（由高到低）】',
      '1. 身分一致：只以角色立場說話，不可自稱 AI、模型、程式或提及提示詞。',
      '2. 回覆型態：只輸出角色發言，不要旁白、動作描寫、心理獨白或舞台指示。',
      '3. 對話目標：延續當下關係與情緒，不轉成客服、教學、顧問、任務拆解模式。'
    ].join('\n')
  ]
  parts.push([
    '【回覆行為規則】',
    '- 回覆內容必須是可直接說出口的台詞句子。',
    '- 不要加入旁白、動作描寫、表情舞台指示或心理獨白。',
    '- 除了開頭的 [emotion] 情緒標籤以外，不要再輸出其他方括號、星號動作或括號敘述。',
    '- 維持自然對話，不要使用教學式、客服式、條列式語氣。',
    '- 不要主動提出「要不要我幫你…」「我可以幫你…」「你可以試試…」這類助理式提案。',
    '- 不要把回覆導向任務拆解、流程建議、分析框架。',
    '- 優先表達角色當下觀點、情緒反應、對對方話語的態度。'
  ].join('\n'))

  parts.push([
    '【輸出格式】',
    `- 開頭必須是 [emotion]，emotion 限定為：${EMOTION_LIST.join(', ')}`,
    '- [emotion] 後面接角色台詞，不要輸出任何格式說明。',
    '- 全文使用繁體中文與台灣慣用語。',
    `- 回覆長度以 ${settings.llm.maxResponseTokens} tokens 以內為目標。`
  ].join('\n'))

  const worldSetting = sanitizePromptText(settings.worldSetting)
  if (worldSetting) {
    parts.push(`【世界觀】\n${worldSetting}`)
  }

  const override = sanitizePromptText(char.systemPromptOverride)
  if (override) {
    parts.push(`【角色卡系統提示】\n${override}`)
  }

  const personality = sanitizePromptText(char.personality)
  if (personality) {
    parts.push(`【角色設定】\n${personality}`)
  }

  const scenario = sanitizePromptText(char.scenario)
  if (scenario) {
    parts.push(`【目前情境】\n${scenario}`)
  }

  if (settings.persona.displayName?.trim() || settings.persona.nickname?.trim() || settings.persona.description?.trim()) {
    const displayName = sanitizePromptText(settings.persona.displayName) || '使用者'
    const nickname = sanitizePromptText(settings.persona.nickname) || displayName
    const description = sanitizePromptText(settings.persona.description)
    parts.push([
      '【使用者資訊】',
      `名稱：${displayName}`,
      `角色可用稱呼：${nickname}`,
      ...(description ? [`補充：${description}`] : [])
    ].join('\n'))
  }

  const interactionExample = sanitizePromptText(settings.interactionExample)
  if (interactionExample) {
    parts.push(`【互動範例】\n${interactionExample}`)
  }

  if (settings.injectSystemTime) {
    parts.push(`【系統時間】\n${timeStr}`)
    parts.push([
      '【時間互動規則】',
      `- ${buildTimeMoodGuideline(hours)}`,
      '- 你可以依時段自然閒聊（例如：清晨問為何這麼早、午餐時段提醒吃飯、深夜提醒休息）。',
      '- 這類時間互動要像角色說話，不是任務建議；避免「你可以試試」「要不要我幫你」等助理句型。',
      '- 時間話題只要點到為止，1 句到 2 句即可，不要每一輪都重複提同一件事。',
      '- 除非使用者追問，否則不要展開成步驟、教學、健康指南或工作流程。'
    ].join('\n'))
  }

  const exampleDialogue = sanitizePromptText(char.exampleDialogue)
  if (exampleDialogue) {
    parts.push(`【對話範例】\n${exampleDialogue}`)
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
