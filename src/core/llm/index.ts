import { chatWithOpenAI } from './openai'
import { chatWithClaude } from './claude'
import { chatWithGemini } from './gemini'
import {
  buildEmotionClassifierSystemPrompt, buildEmotionIdList, buildNewsSubjectivityClassifierSystemPrompt, applyUtilitySettings,
  expandReactionAnnotations, expandNewsLinkForPrompt, annotateTimeGaps, canonicalizeEmotionId,
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

/**
 * 取某供應商生效的端點：以 `endpoints[provider]` 為準。
 *
 * ⚠️ **舊的單一 `endpoint` 欄位只在「整張表還是空的」時才可信**，不能因為
 * 「這一家在表裡沒有值」就退回去讀它。
 *
 * 「表裡沒有這一家」是雲端供應商的**正常狀態**（用官方端點就不填），
 * 而舊欄位是個會跟著目前 provider 更新的鏡像。兩者湊在一起的話：
 * 切到本機模型 → 鏡像變成 `http://…:11434/v1`，切回 OpenAI → `endpoints.openai`
 * 本來就沒有值 → 退回鏡像 → **雲端請求被送去本機那台**，症狀是切回雲端後
 * 突然連不上（owner 2026-08-15 在手機獨立版實測回報）。
 *
 * 只有「設定檔還沒被遷移寫回磁碟」那個空窗才需要退回舊欄位，而那時整張表是空的
 * （遷移在 `core/store/settings.ts`，一定會建出至少一個項目）。
 */
export function resolveEndpoint(settings: AppSettings, provider?: string): string | undefined {
  const p = provider ?? settings.llm.provider
  const map = settings.llm.endpoints
  const fromMap = map?.[p]
  if (fromMap) return endpointForProvider(p, fromMap)
  const unmigrated = !map || Object.keys(map).length === 0
  return endpointForProvider(p, unmigrated && p === settings.llm.provider ? settings.llm.endpoint : undefined)
}

/**
 * 本機模型要關掉思考。
 *
 * Qwen3 這類思考模型預設會把 token 預算全花在 reasoning 上、`output_text` 回空字串，
 * 而情緒分類的預算只有 20 tokens、新聞主觀度 40 —— 在那個預算下 100% 回空，
 * `openai.ts` 接著就丟 `Empty response from model`（根因完全看不出來）。
 * 帶 `effort: 'none'` 實測回覆乾淨；非思考模型帶了也不會報錯，原樣忽略，
 * 所以不做模型能力偵測。細節：`docs/local-llm-provider-plan.md` §2.3。
 */
export function localReasoningParams(provider: string): { reasoning?: { effort: 'none' } } {
  return provider === 'local' ? { reasoning: { effort: 'none' } } : {}
}

/** 本機端點通常不設金鑰；SDK 需要非空字串，塞個 placeholder（伺服器一律忽略）。 */
const LOCAL_API_KEY_PLACEHOLDER = 'local'

/** 取生效金鑰。local 沒填時回 placeholder，讓「沒有金鑰」不再是錯誤。 */
export function resolveApiKeyForProvider(provider: string, apiKey: string, apiKeys?: Record<string, string>): string {
  const key = apiKeys?.[provider] || apiKey
  if (key) return key
  return provider === 'local' ? LOCAL_API_KEY_PLACEHOLDER : ''
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
  const result = await dispatchChat(params, deps)
  /*
   * ⚠️ **一定要在這裡（唯一入口）換成 canonical key 再回傳，不要讓呼叫端自己存原始 id。**
   * `buildEmotionContract()` 給模型的 id 可能是自訂 id／檔名主幹，這些是**裝置本地的**
   * ——同一則訊息換一台裝置檢視（S2 對話同步）時，用那台裝置自己的
   * `character.emotions`／`spriteIds` 反查會對不上，症狀是「這台剛發的正常，
   * 同步過去那台看不到表情」（2026-08-23 owner 實機回報）。存 canonical key
   * （`EMOTION_OPTIONS` 的固定英文字）才是跨裝置穩定的身分。
   */
  return { ...result, emotion: canonicalizeEmotionId(params.character, result.emotion) }
}

function dispatchChat(params: ChatLLMParams, deps: LLMDeps): Promise<ChatLLMResult> {
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
          endpoint: resolveEndpoint(params.settings, 'grok')
        }
      }
      return chatWithOpenAI({ ...params, settings: grokSettings }, deps)
    }
    case 'openai':
    case 'local': {
      // local 走的協定與 OpenAI 完全相同（Ollama 支援 Responses API，實測見規劃文件 §2.3），
      // 差別只在端點來自 endpoints 表、以及 openai.ts 會依 provider 補上關思考參數。
      const openAISettings = {
        ...params.settings,
        llm: {
          ...params.settings.llm,
          endpoint: resolveEndpoint(params.settings, provider)
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
  // 跟 `chatWithLLM()` 同一個理由：存 canonical key，不要存裝置本地的自訂 id／檔名主幹
  // ——`knownIds[0]` 本身也可能是自訂 id／檔名主幹，fallback 也要換算。
  const fallback = canonicalizeEmotionId(character, knownIds[0] ?? 'neutral')

  const resolveId = (raw: string) => {
    const id = raw.replace(/[^a-z_一-鿿㐀-䶿]/gi, '').trim()
    return knownIds.includes(id) ? canonicalizeEmotionId(character, id) : fallback
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

    // OpenAI / Grok / local
    const { default: OpenAI } = await import('openai')
    const baseURL = resolveEndpoint(utilitySettings, provider)
    const client = new OpenAI({ apiKey: resolveApiKeyForProvider(provider, utilitySettings.llm.apiKey, utilitySettings.llm.apiKeys), baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
    const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
    const resp = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: reply }
      ],
      max_output_tokens: 20,
      ...localReasoningParams(provider)
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

    // OpenAI / Grok / local
    const { default: OpenAI } = await import('openai')
    const baseURL = resolveEndpoint(utilitySettings, provider)
    const client = new OpenAI({ apiKey: resolveApiKeyForProvider(provider, utilitySettings.llm.apiKey, utilitySettings.llm.apiKeys), baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
    const model = utilitySettings.llm.models?.[provider] || utilitySettings.llm.model
    const resp = await client.responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_output_tokens: 40,
      ...localReasoningParams(provider)
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
  // local 的自架端點通常沒有金鑰，不能因為沒填就擋下（見規劃文件 §3.4）
  const apiKey = resolveApiKeyForProvider(provider, params.apiKey, params.apiKeys)
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

    // OpenAI / Grok / local: list models
    const { default: OpenAI } = await import('openai')
    const baseURL = endpointForProvider(provider, endpoint)
    const client = new OpenAI({ apiKey, baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
    const resp = await client.models.list()
    // 雲端那幾家清單很長，取前 5 筆只是「連得上」的佐證。
    // local 相反：這份清單就是使用者唯一能挑模型的來源（沒有寫死的目錄），要全拿。
    const limit = provider === 'local' ? 200 : 5
    const models: string[] = []
    for await (const m of resp) {
      models.push(m.id)
      if (models.length >= limit) break
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
  const apiKey = resolveApiKeyForProvider(provider, params.apiKey, params.apiKeys)
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

    // OpenAI / Grok / local: use Responses API
    const { default: OpenAI } = await import('openai')
    const baseURL = endpointForProvider(provider, endpoint)
    const client = new OpenAI({ apiKey, baseURL, fetch: deps.http.fetch, dangerouslyAllowBrowser: true })
    const resp = await client.responses.create({
      model,
      input: 'Say "Hello!" in one word.',
      max_output_tokens: 20,
      ...localReasoningParams(provider)
    } as any)
    const text = typeof (resp as any)?.output_text === 'string'
      ? (resp as any).output_text
      : JSON.stringify(resp).slice(0, 200)
    return { ok: true, reply: text.trim() || '(empty)' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
