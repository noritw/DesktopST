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

  it('gpt-5／o 系列送 max_completion_tokens，不送 max_tokens（owner 實測 gpt-5.6-luna 回 400 的根因）', async () => {
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
  })

  it('模型拒絕某個參數（400 + Unsupported parameter）時拔掉那個參數重送一次', async () => {
    let attempt = 0
    let secondBody: any = null
    const http = fakeHttp(async (_input, init) => {
      attempt++
      if (attempt === 1) {
        return jsonResponse({ error: { message: "Unsupported parameter: 'response_format' is not supported with this model." } }, 400)
      }
      secondBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    const results = await requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(attempt).toBe(2)
    expect(secondBody.response_format).toBeUndefined()
    expect(results).toEqual([])
  })

  it('400 但不是「Unsupported parameter」格式時不重試，且錯誤內容仍讀得到', async () => {
    let attempt = 0
    const http = fakeHttp(async () => {
      attempt++
      return jsonResponse({ error: { message: 'invalid_api_key' } }, 400)
    })
    // 不重試那條路徑會把已讀掉的 body 重建成新的 Response（手機端不依賴 clone()），
    // 這裡順便驗證重建後呼叫端仍拿得到原始錯誤內容，不是空字串。
    await expect(requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })).rejects.toThrow(/invalid_api_key/)
    expect(attempt).toBe(1)
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

  it('不支援的供應商直接丟錯，不送出請求', async () => {
    const http = fakeHttp(async () => { throw new Error('不該被呼叫') })
    await expect(requestPhotoEstimate({
      llmSettings: { provider: 'gemini', model: 'gemini-3', apiKeys: { gemini: 'key' } },
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

  it('同一份食物的多張照片全部送出，且標註講明它們同屬一份（否則模型會拆成多筆）', async () => {
    let capturedBody: any = null
    const http = fakeHttp(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [{ name: '燻雞三明治', perServing: { kcal: 320, proteinG: 18 } }] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [
        { slot: 1, base64: 'AAA', mimeType: 'image/webp' },
        { slot: 1, base64: 'BBB', mimeType: 'image/webp' },
        { slot: 1, base64: 'CCC', mimeType: 'image/webp' }
      ],
      note: '燻雞三明治，有拍到營養標示',
      recentNames: [],
      http
    })
    const content = capturedBody.messages[0].content
    const images = content.filter((p: any) => p.type === 'image_url')
    expect(images).toHaveLength(3)
    expect(images.map((p: any) => p.image_url.url)).toEqual([
      'data:image/webp;base64,AAA',
      'data:image/webp;base64,BBB',
      'data:image/webp;base64,CCC'
    ])
    const captions = content.filter((p: any) => p.type === 'text').map((p: any) => p.text)
    expect(captions.some((t: string) => t.includes('同屬一份食物'))).toBe(true)
    // 補充說明要真的出現在送出的內容裡（規格 §1 原則 5 的最高優先線索）
    expect(captions[0]).toContain('燻雞三明治，有拍到營養標示')
  })

  it('多份食物時標註要講第幾份（slot），不能只說「同屬一份」', async () => {
    let capturedBody: any = null
    const http = fakeHttp(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [
        { slot: 1, base64: 'AAA', mimeType: 'image/webp' },
        { slot: 2, base64: 'BBB', mimeType: 'image/webp' }
      ],
      recentNames: [],
      http
    })
    const captions = capturedBody.messages[0].content.filter((p: any) => p.type === 'text').map((p: any) => p.text)
    expect(captions.some((t: string) => t.includes('第 1 份食物'))).toBe(true)
    expect(captions.some((t: string) => t.includes('第 2 份食物'))).toBe(true)
  })

  it('比例尺校正說明會被帶進送出的 prompt', async () => {
    let capturedBody: any = null
    const http = fakeHttp(async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: baseLlmSettings,
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      scaleReference: '我的手掌寬約 7 公分，比一般成人小',
      http
    })
    expect(capturedBody.messages[0].content[0].text).toContain('我的手掌寬約 7 公分，比一般成人小')
  })

  it('grok 沒填端點時打官方 x.ai 端點，不是悄悄落到 OpenAI 的預設值', async () => {
    let capturedUrl: string | null = null
    const http = fakeHttp(async (input) => {
      capturedUrl = String(input)
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: { provider: 'grok', model: 'grok-4.3', apiKeys: { grok: 'xai-test' } },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedUrl).toBe('https://api.x.ai/v1/chat/completions')
  })

  it('claude 走 Anthropic Messages API（不同的端點／標頭／body 形狀）', async () => {
    let capturedUrl: string | null = null
    let capturedHeaders: Record<string, string> | null = null
    let capturedBody: any = null
    const http = fakeHttp(async (input, init) => {
      capturedUrl = String(input)
      capturedHeaders = init?.headers as Record<string, string>
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ content: [{ type: 'text', text: JSON.stringify({ results: [{ name: '燻雞三明治', perServing: { kcal: 320, proteinG: 18 } }] }) }] })
    })
    const results = await requestPhotoEstimate({
      llmSettings: { provider: 'claude', model: 'claude-haiku-4-5', apiKeys: { claude: 'sk-ant-test' } },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages')
    expect(capturedHeaders?.['x-api-key']).toBe('sk-ant-test')
    expect(capturedHeaders?.['anthropic-version']).toBeTruthy()
    expect(capturedHeaders?.Authorization).toBeUndefined()
    expect(capturedBody.max_tokens).toBe(1500)
    expect(capturedBody.messages[0].content[2].type).toBe('image')
    expect(capturedBody.messages[0].content[2].source.media_type).toBe('image/webp')
    expect(results[0].perServing).toEqual({ kcal: 320, proteinG: 18 })
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

  it('claude 走 Anthropic Messages API 格式', async () => {
    let capturedUrl: string | null = null
    let capturedBody: any = null
    const http = fakeHttp(async (input, init) => {
      capturedUrl = String(input)
      capturedBody = JSON.parse(String(init?.body))
      return jsonResponse({ content: [{ type: 'text', text: '可以讀圖' }] })
    })
    const result = await testPhotoEstimateVision({ provider: 'claude', model: 'claude-haiku-4-5', apiKeys: { claude: 'sk-ant-test' } }, http)
    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages')
    expect(capturedBody.messages[0].content[1].type).toBe('image')
    expect(result).toEqual({ ok: true, reply: '可以讀圖' })
  })
})
