import { chatWithOpenAI } from './openaiAdapter'
import { chatWithClaude } from './claudeAdapter'
import { chatWithGemini } from './geminiAdapter'
import type { ChatLLMParams, ChatLLMResult } from './promptUtils'

export { type ChatLLMParams, type ChatLLMResult }

export async function chatWithLLM(params: ChatLLMParams): Promise<ChatLLMResult> {
  const { provider } = params.settings.llm
  switch (provider) {
    case 'claude':
      return chatWithClaude(params)
    case 'gemini':
      return chatWithGemini(params)
    case 'grok': {
      // Grok is OpenAI-compatible; use endpoint override
      const grokSettings = {
        ...params.settings,
        llm: {
          ...params.settings.llm,
          endpoint: params.settings.llm.endpoint || 'https://api.x.ai/v1'
        }
      }
      return chatWithOpenAI({ ...params, settings: grokSettings })
    }
    case 'openai':
    default:
      return chatWithOpenAI(params)
  }
}

// Provider-aware connection test: returns { ok, models?, error? }
export async function testLLMConnection(params: {
  provider: string
  apiKey: string
  apiKeys?: Record<string, string>
  endpoint?: string
}): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const { provider, endpoint } = params
  const apiKey = params.apiKeys?.[provider] || params.apiKey
  if (!apiKey) return { ok: false, error: '尚未填寫 API Key' }

  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey })
      const resp = await client.models.list()
      const models: string[] = []
      for (const m of resp.data) {
        models.push(m.id)
        if (models.length >= 5) break
      }
      return { ok: true, models }
    }

    if (provider === 'gemini') {
      // Gemini SDK doesn't expose a simple list endpoint; just validate by a ping
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' })
      await model.generateContent('Hi')
      return { ok: true, models: ['(Gemini API OK)'] }
    }

    // OpenAI / Grok: list models
    const { default: OpenAI } = await import('openai')
    const baseURL = provider === 'grok'
      ? (endpoint?.trim() || 'https://api.x.ai/v1')
      : endpoint?.trim() || undefined
    const client = new OpenAI({ apiKey, baseURL })
    const resp = await client.models.list()
    const models: string[] = []
    for await (const m of resp) {
      models.push(m.id)
      if (models.length >= 5) break
    }
    return { ok: true, models }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Provider-aware test message
export async function testLLMMessage(params: {
  provider: string
  apiKey: string
  apiKeys?: Record<string, string>
  model: string
  endpoint?: string
}): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const { provider, model, endpoint } = params
  const apiKey = params.apiKeys?.[provider] || params.apiKey
  if (!apiKey) return { ok: false, error: '尚未填寫 API Key' }
  if (!model) return { ok: false, error: '尚未填寫模型名稱' }

  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey })
      const resp = await client.messages.create({
        model,
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Say "Hello!" in one word.' }]
      })
      const text = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('').trim()
      return { ok: true, reply: text || '(empty)' }
    }

    if (provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(apiKey)
      const m = genAI.getGenerativeModel({ model })
      const result = await m.generateContent('Say "Hello!" in one word.')
      const text = result.response.text().trim()
      return { ok: true, reply: text || '(empty)' }
    }

    // OpenAI / Grok: use Responses API
    const { default: OpenAI } = await import('openai')
    const baseURL = provider === 'grok'
      ? (endpoint?.trim() || 'https://api.x.ai/v1')
      : endpoint?.trim() || undefined
    const client = new OpenAI({ apiKey, baseURL })
    const resp = await client.responses.create({
      model,
      input: 'Say "Hello!" in one word.',
      max_output_tokens: 20
    } as any)
    const text = typeof (resp as any)?.output_text === 'string'
      ? (resp as any).output_text
      : JSON.stringify(resp).slice(0, 200)
    return { ok: true, reply: text.trim() || '(empty)' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
