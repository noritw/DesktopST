import type { HttpAdapter } from '@core/adapters'

/**
 * 目前沒有裝 CapacitorHttp（這個獨立小型 App 尚未像 DeST 主 App 那樣需要繞過
 * CORS），直接用瀏覽器原生 fetch。OpenAI 的 API 本身允許瀏覽器端 CORS 呼叫；
 * 本地模型（Ollama 等）若擋 CORS，需要使用者自行在該服務端開放，不在這裡處理。
 */
export const nutritionMobileHttp: HttpAdapter = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  supportsStreaming: true
}
