import type { HttpAdapter } from '../adapters'
import { buildPhotoEstimatePrompt, parseEstimateResult, type PhotoEstimateResult } from './photoEstimate'
import type { NutritionLlmSettings } from './types'

/**
 * 走 OpenAI 相容的 Chat Completions（`/v1/chat/completions`），不是 Responses API——
 * 這是本地模型伺服器（Ollama／LM Studio／llama.cpp）最普遍支援的格式，
 * 比 Responses API 涵蓋面更廣。`docs/nutrition-photo-estimate-plan.md` §3.3。
 *
 * 只支援 OpenAI 相容供應商（openai／local／grok）。Claude／Gemini 的圖片格式不同，
 * 之後若要支援要另外實作，見規格 §3.3 待辦。
 */
const OPENAI_COMPATIBLE_PROVIDERS = new Set(['openai', 'local', 'grok'])

export interface PhotoEstimatePhoto {
  /** 送出的照片屬於哪一份食物，對齊補充頁的槽位（§2.6.1）。 */
  slot: number
  /** 不含 `data:...;base64,` 前綴的純 base64。 */
  base64: string
  mimeType: string
}

export interface RequestPhotoEstimateParams {
  llmSettings: NutritionLlmSettings
  photos: PhotoEstimatePhoto[]
  /** 送出前補充說明原文，可留白（§2.7）。 */
  note?: string
  /** 最近／最常吃的食物名稱，用於提高比對命中率（§3.1，不含營養數字）。 */
  recentNames: readonly string[]
  http: HttpAdapter
  signal?: AbortSignal
  /** 逾時毫秒數，規格建議 12 秒（§3.3）。CapacitorHttp 忽略 `signal`，呼叫端仍要自己包一層。 */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 12_000

function resolveApiKey(llmSettings: NutritionLlmSettings): string {
  return llmSettings.apiKeys[llmSettings.provider]?.trim() ?? ''
}

function resolveBaseUrl(llmSettings: NutritionLlmSettings): string {
  const endpoint = llmSettings.endpoints?.[llmSettings.provider]
  if (endpoint) return endpoint.replace(/\/+$/, '')
  return 'https://api.openai.com/v1'
}

/** 跟 `core/llm/openai.ts` 的 `shouldOmitTemperature()` 判斷同一批模型（gpt-5／o 系列）。 */
function isReasoningModel(model: string): boolean {
  return /^gpt-5(\.|-|$)/i.test(model) || /^o\d/i.test(model)
}

/**
 * gpt-5／o 系列（推理模型）的 Chat Completions 有兩個跟一般模型不同的地方：
 *
 * 1. 不接受 `max_tokens`，送了直接 400（"Unsupported parameter: 'max_tokens'
 *    is not supported with this model. Use 'max_completion_tokens' instead."）
 *    ——這是 owner 實測 `gpt-5.6-luna` 讀圖測試回 400 的根因。
 * 2. 推理會**佔用同一份 `max_completion_tokens` 預算**，小預算（例如讀圖測試
 *    原本的 20）很容易被推理吃光、正文回空字串，看起來像「沒反應」而不是
 *    「不支援讀圖」——同一個坑 CLAUDE.md §5 也記過（本機推理模型）。
 *    這裡用 `reasoning_effort: 'minimal'` 把推理壓到最低並拉高預算下限，
 *    而不是無止盡加預算（那只會讓每次測試都變貴）。
 */
function reasoningAwareParams(model: string, requestedMaxTokens: number): Record<string, unknown> {
  if (!isReasoningModel(model)) return { max_tokens: requestedMaxTokens }
  return {
    max_completion_tokens: Math.max(requestedMaxTokens, 300),
    reasoning_effort: 'minimal'
  }
}

/** 呼叫失敗時的統一錯誤，讓呼叫端能直接判斷是不是逾時。 */
export class PhotoEstimateRequestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'PhotoEstimateRequestError'
  }
}

/** 進請求前的共通檢查，三個對外函式（估算／測連線／測讀圖）共用同一套規則。 */
function checkBasicRequestPreconditions(llmSettings: NutritionLlmSettings, requireModel: boolean): string | null {
  if (!OPENAI_COMPATIBLE_PROVIDERS.has(llmSettings.provider)) {
    return `拍照估算目前只支援 openai／local／grok 供應商，收到：${llmSettings.provider}`
  }
  if (requireModel && !llmSettings.model) return '尚未選擇模型'
  const apiKey = resolveApiKey(llmSettings)
  if (!apiKey && llmSettings.provider !== 'local') return '尚未設定 API Key'
  return null
}

async function fetchWithTimeout(
  http: HttpAdapter,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const combinedSignal = signal ? anySignal([signal, timeoutController.signal]) : timeoutController.signal
  try {
    return await http.fetch(url, { ...init, signal: combinedSignal })
  } finally {
    clearTimeout(timer)
  }
}

function extractJsonObject(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // 有些模型會在 JSON 前後夾雜文字或 code fence，抓最外層的 { … } 再試一次。
  }
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
  return null
}

/**
 * 呼叫 nutrition.llm 設定的模型估算照片營養（§3）。
 * 逾時／請求失敗一律丟 `PhotoEstimateRequestError`，呼叫端依規格 §3.3 顯示「重試／手動輸入／取消」。
 */
