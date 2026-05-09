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

function buildSystemPrompt(
  settings: AppSettings,
  char: { name: string; personality: string; scenario?: string; systemPromptOverride?: string; exampleDialogue?: string }
): string {
  const now = new Date()
  const hours = now.getHours()
  const timeLabel =
    hours < 5 ? '凌晨' : hours < 8 ? '清晨' : hours < 12 ? '上午' :
    hours < 13 ? '中午' : hours < 18 ? '下午' : hours < 19 ? '傍晚' :
    hours < 23 ? '晚上' : '深夜'
  const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(hours).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')} ${timeLabel}`

  if (char.systemPromptOverride) return char.systemPromptOverride

  const parts: string[] = []

  if (settings.worldSetting) parts.push(settings.worldSetting)

  parts.push(`你是${char.name}。以下是你的設定：\n${char.personality}`)

  if (char.scenario) parts.push(`【場景】\n${char.scenario}`)

  if (settings.persona.displayName) {
    parts.push(`【使用者資料】\n名稱：${settings.persona.displayName}（稱呼：${settings.persona.nickname || settings.persona.displayName}）${settings.persona.description ? '\n' + settings.persona.description : ''}`)
  }

  if (settings.injectSystemTime) {
    parts.push(`【目前時間】${timeStr}`)
    parts.push('規則：若使用者詢問時間，請直接用「【目前時間】」中的時間回答；若未詢問，也請在自然的時機點主動提到一次目前時間（不要每句都提）。')
  }

  parts.push(`你的回應必須以 [情緒] 標記開頭，從以下清單選一個：\n${EMOTION_LIST.join(', ')}\n範例：[joy] 今天天氣真好！`)

  parts.push(`請控制每則回應在 ${settings.llm.maxResponseTokens} 字以內。`)

  if (char.exampleDialogue) {
    parts.push(`【對話範例】\n${char.exampleDialogue}`)
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

function shouldOmitTemperature(model: string): boolean {
  // 部分推理/新模型對 sampling 參數限制較多，先採保守策略避免整個請求被拒。
  // 後續若要更精細，可依官方文件/實測調整。
  return /^gpt-5(\.|-|$)/i.test(model) || /^o\d/i.test(model)
}

function extractResponseText(resp: unknown): string {
  // The JS SDK exposes `output_text` on Responses objects, but keep a fallback
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
  character: { name: string; personality: string; scenario?: string; systemPromptOverride?: string; exampleDialogue?: string }
  messages: Message[]
  images?: string[]
}): Promise<{ content: string; emotion: string }> {
  const { settings, character, messages, images } = params

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
      const role: 'user' | 'assistant' = m.role === 'user' ? 'user' : 'assistant'
      const content =
        role === 'user'
          ? toOpenAIInputContent(m.content, m.images && m.images.length > 0 ? m.images : undefined)
          : m.content
      return { role, content }
    })
  ]

  // If the caller passes fresh images, attach to the last user message (common "send" flow)
  if (images && images.length > 0 && input.length > 0) {
    for (let i = input.length - 1; i >= 0; i--) {
      if (input[i].role === 'user') {
        const baseText = (typeof input[i].content === 'string' ? input[i].content : '') as string
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

  const resp = await client.responses.create(body as any)

  const raw = extractResponseText(resp)
  return parseEmotion(raw)
}
