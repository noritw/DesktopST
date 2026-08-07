import { chatWithOpenAI } from './openai'
import { chatWithClaude } from './claude'
import { chatWithGemini } from './gemini'
import {
  buildEmotionClassifierSystemPrompt, buildEmotionIdList, buildNewsSubjectivityClassifierSystemPrompt, applyUtilitySettings,
  expandReactionAnnotations, expandNewsLinkForPrompt, annotateTimeGaps,
  type ChatLLMParams, type ChatLLMResult, type PromptCharacter
} from '../prompt/promptUtils'
import type { AppSettings } from '../types'
import type { LLMDeps } from './deps'

/**
 * LLM 呼叫主流程。原 `src/main/llm/index.ts`。
 *
 * 搬移時的三處改動（其餘逐字沿用）：
 * 1. 每個對外函式多收一個 `deps: LLMDeps`，往下傳給 provider 與 SDK
 * 2. `testLLMConnection` / `testLLMMessage` 原本回傳中文錯誤訊息，
 *    改為回傳 `errorCode`，由平台層翻成文案（roadmap §4.4b 的慣例）。
 *    SDK 自己拋的英文訊息仍原樣放在 `error`
 * 3. 圖片的本機路徑分支移到平台層（見 `imageRef.ts`）
 */

export { type ChatLLMParams, type ChatLLMResult, type PromptCharacter, applyUtilitySettings }
export type { LLMDeps }

function endpointForProvider(provider: string, endpoint?: string): string | undefined {
  const trimmed = endpoint?.trim()
  if (provider === 'grok') return trimmed || 'https://api.x.ai/v1'
  if (provider === 'openai' && trimmed?.includes('api.x.ai')) return undefined
  return trimmed || undefined
}

export async function chatWithLLM(rawParams: ChatLLMParams, deps: LLMDeps): Promise<ChatLLMResult> {
  // 展開訊息 reaction 標註、插入時間斷層標註（單一入口處理，adapter 不需各自支援）
  // 斷層標註跟隨 injectSystemTime：關閉時 prompt 完全不含現實時間（TRPG／故事接龍場合）
  // 記憶摘要也在此注入 system prompt，adapter 不需各自支援
  const memorySummaryBlock = rawParams.memorySummary?.trim()
    ? '[Memory Summary]\nCondensed record of earlier conversation (these events happened before the recent messages below). Treat as established shared memory:\n' + rawParams.memorySummary.trim()
    : null
  const expandedMessages = expandNewsLinkForPrompt(expandReactionAnnotations(rawParams.messages))
  const params: ChatLLMParams = {
    ...rawParams,
    messages: rawParams.settings.injectSystemTime ? annotateTimeGaps(expandedMessages) : expandedMessages,
    extraSystemContext: [memorySummaryBlock, rawParams.extraSystemContext].filter(Boolean).join('\n\n') || undefined
  }
  const { provider } = params.settings.llm
  switch (provider) {
    case 'claude':
      return chatWithClaude(params, deps)
    case 'gemini':
      return chatWithGemini(params, deps)
    case 'grok': {
      // Grok is OpenAI-compatible; use endpoint override
      const grokSettings = {
        ...params.settings,
        llm: {
          ...params.settings.llm,
          endpoint: endpointForProvider('grok', params.settings.llm.endpoint)
        }
      }
      return chatWithOpenAI({ ...params, settings: grokSettings }, deps)
    }
    case 'openai': {
      const openAISettings = {
        ...params.settings,
        llm: {
          ...params.settings.llm,
          endpoint: endpointForProvider('openai', params.settings.llm.endpoint)
        }
      }
      return chatWithOpenAI({ ...params, settings: openAISettings }, deps)
    }
    default:
      return chatWithOpenAI(params, deps)
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
  signal?: AbortSignal
}, deps: LLMDeps): Promise<EmotionClassifyResult> {
  const { settings, character, reply, signal } = params
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
      const client = new Anthropic({ apiKey: utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey, fetch: deps.http.fetch })
      const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
      const resp = await client.messages.create({
        model,
        max_tokens: 20,
        system: systemPrompt,
        messages: [{ role: 'user', content: reply }]
      }, { signal })
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
      const result = await gmodel.generateContent(reply, { signal })
      const raw = result.response.text().trim()
      const inputTokens = result.response.usageMetadata?.promptTokenCount
      const outputTokens = result.response.usageMetadata?.candidatesTokenCount
      const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
      return { emotion: resolveId(raw), inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
    }

    // OpenAI / Grok
    const { default: OpenAI } = await import('openai')
    const baseURL = endpointForProvider(provider, utilitySettings.llm.endpoint)
    const client = new OpenAI({ apiKey: utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey, baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
    const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
    const resp = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reply }
      ],
      max_output_tokens: 20
    } as any, { signal })
    const raw = (typeof (resp as any)?.output_text === 'string' ? (resp as any).output_text : '').trim()
    const inputTokens = (resp as any).usage?.input_tokens as number | undefined
    const outputTokens = (resp as any).usage?.output_tokens as number | undefined
    return { emotion: resolveId(raw), inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
  } catch (e: unknown) {
    if (signal?.aborted) throw e
    return { emotion: fallback }
  }
}

