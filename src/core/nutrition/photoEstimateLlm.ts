import type { HttpAdapter } from '../adapters'
import { buildPhotoEstimatePrompt, parseEstimateResult, type PhotoEstimateResult } from './photoEstimate'
import type { NutritionLlmSettings } from './types'

/**
 * 支援 OpenAI 相容的 Chat Completions（openai／local／grok，`/v1/chat/completions`——
 * 這是本地模型伺服器最普遍支援的格式，比 Responses API 涵蓋面更廣）
 * 與 Anthropic 的 Messages API（claude，`/v1/messages`，欄位格式不同、走 `x-api-key`）。
 * `docs/nutrition-photo-estimate-plan.md` §3.3。Gemini 圖片格式又不同，還沒支援。
 */
const OPENAI_COMPATIBLE_PROVIDERS = new Set(['openai', 'local', 'grok'])
const ANTHROPIC_PROVIDERS = new Set(['claude'])
const SUPPORTED_PROVIDERS = new Set([...OPENAI_COMPATIBLE_PROVIDERS, ...ANTHROPIC_PROVIDERS])

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
const ANTHROPIC_API_VERSION = '2023-06-01'

function resolveApiKey(llmSettings: NutritionLlmSettings): string {
  return llmSettings.apiKeys[llmSettings.provider]?.trim() ?? ''
}

/**
 * `local` 沒有合理預設（必填，UI 已擋）；`grok`／`claude` 各自有固定官方端點，
 * 沒填端點不該落到 OpenAI 那個預設值去——之前就是這樣寫死回退，Grok 沒填端點時
 * 悄悄把請求送去 OpenAI（帶著 Grok 的 Key，只會 401，從沒被抓到過是因為
 * 還沒有人實測過 Grok 這條路）。
 */
function resolveBaseUrl(llmSettings: NutritionLlmSettings): string {
  const explicit = llmSettings.endpoints?.[llmSettings.provider]?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  if (llmSettings.provider === 'grok') return 'https://api.x.ai/v1'
  if (llmSettings.provider === 'claude') return 'https://api.anthropic.com/v1'
  return 'https://api.openai.com/v1'
}

/** 跟 `core/llm/openai.ts` 的 `shouldOmitTemperature()` 判斷同一批模型（gpt-5／o 系列）。 */
function isReasoningModel(model: string): boolean {
  return /^gpt-5(\.|-|$)/i.test(model) || /^o\d/i.test(model)
}

/**
 * gpt-5／o 系列（推理模型）的 Chat Completions **不接受 `max_tokens`**，送了直接 400
 * （"Unsupported parameter: 'max_tokens' is not supported with this model.
 * Use 'max_completion_tokens' instead."）——這是 owner 實測 `gpt-5.6-luna`
 * 讀圖測試回 400 的根因。這條是 OpenAI 文件明載的已知行為，可以放心先修；
 * 其餘「這個模型不吃這個參數」的狀況（例如某些子型號不支援某個 `reasoning_effort`
 * 取值）沒辦法每一種都預先猜對，改交給下面 `postJsonWithParamFallback` 的
 * 通用重試機制：真的被拒絕時讀錯誤訊息、拔掉那個參數重送一次，而不是繼續加
 * 更多沒被文件證實的參數去賭它有沒有用。
 */
