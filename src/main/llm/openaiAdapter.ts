import OpenAI from 'openai'
import {
  buildSystemPrompt, buildTriggerMessage, buildEmotionIdList, parseEmotion, sanitizePromptText, messageSpeakerLabel, resolveApiKey,
  resolveModel, type PromptCharacter, type ChatLLMParams, type ChatLLMResult
} from './promptUtils'

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

export { type PromptCharacter, type ChatLLMParams, type ChatLLMResult }

export async function chatWithOpenAI(params: ChatLLMParams): Promise<ChatLLMResult> {
  const { settings, character, messages, images, speakerNameById, persona, world } = params
  const model = resolveModel(settings)

  const client = new OpenAI({
    apiKey: resolveApiKey(settings),
    baseURL: settings.llm.endpoint || undefined
  })

  const systemPrompt = buildSystemPrompt(settings, character, persona, world, params.desktopCharacterNames)

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

  // Trigger injected after conversation history
  input.push({ role: 'user', content: buildTriggerMessage(character.name) })

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
    model,
    input: input as unknown as any,
    max_output_tokens: settings.llm.maxResponseTokens * 3
  }
  if (!shouldOmitTemperature(model)) {
    body.temperature = settings.llm.temperature
  }

  const debugPrompt = JSON.stringify({
    provider: 'openai',
    model,
    endpoint: settings.llm.endpoint || 'default',
    max_output_tokens: body.max_output_tokens,
    temperature: body.temperature,
    input
  }, null, 2)

  const resp = await client.responses.create(body as any)
  const raw = extractResponseText(resp)
  if (!raw || raw.trim().length === 0) {
    throw new Error(`Empty response from model: ${model}`)
  }
  return { ...parseEmotion(raw, buildEmotionIdList(params.character)), debugPrompt }
}
