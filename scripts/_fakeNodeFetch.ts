/**
 * 假的 `node-fetch`，在建置時以 esbuild `--alias:node-fetch=` 換掉。
 *
 * ## 為什麼需要這個
 *
 * `openai` 與 `@anthropic-ai/sdk` 在 Node 環境下**不使用全域 `fetch`**，
 * 而是 `require('node-fetch')`（見兩者的 `_shims/node-runtime.js`）。
 * 所以光是 patch `globalThis.fetch` 攔不到它們——實測會真的送出請求並收到 401。
 *
 * 重構**後**的分支因為顯式注入 `deps.http.fetch`（＝被 patch 過的全域），
 * 攔得到；重構**前**的 `main` 沒有注入，攔不到。
 * 若兩邊用不同攔截機制，比對結果就不可信。
 *
 * 因此把 `node-fetch` 也導向同一個攔截點：**兩個版本、四家 provider，
 * 全部匯流到同一個被 patch 的 `globalThis.fetch`**，比對才是真的等價。
 *
 * 其餘 named export 直接沿用 Node 內建的 Web API 實作，SDK 只拿它們當建構子。
 */

const fetchImpl = ((input: any, init?: any) => (globalThis.fetch as any)(input, init)) as any

export default fetchImpl
export const fetch = fetchImpl
export const Headers = globalThis.Headers
export const Request = globalThis.Request
export const Response = globalThis.Response
export const FetchError = Error
export const AbortError = Error
export const isRedirect = (code: number): boolean => [301, 302, 303, 307, 308].includes(code)
