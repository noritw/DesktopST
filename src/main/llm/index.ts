import { chatWithOpenAI } from './openaiAdapter'
import { chatWithClaude } from './claudeAdapter'
import { chatWithGemini } from './geminiAdapter'
import {
  buildEmotionClassifierSystemPrompt, buildEmotionIdList, applyUtilitySettings,
  type ChatLLMParams, type ChatLLMResult, type PromptCharacter
} from './promptUtils'
import type { AppSettings } from '../types'

export { type ChatLLMParams, type ChatLLMResult, applyUtilitySettings }

function endpointForProvider(provider: string, endpoint?: string): string | undefined {
  const trimmed = endpoint?.trim()
  if (provider === 'grok') return trimmed || 'https://api.x.ai/v1'
  if (provider === 'openai' && trimmed?.includes('api.x.ai')) return undefined
  return trimmed || undefined
}

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
          endpoint: endpointForProvider('grok', params.settings.llm.endpoint)
        }
      }
      return chatWithOpenAI({ ...params, settings: grokSettings })
    }
    case 'openai': {
      const openAISettings = {
        ...params.settings,
        llm: {
          ...params.settings.llm,
          endpoint: endpointForProvider('openai', params.settings.llm.endpoint)
        }
      }
      return chatWithOpenAI({ ...params, settings: openAISettings })
    }
    default:
      return chatWithOpenAI(params)
  }
}

type EmotionClassifyResult = {
  emotion: string
  inputTokens?: number
  outputTokens?: number
  debugPrompt?: string
}

/** Classify emotion for a character reply using the utility (cheap) model. */
export async function classifyEmotionWithLLM(params: {
  settings: AppSettings
  character: PromptCharacter
  reply: string
}): Promise<EmotionClassifyResult> {
  const { settings, character, reply } = params
  const utilitySettings = applyUtilitySettings(settings)
  const systemPrompt = buildEmotionClassifierSystemPrompt(character)
  const knownIds = buildEmotionIdList(character)
  const fallback = knownIds[0] ?? 'neutral'

  const resolveId = (raw: string) => {
    const id = raw.replace(/[^a-z_一-鿿㐀-䶿]/gi, '').trim()
    return knownIds.includes(id) ? id : fallback
  }

  const makeDebug = (provider: string, model: string, inputTokens: number | undefined, outputTokens: number | undefined, response: string) =>
    JSON.stringify({
      purpose: 'emotion_classify',
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reply }
      ],
      response
    }, null, 2)

  const provider = utilitySettings.llm.provider
  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey })
      const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
      const resp = await client.messages.create({
        model,
        max_tokens: 20,
        system: systemPrompt,
        messages: [{ role: 'user', content: reply }]
      })
      const raw = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('').trim()
      const inputTokens = resp.usage?.input_tokens
      const outputTokens = resp.usage?.output_tokens
      return { emotion: resolveId(raw), inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
    }

    if (provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey)
      const gmodel = genAI.getGenerativeModel({
        model: utilitySettings.llm.models?.[provider] || utilitySettings.llm.model,
        systemInstruction: systemPrompt
      })
      const result = await gmodel.generateContent(reply)
      const raw = result.response.text().trim()
      const inputTokens = result.response.usageMetadata?.promptTokenCount
      const outputTokens = result.response.usageMetadata?.candidatesTokenCount
      const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
      return { emotion: resolveId(raw), inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
    }

    // OpenAI / Grok
    const { default: OpenAI } = await import('openai')
    const baseURL = endpointForProvider(provider, utilitySettings.llm.endpoint)
    const client = new OpenAI({ apiKey: utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey, baseURL })
    const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
    const resp = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reply }
      ],
      max_output_tokens: 20
    } as any)
    const raw = (typeof (resp as any)?.output_text === 'string' ? (resp as any).output_text : '').trim()
    const inputTokens = (resp as any).usage?.input_tokens as number | undefined
    const outputTokens = (resp as any).usage?.output_tokens as number | undefined
    return { emotion: resolveId(raw), inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
  } catch {
    return { emotion: fallback }
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
    const baseURL = endpointForProvider(provider, endpoint)
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
    const baseURL = endpointForProvider(provider, endpoint)
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
