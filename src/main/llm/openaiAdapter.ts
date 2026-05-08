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
  }

  parts.push(`你的回應必須以 [情緒] 標記開頭，從以下清單選一個：\n${EMOTION_LIST.join(', ')}\n範例：[joy] 今天天氣真好！`)

  parts.push(`請控制每則回應在 ${settings.llm.maxResponseTokens} 字以內。`)

  if (char.exampleDialogue) {
    parts.push(`【對話範例】\n${char.exampleDialogue}`)
  }

  return parts.join('\n\n')
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

  // Build message history for OpenAI format
  const history: OpenAI.ChatCompletionMessageParam[] = messages.map(m => {
    if (m.role === 'user') {
      if (m.images && m.images.length > 0) {
        return {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: m.content },
            ...m.images.map(img => ({
              type: 'image_url' as const,
              image_url: { url: img }
            }))
          ]
        }
      }
      return { role: 'user' as const, content: m.content }
    }
    return { role: 'assistant' as const, content: m.content }
  })

  // Attach latest images to last user message if any
  if (images && images.length > 0 && history.length > 0) {
    const last = history[history.length - 1]
    if (last.role === 'user' && typeof last.content === 'string') {
      history[history.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: last.content as string },
          ...images.map(img => ({ type: 'image_url' as const, image_url: { url: img } }))
        ]
      }
    }
  }

  const resp = await client.chat.completions.create({
    model: settings.llm.model,
    temperature: settings.llm.temperature,
    max_tokens: settings.llm.maxResponseTokens * 3,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history
    ]
  })

  const raw = resp.choices[0]?.message?.content ?? ''
  return parseEmotion(raw)
}
