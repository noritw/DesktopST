import type { HttpAdapter } from '../adapters'

/**
 * LLM 層需要的平台能力。
 *
 * 目前只有 HTTP。刻意用一包物件而不是直接收 `HttpAdapter`，
 * 是為了日後要加東西時不必改所有簽名。
 *
 * ## 為什麼 provider 收得到 http 卻不見得用得到
 *
 * | SDK | 能不能注入自訂 fetch |
 * |---|---|
 * | `openai` | ✅ `new OpenAI({ fetch })` |
 * | `@anthropic-ai/sdk` | ✅ `new Anthropic({ fetch })` |
 * | `@google/generative-ai` | ❌ **沒有這個選項**，直接呼叫全域 `fetch` |
 *
 * Gemini 那家在手機端要靠 **Capacitor 的全域 fetch patch**
 * （`capacitor.config.ts` 的 `CapacitorHttp.enabled`）才能繞過 CORS，
 * 不是靠這裡注入。這是已知限制，不是漏做——見 `src/mobile/README.md`。
 */
export interface LLMDeps {
  http: HttpAdapter
}
