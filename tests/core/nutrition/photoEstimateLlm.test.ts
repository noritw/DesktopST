import { describe, expect, it, vi } from 'vitest'
import { PhotoEstimateRequestError, requestPhotoEstimate } from '@core/nutrition'
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
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('燻雞三明治')
    expect(results[0].perServing).toEqual({ kcal: 320, proteinG: 18 })
  })

  it('自訂 endpoint 會拿掉結尾斜線再拼路徑', async () => {
    let capturedUrl: string | null = null
    const http = fakeHttp(async (input) => {
      capturedUrl = String(input)
      return jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] })
    })
    await requestPhotoEstimate({
      llmSettings: { ...baseLlmSettings, provider: 'local', endpoint: 'http://localhost:11434/v1/', apiKeys: {} },
      photos: [{ slot: 1, base64: 'AAA', mimeType: 'image/webp' }],
      recentNames: [],
      http
    })
    expect(capturedUrl).toBe('http://localhost:11434/v1/chat/completions')
  })

  it('local 供應商不需要 API Key', async () => {
    const http = fakeHttp(async () => jsonResponse({ choices: [{ message: { content: JSON.stringify({ results: [] }) } }] }))
    await expect(requestPhotoEstimate({
      llmSettings: { provider: 'local', model: 'qwen3', endpoint: 'http://localhost:11434/v1', apiKeys: {} },
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
