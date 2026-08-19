import { describe, expect, it, vi } from 'vitest'
import { PhotoEstimateRequestError, requestPhotoEstimate, testNutritionLlmConnection, testPhotoEstimateVision } from '@core/nutrition'
import type { HttpAdapter } from '@core/adapters'
import type { NutritionLlmSettings } from '@core/nutrition'

function fakeHttp(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): HttpAdapter {
  return { fetch: handler as unknown as typeof fetch, supportsStreaming: true }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const baseLlmSettings: NutritionLlmSettings = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeys: { openai: 'sk-test' }
}

describe('requestPhotoEstimate', () => {
  it('組出正確的請求並解析回應', async () => {
    let capturedBody: any = null
    let capturedUrl: string | null = null
    const http = fakeHttp(async (input, init) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({ results: [{ name: '燻雞三明治', perServing: { kcal: 320, proteinG: 18 } }] }) } }]
      })
    })

    const results = await requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: ['燻雞三明治'],
      http
    })

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
    expect(capturedBody.model).toBe('gpt-4o-mini')
    expect(capturedBody.max_tokens).toBe(1500)
    expect(capturedBody.max_completion_tokens).toBeUndefined()
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('燻雞三明治')
    expect(results[0].perServing).toEqual({ kcal: 320, proteinG: 18 })
  })

  it('gpt-5／o 系列送 max_completion_tokens 與 reasoning_effort，不送 max_tokens（owner 實測 gpt-5.6-luna 回 400 的根因）', async () => {
    let capturedBody: any = null
    const http = fakeHttp(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: { ...baseLlmSettings, model: 'gpt-5.6-luna' },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedBody.max_tokens).toBeUndefined()
    expect(capturedBody.max_completion_tokens).toBe(1500)
    expect(capturedBody.reasoning_effort).toBe('minimal')
  })

  it('o 系列（o1/o3/o4-mini…）也走 max_completion_tokens', async () => {
    let capturedBody: any = null
    const http = fakeHttp(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: { ...baseLlmSettings, model: 'o3' },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedBody.max_tokens).toBeUndefined()
    expect(capturedBody.max_completion_tokens).toBe(1500)
  })

  it('切換供應商後端點互不影響（每個 provider 各自的 endpoints 鍵）', async () => {
    let capturedUrl: string | null = null
    const http = fakeHttp(async (input) => {
      capturedUrl = String(input)
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    // 先前在 local 測過連線，endpoints.local 有殘留值；這次用 openai 送出，
    // 不應該打到 local 那個位址（曾經因為單一扁平 endpoint 欄位而共用同一個值）。
    await requestPhotoEstimate({
      llmSettings: { ...baseLlmSettings, endpoints: { local: 'http://localhost:11434/v1' } },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('自訂 endpoint 會拿掉結尾斜線再拼路徑', async () => {
    let capturedUrl: string | null = null
    const http = fakeHttp(async (input) => {
      capturedUrl = String(input)
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: { ...baseLlmSettings, provider: 'local', endpoints: { local: 'http://localhost:11434/v1/' }, apiKeys: {} },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedUrl).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('local 供應商不需要 API Key', async () => {
    const http = fakeHttp(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] }))
    await expect(requestPhotoEstimate({
      llmSettings: { provider: 'local', model: 'qwen3', endpoints: { local: 'http://localhost:11434/v1' }, apiKeys: {} },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })).resolves.toEqual([])
  })

  it('非 OpenAI 相容供應商直接丟錯，不送出請求', async () => {
    const http = fakeHttp(async () => { throw new Error('不該被呼叫') })
    await expect(requestPhotoEstimate({
      llmSettings: { provider: 'claude', model: 'claude-3', apiKeys: {} },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })).rejects.toBeInstanceOf(PhotoEstimateRequestError)
  })

  it('缺 API Key（雲端供應商）丟錯', async () => {
    const http = fakeHttp(async () => { throw new Error('不該被呼叫') })
    await expect(requestPhotoEstimate({
      llmSettings: { ...baseLlmSettings, apiKeys: {} },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })).rejects.toThrow('API Key')
  })

  it('沒有照片丟錯', async () => {
    const http = fakeHttp(async () => { throw new Error('不該被呼叫') })
    await expect(requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [],
      recentNames: [],
      http
    })).rejects.toThrow('照片')
  })

  it('HTTP 非 2xx 回應丟錯', async () => {
    const http = fakeHttp(async () => jsonResponse({ error: 'bad key' }, 401))
    await expect(requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })).rejects.toBeInstanceOf(PhotoEstimateRequestError)
  })

  it('模型回應非合法 JSON 時丟錯', async () => {
    const http = fakeHttp(async () => jsonResponse({ choices: [{ message: { content: '這不是 JSON' } }] }))
    await expect(requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })).rejects.toThrow('JSON')
  })

  it('逾時會中止請求並丟錯', async () => {
    const http = fakeHttp((_input, init) => new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined
      signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    await expect(requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http,
      timeoutMs: 20
    })).rejects.toBeInstanceOf(PhotoEstimateRequestError)
  })
})