function reasoningAwareParams(model: string, requestedMaxTokens: number): Record<string, unknown> {
  return isReasoningModel(model) ? { max_completion_tokens: requestedMaxTokens } : { max_tokens: requestedMaxTokens }
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
  if (!SUPPORTED_PROVIDERS.has(llmSettings.provider)) {
    return `拍照估算目前只支援 openai／local／grok／claude 供應商，收到：${llmSettings.provider}`
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

/**
 * POST 一份 JSON body；若回 400 且錯誤訊息符合 OpenAI 系「Unsupported parameter: 'X'」
 * 的格式，拔掉那個參數重送一次（僅重試一次，避免無限迴圈）。這是為了不用預先猜對
 * 每個型號吃不吃某個參數——猜錯只會製造新的 400（歷史教訓：先猜的 `reasoning_effort`
 * 就是這樣被拿掉的），與其繼續猜，不如讓錯誤訊息自己講。
 */
async function postJsonWithParamFallback(
  http: HttpAdapter,
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const response = await fetchWithTimeout(http, url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs, signal)
  if (response.status !== 400) return response

  const text = await response.clone().text().catch(() => '')
  const match = text.match(/Unsupported parameter: '(\w+)'/)
  if (!match || !(match[1] in body)) return response

  const retryBody = { ...body }
  delete retryBody[match[1]]
  return fetchWithTimeout(http, url, { method: 'POST', headers, body: JSON.stringify(retryBody) }, timeoutMs, signal)
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

/** local 供應商連不上時，多數情況是瀏覽器 CORS 擋下（Ollama 等預設不允許跨來源），補一句可行動的提示。 */
function describeNetworkError(llmSettings: NutritionLlmSettings, error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (llmSettings.provider !== 'local') return raw
  return `${raw}（本機模型常見原因：伺服器沒開放跨來源存取。Ollama 請設定環境變數 OLLAMA_ORIGINS=* 後重開，或確認端點位址與埠號正確、手機與伺服器在同一區網）`
}

interface ChatContentPart {
  type: 'text' | 'image_url' | 'image'
  text?: string
  image_url?: { url: string }
  source?: { type: 'base64'; media_type: string; data: string }
}

/**
 * 圖片前面那句說明文字。**單份食物多張照片是常態**（包裝正面／營養成分表／內容物，
 * 見規格 §2.6 拍法 A），所以標註要講「第幾張、屬於第幾份食物」兩件事——
 * 只標 slot 的話模型會把同一份食物的 3 張照片當成 3 份食物，回 3 筆結果。
 */
function photoCaption(photo: PhotoEstimatePhoto, indexWithinSlot: number, totalSlots: number): string {
  const which = `第 ${indexWithinSlot} 張照片`
  return totalSlots > 1 ? `（${which}，屬於第 ${photo.slot} 份食物）` : `（${which}，與其他照片同屬一份食物）`
}

function imagePart(base64: string, mimeType: string, provider: string): ChatContentPart {
  return ANTHROPIC_PROVIDERS.has(provider)
    ? { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
    : { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
}

function buildContentParts(promptText: string, photos: PhotoEstimatePhoto[], provider: string): ChatContentPart[] {
  const totalSlots = new Set(photos.map((p) => p.slot)).size
  const seenPerSlot = new Map<number, number>()
  const parts: ChatContentPart[] = [{ type: 'text', text: promptText }]
  for (const photo of photos) {
    const indexWithinSlot = (seenPerSlot.get(photo.slot) ?? 0) + 1
    seenPerSlot.set(photo.slot, indexWithinSlot)
    parts.push({ type: 'text', text: photoCaption(photo, indexWithinSlot, totalSlots) })
    parts.push(imagePart(photo.base64, photo.mimeType, provider))
  }
  return parts
}

function buildRequestHeaders(llmSettings: NutritionLlmSettings, apiKey: string): Record<string, string> {
  if (ANTHROPIC_PROVIDERS.has(llmSettings.provider)) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
      // Anthropic 的官方 API 預設擋掉瀏覽器直連（CORS），這個標頭是官方 SDK
      // `dangerouslyAllowBrowser: true` 底下實際做的事（core/llm/claude.ts 用 SDK，
      // 這裡沒用 SDK 所以要自己加）。
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  }
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  }
}

/** 從回應中取出模型的純文字內容，屏蔽 OpenAI（`choices[0].message.content`）與 Anthropic（`content[].text`）的形狀差異。 */
async function extractReplyText(response: Response, provider: string): Promise<string | undefined> {
  if (ANTHROPIC_PROVIDERS.has(provider)) {
    const json = await response.json().catch(() => null) as { content?: Array<{ type?: string; text?: string }> } | null
    return (json?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim() || undefined
  }
  const json = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null
  return json?.choices?.[0]?.message?.content?.trim() || undefined
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
  const isAnthropic = ANTHROPIC_PROVIDERS.has(llmSettings.provider)

  // 補充說明放在格式說明之後、緊鄰圖片之前，是刻意的：這是規格 §1 原則 5 的
  // 「最高優先線索」，離圖片越近模型越不容易忽略它。
  const promptText = [
    buildPhotoEstimatePrompt(recentNames),
    '',
    note ? `使用者的補充說明（最高優先，優先於你從圖片看到的）：${note}` : '使用者沒有填補充說明，請純依圖片判斷。',
    ...(isAnthropic ? ['', '只回傳 JSON 本身，不要加上其他文字或 ```code fence```。'] : [])
  ].join('\n')

  const content = buildContentParts(promptText, photos, llmSettings.provider)
  const headers = buildRequestHeaders(llmSettings, apiKey)

  const body: Record<string, unknown> = isAnthropic
    ? { model: llmSettings.model, max_tokens: 1500, messages: [{ role: 'user', content }] }
    : { model: llmSettings.model, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, ...reasoningAwareParams(llmSettings.model!, 1500) }
  if (llmSettings.provider === 'local') {
    // 思考模型會把預算全花在 reasoning、正文回空字串，見 CLAUDE.md §5「本機 LLM 供應商」。
    body.reasoning = { effort: 'none' }
  }

  const url = isAnthropic ? `${resolveBaseUrl(llmSettings)}/messages` : `${resolveBaseUrl(llmSettings)}/chat/completions`

  let response: Response
  try {
    response = await postJsonWithParamFallback(http, url, headers, body, timeoutMs, signal)
  } catch (error) {
    throw new PhotoEstimateRequestError('請求失敗或逾時', error)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new PhotoEstimateRequestError(`模型回應錯誤（${response.status}）：${text.slice(0, 200)}`)
  }

  const raw = await extractReplyText(response, llmSettings.provider)
  if (!raw) {
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
 * 測連線＋抓 `local` 供應商的實際模型清單（`GET /v1/models`）。雲端供應商已經有
 * 靜態目錄可選（`@core/llm/modelCatalog`），這支主要是給沒有寫死目錄的本機端點用；
 * 呼叫端仍可以拿它驗證雲端的 API Key／端點是否有效。Anthropic 也有對應的
 * `GET /v1/models`（跟 `core/llm/index.ts` 的 `testLLMConnection` 用同一個端點），
 * 回應形狀跟 OpenAI 相容（`{ data: [{ id }] }`），可以共用同一段解析邏輯。
 */
export async function testNutritionLlmConnection(
  llmSettings: NutritionLlmSettings,
  http: HttpAdapter,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<NutritionLlmTestResult> {
  const precondition = checkBasicRequestPreconditions(llmSettings, false)
  if (precondition) return { ok: false, error: precondition }
  const apiKey = resolveApiKey(llmSettings)
  const isAnthropic = ANTHROPIC_PROVIDERS.has(llmSettings.provider)

  try {
    const response = await fetchWithTimeout(http, `${resolveBaseUrl(llmSettings)}/models`, {
      headers: isAnthropic
        ? { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_API_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' }
        : (apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
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
    return { ok: false, error: describeNetworkError(llmSettings, error) }
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
  const isAnthropic = ANTHROPIC_PROVIDERS.has(llmSettings.provider)

  // 這裡不走 buildContentParts：測試圖片沒有 slot／份數的概念，不需要那些標註文字
  // （先前用字串比對把標註過濾掉，標註文案一改就默默失效——直接組兩個 part 更穩）。
  const trimmedContent: ChatContentPart[] = [
    { type: 'text', text: '這是一張測試圖片。如果你能看到圖片內容，回覆「可以讀圖」；否則回覆「無法讀圖」。不要回其他文字。' },
    imagePart(TEST_PIXEL_PNG_BASE64, 'image/png', llmSettings.provider)
  ]
  const headers = buildRequestHeaders(llmSettings, apiKey)

  const body: Record<string, unknown> = isAnthropic
    ? { model: llmSettings.model, max_tokens: 20, messages: [{ role: 'user', content: trimmedContent }] }
    : { model: llmSettings.model, messages: [{ role: 'user', content: trimmedContent }], ...reasoningAwareParams(llmSettings.model!, 20) }
  if (llmSettings.provider === 'local') body.reasoning = { effort: 'none' }

  const url = isAnthropic ? `${resolveBaseUrl(llmSettings)}/messages` : `${resolveBaseUrl(llmSettings)}/chat/completions`

  try {
    const response = await postJsonWithParamFallback(http, url, headers, body, timeoutMs)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, error: `模型回應錯誤（${response.status}）：${text.slice(0, 200)}` }
    }
    const reply = await extractReplyText(response, llmSettings.provider)
    if (!reply) return { ok: false, error: '模型沒有回應內容（可能不支援讀圖，或思考模型把預算花在推理上）' }
    // 沒看到圖片的模型多半會照樣回一段文字甚至道歉，所以用「有沒有講到看不到／無法」判斷比對空字串更可靠。
    if (/無法|看不到|看不見|沒有圖片|no image|cannot see|can't see/i.test(reply)) {
      return { ok: false, reply, error: '模型回應顯示看不到圖片內容' }
    }
    return { ok: true, reply }
  } catch (error) {
    return { ok: false, error: describeNetworkError(llmSettings, error) }
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