export async function requestPhotoEstimate(params: RequestPhotoEstimateParams): Promise<PhotoEstimateResult[]> {
  const { llmSettings, photos, note, recentNames, http, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = params

  const precondition = checkBasicRequestPreconditions(llmSettings, true)
  if (precondition) throw new PhotoEstimateRequestError(precondition)
  if (photos.length === 0) {
    throw new PhotoEstimateRequestError('沒有照片可以送出')
  }
  const apiKey = resolveApiKey(llmSettings)

  const promptText = [
    buildPhotoEstimatePrompt(recentNames),
    '',
    note ? `使用者補充說明：${note}` : '使用者補充說明：（留白，純依圖片判斷）',
    '',
    '請回傳一個 JSON 物件，格式為 { "results": [ ... ] }，results 內每個元素對應規格所述的單份食物估算結果。'
  ].join('\n')

  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text: promptText }]
  for (const photo of photos) {
    content.push({ type: 'text', text: `（以下圖片屬於 slot ${photo.slot}）` })
    content.push({ type: 'image_url', image_url: { url: `data:${photo.mimeType};base64,${photo.base64}` } })
  }

  const body: Record<string, unknown> = {
    model: llmSettings.model,
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_object' },
    ...reasoningAwareParams(llmSettings.model!, 1500)
  }
  if (llmSettings.provider === 'local') {
    // 思考模型會把預算全花在 reasoning、正文回空字串，見 CLAUDE.md §5「本機 LLM 供應商」。
    body.reasoning = { effort: 'none' }
  }

  let response: Response
  try {
    response = await fetchWithTimeout(http, `${resolveBaseUrl(llmSettings)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body)
    }, timeoutMs, signal)
  } catch (error) {
    throw new PhotoEstimateRequestError('請求失敗或逾時', error)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new PhotoEstimateRequestError(`模型回應錯誤（${response.status}）：${text.slice(0, 200)}`)
  }

  const json = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
  const raw = json?.choices?.[0]?.message?.content
  if (!raw || !raw.trim()) {
    throw new PhotoEstimateRequestError('模型沒有回應內容')
  }

  const parsed = extractJsonObject(raw) as { results?: unknown } | null
  if (!parsed) {
    throw new PhotoEstimateRequestError('模型回應不是合法 JSON')
  }
  return parseEstimateResult(parsed.results ?? parsed)
}

export interface NutritionLlmTestResult {
  ok: boolean
  /** 只有 `local`（沒有寫死目錄）會回模型清單；雲端供應商走 `core/llm/modelCatalog` 的靜態清單。 */
  models?: string[]
  error?: string
}

/**
 * 測連線＋抓 `local` 供應商的實際模型清單（`GET /v1/models`）。雲端供應商（openai／grok）
 * 已經有靜態目錄可選（`@core/llm/modelCatalog`），這支主要是給沒有寫死目錄的本機端點用；
 * 呼叫端仍可以拿它驗證雲端的 API Key／端點是否有效。
 */
export async function testNutritionLlmConnection(
  llmSettings: NutritionLlmSettings,
  http: HttpAdapter,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<NutritionLlmTestResult> {
  const precondition = checkBasicRequestPreconditions(llmSettings, false)
  if (precondition) return { ok: false, error: precondition }
  const apiKey = resolveApiKey(llmSettings)

  try {
    const response = await fetchWithTimeout(http, `${resolveBaseUrl(llmSettings)}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    }, timeoutMs)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, error: `連線失敗（${response.status}）：${text.slice(0, 200)}` }
    }
    const json = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null
    const ids = (json?.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
    const limit = llmSettings.provider === 'local' ? 200 : 5
    return { ok: true, models: ids.slice(0, limit) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 1×1 透明像素 PNG，測讀圖用，體積接近零。 */
const TEST_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

export interface PhotoEstimateVisionTestResult {
  ok: boolean
  /** 模型的實際回覆，用於讓使用者判斷「有沒有真的看懂」而不是只回了任意字。 */
  reply?: string
  error?: string
}

/**
 * 「一鍵測試能不能傳圖」——送一張最小的測試圖片，確認模型真的支援讀圖，
 * 不是等到正式拍照估算才發現選錯模型（owner 2026-08-19：設定半天結果不能用太浪費）。
 * 跟 `requestPhotoEstimate` 分開一支，故意不要求 JSON 格式、不夾雜規格 prompt，
 * 失敗時才好判斷是「不支援讀圖」還是「JSON 格式沒依照指示」。
 */
export async function testPhotoEstimateVision(
  llmSettings: NutritionLlmSettings,
  http: HttpAdapter,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<PhotoEstimateVisionTestResult> {
  const precondition = checkBasicRequestPreconditions(llmSettings, true)
  if (precondition) return { ok: false, error: precondition }
  const apiKey = resolveApiKey(llmSettings)

  const body: Record<string, unknown> = {
    model: llmSettings.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '這是一張測試圖片。如果你能看到圖片內容，回覆「可以讀圖」；否則回覆「無法讀圖」。不要回其他文字。' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${TEST_PIXEL_PNG_BASE64}` } }
      ]
    }],
    ...reasoningAwareParams(llmSettings.model!, 20)
  }
  if (llmSettings.provider === 'local') body.reasoning = { effort: 'none' }

  try {
    const response = await fetchWithTimeout(http, `${resolveBaseUrl(llmSettings)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body)
    }, timeoutMs)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, error: `模型回應錯誤（${response.status}）：${text.slice(0, 200)}` }
    }
    const json = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
    const reply = json?.choices?.[0]?.message?.content?.trim()
    if (!reply) return { ok: false, error: '模型沒有回應內容（可能不支援讀圖，或思考模型把預算花在推理上）' }
    // 沒看到圖片的模型多半會照樣回一段文字甚至道歉，所以用「有沒有講到看不到／無法」判斷比對空字串更可靠。
    if (/無法|看不到|看不見|沒有圖片|no image|cannot see|can't see/i.test(reply)) {
      return { ok: false, reply, error: '模型回應顯示看不到圖片內容' }
    }
    return { ok: true, reply }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) { controller.abort(); break }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
