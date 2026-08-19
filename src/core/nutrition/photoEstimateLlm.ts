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
  if (llmSettings.endpoint) return llmSettings.endpoint.replace(/\/+$/, '')
  return 'https://api.openai.com/v1'
}

/** 呼叫失敗時的統一錯誤，讓呼叫端能直接判斷是不是逾時。 */
export class PhotoEstimateRequestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'PhotoEstimateRequestError'
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

  if (!OPENAI_COMPATIBLE_PROVIDERS.has(llmSettings.provider)) {
    throw new PhotoEstimateRequestError(`拍照估算目前只支援 openai／local／grok 供應商，收到：${llmSettings.provider}`)
  }
  if (!llmSettings.model) {
    throw new PhotoEstimateRequestError('尚未選擇模型')
  }
  const apiKey = resolveApiKey(llmSettings)
  if (!apiKey && llmSettings.provider !== 'local') {
    throw new PhotoEstimateRequestError('尚未設定 API Key')
  }
  if (photos.length === 0) {
    throw new PhotoEstimateRequestError('沒有照片可以送出')
  }

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
    max_tokens: 1500
  }
  if (llmSettings.provider === 'local') {
    // 思考模型會把預算全花在 reasoning、正文回空字串，見 CLAUDE.md §5「本機 LLM 供應商」。
    body.reasoning = { effort: 'none' }
  }

  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const combinedSignal = signal
    ? anySignal([signal, timeoutController.signal])
    : timeoutController.signal

  let response: Response
  try {
    response = await http.fetch(`${resolveBaseUrl(llmSettings)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: combinedSignal
    })
  } catch (error) {
    throw new PhotoEstimateRequestError('請求失敗或逾時', error)
  } finally {
    clearTimeout(timer)
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

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const s of signals) {
    if (s.aborted) { controller.abort(); break }
    s.addEventListener('abort', () => controller.abort(), { once: true })
  }
  return controller.signal
}