type NewsSubjectivityResult = {
  score: number
  reason?: string
  inputTokens?: number
  outputTokens?: number
  debugPrompt?: string
}

/**
 * Rate how subjective/emotionally loaded a news headline's wording reads, using the utility (cheap) model.
 * Debug-only signal (LogWindow news panel) — result is never used to filter candidates or steer character tone.
 * Returns null on parse/request failure (caller treats as "no score available").
 */
export async function classifyNewsSubjectivityWithLLM(params: {
  settings: AppSettings
  title: string
  summary?: string
}, deps: LLMDeps): Promise<NewsSubjectivityResult | null> {
  const { settings, title, summary } = params
  const utilitySettings = applyUtilitySettings(settings)
  const systemPrompt = buildNewsSubjectivityClassifierSystemPrompt()
  const userContent = summary && summary !== title ? `${title}\n${summary}` : title

  const parse = (raw: string): { score: number; reason?: string } | null => {
    const text = raw.trim()
    // 寬容解析：理想格式是 "N|理由"，但有些模型會夾雜多餘文字（如 "<score 4>|..."），
    // 所以改成「找出分隔線前最後一個 0~5 數字」+「分隔線後的文字」。
    const m = text.match(/([0-5])[^|｜]*[|｜]\s*(.*)$/s)
    if (!m) return null
    const reason = m[2].trim().replace(/^["「『]|["」』]$/g, '')
    return { score: Number(m[1]), reason: reason || undefined }
  }

  const makeDebug = (provider: string, model: string, inputTokens: number | undefined, outputTokens: number | undefined, response: string) =>
    JSON.stringify({
      purpose: 'news_subjectivity_classify',
      provider,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      response
    }, null, 2)

  const provider = utilitySettings.llm.provider
  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey: utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey, fetch: deps.http.fetch })
      const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
      const resp = await client.messages.create({
        model,
        max_tokens: 40,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }]
      })
      const raw = resp.content.filter(b => b.type === 'text').map(b => (b as any).text).join('').trim()
      const parsed = parse(raw)
      if (!parsed) return null
      const inputTokens = resp.usage?.input_tokens
      const outputTokens = resp.usage?.output_tokens
      return { ...parsed, inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
    }

    if (provider === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai')
      const genAI = new GoogleGenerativeAI(utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey)
      const gmodel = genAI.getGenerativeModel({
        model: utilitySettings.llm.models?.[provider] || utilitySettings.llm.model,
        systemInstruction: systemPrompt
      })
      const result = await gmodel.generateContent(userContent)
      const raw = result.response.text().trim()
      const parsed = parse(raw)
      if (!parsed) return null
      const inputTokens = result.response.usageMetadata?.promptTokenCount
      const outputTokens = result.response.usageMetadata?.candidatesTokenCount
      const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
      return { ...parsed, inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
    }

    // OpenAI / Grok
    const { default: OpenAI } = await import('openai')
    const baseURL = endpointForProvider(provider, utilitySettings.llm.endpoint)
    const client = new OpenAI({ apiKey: utilitySettings.llm.apiKeys?.[provider] || utilitySettings.llm.apiKey, baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
    const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
    const resp = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_output_tokens: 40
    } as any)
    const raw = (typeof (resp as any)?.output_text === 'string' ? (resp as any).output_text : '').trim()
    const parsed = parse(raw)
    if (!parsed) return null
    const inputTokens = (resp as any).usage?.input_tokens as number | undefined
    const outputTokens = (resp as any).usage?.output_tokens as number | undefined
    return { ...parsed, inputTokens, outputTokens, debugPrompt: makeDebug(provider, model, inputTokens, outputTokens, raw) }
  } catch {
    return null
  }
}

/**
 * 連線／訊息測試的失敗代碼。
 * core 不產生 UI 文案，由平台層翻譯（roadmap §4.4b）。
 */
export type LLMTestErrorCode = 'no-api-key' | 'no-model'

// Provider-aware connection test: returns { ok, models?, errorCode?, error? }
export async function testLLMConnection(params: {
  provider: string
  apiKey: string
  apiKeys?: Record<string, string>
  endpoint?: string
}, deps: LLMDeps): Promise<{ ok: boolean; models?: string[]; errorCode?: LLMTestErrorCode; error?: string }> {
  const { provider, endpoint } = params
  const apiKey = params.apiKeys?.[provider] || params.apiKey
  if (!apiKey) return { ok: false, errorCode: 'no-api-key' }

  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey, fetch: deps.http.fetch })
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
    const client = new OpenAI({ apiKey, baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
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
}, deps: LLMDeps): Promise<{ ok: boolean; reply?: string; errorCode?: LLMTestErrorCode; error?: string }> {
  const { provider, model, endpoint } = params
  const apiKey = params.apiKeys?.[provider] || params.apiKey
  if (!apiKey) return { ok: false, errorCode: 'no-api-key' }
  if (!model) return { ok: false, errorCode: 'no-model' }

  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk')
      const client = new Anthropic({ apiKey, fetch: deps.http.fetch })
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
    const client = new OpenAI({ apiKey, baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
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
