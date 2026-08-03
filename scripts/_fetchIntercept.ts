/**
 * fetch 攔截器（必須在任何應用程式模組之前載入）。
 *
 * ⚠️ 為什麼要獨立成一個檔並且第一個 import：
 * 重構後的 `main/adapters/httpAdapter.ts` 在**模組載入當下**就做了
 * `globalThis.fetch.bind(globalThis)`。若攔截器晚於它安裝，
 * adapter 抓到的會是真正的 fetch，請求就會真的打出去（實測會收到 401）。
 *
 * 這也順帶說明了一件事：adapter 綁定的是「載入當下的全域 fetch」。
 * Capacitor 的 CapacitorHttp 是在 app 啟動最早期就 patch 掉 window.fetch，
 * 所以手機端沒問題；但任何想「事後」抽換 fetch 的做法都不會生效。
 */


// ── 凍結時間（必須在應用程式模組載入前）─────────────────────
//
// prompt 會注入「現在時間」（buildTriggerTimeStr 呼叫 Date.now()）。
// 不凍結的話，兩個版本只要跨過一分鐘就會產生假差異——
// 實測第一次比對「48/48 相同」其實是因為兩次執行剛好在同一分鐘內，
// 那是運氣不是證明。凍結後才是真的可重現。
const FIXED_NOW = 1_770_000_000_000 // 2026-02-02 左右，固定值
const RealDate = Date
class FrozenDate extends RealDate {
  constructor(...args: any[]) {
    if (args.length === 0) super(FIXED_NOW)
    else super(...(args as []))
  }
  static now(): number { return FIXED_NOW }
}
globalThis.Date = FrozenDate as DateConstructor

export interface Captured { url: string; method?: string; body: unknown }

export const state = {
  captured: [] as Captured[],
  provider: 'openai'
}

function cannedResponse(provider: string): string {
  if (provider === 'claude') {
    return JSON.stringify({
      id: 'msg_test', type: 'message', role: 'assistant', model: 'test',
      content: [{ type: 'text', text: '[neutral] 測試回覆' }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 }
    })
  }
  if (provider === 'gemini') {
    return JSON.stringify({
      candidates: [{ content: { parts: [{ text: '[neutral] 測試回覆' }], role: 'model' }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 }
    })
  }
  return JSON.stringify({
    id: 'resp_test', object: 'response', model: 'test',
    output_text: '[neutral] 測試回覆',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '[neutral] 測試回覆' }] }],
    usage: { input_tokens: 1, output_tokens: 1 }
  })
}

globalThis.fetch = (async (input: any, init?: any) => {
  let url: string
  let method: string | undefined
  let rawBody: any

  if (typeof input === 'string' || input instanceof URL) {
    url = String(input)
    method = init?.method
    rawBody = init?.body
  } else {
    // SDK 傳 Request 物件 —— 正是 B1 收尾發現 HttpAdapter 型別必須放寬的原因
    url = input.url
    method = input.method
    rawBody = init?.body
    if (rawBody === undefined && typeof input.clone === 'function') {
      try { rawBody = await input.clone().text() } catch { /* ignore */ }
    }
  }

  if (rawBody && typeof rawBody !== 'string') {
    try { rawBody = Buffer.from(rawBody).toString('utf-8') } catch { rawBody = String(rawBody) }
  }
  let parsed: unknown = rawBody
  if (typeof rawBody === 'string') {
    try { parsed = JSON.parse(rawBody) } catch { /* 保持字串 */ }
  }

  state.captured.push({ url: String(url).replace(/key=[^&]*/g, 'key=REDACTED'), method, body: parsed })
  return new Response(cannedResponse(state.provider), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof globalThis.fetch
