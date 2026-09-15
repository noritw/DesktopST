import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpAdapter } from '@core/adapters/http'
import { makeSettings } from '../fixtures'
// `vi.mock` 會被 vitest 提升到所有 import 之前，所以這裡用一般的靜態 import
// 就拿得到被 mock 過的 `@core/llm`。
// ⚠️ 不要改回 top-level `await import(...)`：`tsconfig` 的 module 設定不允許，
// `npm run typecheck` 會整個掛掉（TS1378）。
import { readOneLink } from '@core/link/reader'

/**
 * 長文才會走的「輔助模型濃縮」那一段。
 *
 * 獨立一支檔案是因為這裡要 mock `@core/llm`——`reader.test.ts` 刻意完全不碰 LLM，
 * 兩者混在同一支會讓「這條路有沒有打模型」變得看不出來。
 */
const chatWithLLM = vi.fn()

vi.mock('@core/llm', () => ({
  chatWithLLM: (...args: unknown[]) => chatWithLLM(...args),
  applyUtilitySettings: (s: unknown) => s
}))


/** 超過 DIRECT_MAX_LEN(1500) 才會觸發濃縮 */
const LONG_ARTICLE = '市府今天說明交通改善計畫的細節，並回答記者提問。'.repeat(80)

function fakeHttp(): HttpAdapter {
  const html = `<html><head><title>長篇報導</title></head><body><article>${LONG_ARTICLE}</article></body></html>`
  return {
    fetch: (async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof globalThis.fetch,
    supportsStreaming: true
  }
}

beforeEach(() => {
  chatWithLLM.mockReset()
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

describe('長文濃縮', () => {
  it('正文過長時丟輔助模型，用回來的摘要', async () => {
    chatWithLLM.mockResolvedValue({ content: '市府公布交通改善計畫，將增設行人專用時相。' })
    const out = await readOneLink({ http: fakeHttp() }, 'https://example.com/a', makeSettings())
    expect(chatWithLLM).toHaveBeenCalledTimes(1)
    expect(out.status).toBe('ok')
    expect(out.usedUtility).toBe(true)
    expect(out.text).toBe('市府公布交通改善計畫，將增設行人專用時相。')
  })

  it('輔助模型回空字串時退回截斷原文，不是整條失敗', async () => {
    chatWithLLM.mockResolvedValue({ content: '   ' })
    const out = await readOneLink({ http: fakeHttp() }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('ok')
    expect(out.usedUtility).toBe(false)
    expect(out.text?.length).toBeGreaterThan(100)
  })

  it('輔助模型直接拋錯時也一樣退回截斷原文', async () => {
    chatWithLLM.mockRejectedValue(new Error('401 unauthorized'))
    const out = await readOneLink({ http: fakeHttp() }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('ok')
    expect(out.usedUtility).toBe(false)
    expect(out.text).toContain('市府今天說明')
  })
})