describe('testNutritionLlmConnection', () => {
  it('連線成功時回傳模型清單', async () => {
    let capturedUrl: string | null = null
    let capturedHeaders: Record<string, string> | null = null
    const http = fakeHttp(async (input, init) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string>
      return jsonResponse({ data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] })
    })
    const result = await testNutritionLlmConnection(baseLlmSettings, http)
    expect(capturedUrl).toBe('https://api.openai.com/v1/models')
    expect(capturedHeaders?.Authorization).toBe('Bearer sk-test')
    expect(result).toEqual({ ok: true, models: ['gpt-4o-mini', 'gpt-4o'] })
  })

  it('local 供應商不帶 Authorization header，且清單上限較高', async () => {
    let capturedHeaders: Record<string, string> | null = null
    const http = fakeHttp(async (_input, init) => {
      capturedHeaders = init?.headers as Record<string, string>
      return jsonResponse({ data: Array.from({ length: 250 }, (_, i) => ({ id: `model-${i}` })) })
    })
    const result = await testNutritionLlmConnection({ provider: 'local', model: '', endpoints: { local: 'http://localhost:11434/v1' }, apiKeys: {} }, http)
    expect(capturedHeaders?.Authorization).toBeUndefined()
    expect(result.ok).toBe(true)
    expect(result.models).toHaveLength(200)
  })

  it('連線失敗回傳 ok:false 與錯誤訊息', async () => {
    const http = fakeHttp(async () => jsonResponse({ error: 'invalid key' }, 401))
    const result = await testNutritionLlmConnection(baseLlmSettings, http)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('缺 API Key 不送出請求，直接回錯誤', async () => {
    const http = fakeHttp(async () => { throw new Error('不該被呼叫') })
    const result = await testNutritionLlmConnection({ ...baseLlmSettings, apiKeys: {} }, http)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('API Key') })
  })
})

describe('testPhotoEstimateVision', () => {
  it('模型正常讀圖時回傳 ok:true 與回覆內容', async () => {
    let capturedBody: any = null
    const http = fakeHttp(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: '可以讀圖' } }] })
    })
    const result = await testPhotoEstimateVision(baseLlmSettings, http)
    expect(result).toEqual({ ok: true, reply: '可以讀圖' })
    expect(capturedBody.messages[0].content[1].type).toBe('image_url')
  })

  it('模型回覆表示看不到圖片時判定失敗', async () => {
    const http = fakeHttp(async () => jsonResponse({ choices: [{ message: { content: '抱歉，我無法看到圖片內容' } }] }))
    const result = await testPhotoEstimateVision(baseLlmSettings, http)
    expect(result.ok).toBe(false)
    expect(result.reply).toContain('無法')
  })

  it('空回應視為失敗', async () => {
    const http = fakeHttp(async () => jsonResponse({ choices: [{ message: { content: '' } }] }))
    const result = await testPhotoEstimateVision(baseLlmSettings, http)
    expect(result.ok).toBe(false)
  })

  it('尚未選擇模型直接回錯誤，不送出請求', async () => {
    const http = fakeHttp(async () => { throw new Error('不該被呼叫') })
    const result = await testPhotoEstimateVision({ ...baseLlmSettings, model: undefined }, http)
    expect(result).toEqual({ ok: false, error: expect.stringContaining('模型') })
  })
})
