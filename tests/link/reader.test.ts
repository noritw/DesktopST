import { describe, expect, it, vi } from 'vitest'
import type { HttpAdapter } from '@core/adapters/http'
import { buildLinkInjection, getLinkContext, readOneLink } from '@core/link/reader'
import type { LinkFetchOutcome } from '@core/link/types'
import { makeSettings } from '../fixtures'

/**
 * 連結閱讀的抓取與判定（2026-09-13）。
 *
 * 這裡只走「正文短到不用摘要」那條路，所以完全不碰 LLM——輔助模型濃縮那段
 * 另外在 `summarize.test.ts` 用 mock 驗。
 */

const ARTICLE = '台北市今天公布新的交通改善計畫，預計在三個路口增設行人專用時相，並把兩條公車專用道延長。'
  + '市府表示施工期間會分階段調整號誌，完工時間預計落在明年第二季。'
  + '交通局說明，這三個路口過去三年累計發生四十七件行人事故，是全市前十名。'
  + '同一期程還會把兩處人行道加寬，並在路口增設庇護島，總經費約兩億八千萬元。'

function htmlPage(body: string, title = '交通改善計畫'): string {
  return `<html><head><title>${title}</title></head><body><article>${body}</article></body></html>`
}

/** 固定回同一份回應的假 http；`calls` 讓測試驗「有沒有真的去抓」。 */
function fakeHttp(make: (url: string) => Response): { http: HttpAdapter; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    http: {
      fetch: (async (input: unknown) => {
        const url = typeof input === 'string' ? input : String(input)
        calls.push(url)
        return make(url)
      }) as unknown as typeof globalThis.fetch,
      supportsStreaming: true
    }
  }
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

describe('readOneLink', () => {
  it('一般文章頁：抓到標題與正文，而且不必動用輔助模型', async () => {
    const { http } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const out = await readOneLink({ http }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('ok')
    expect(out.title).toBe('交通改善計畫')
    expect(out.text).toContain('行人專用時相')
    expect(out.usedUtility).toBe(false)
  })

  it('og:title 優先於 <title>（後者常帶站名後綴）', async () => {
    const html = `<html><head><title>交通改善計畫 | 某某新聞網</title><meta property="og:title" content="交通改善計畫"></head><body><article>${ARTICLE}</article></body></html>`
    const { http } = fakeHttp(() => htmlResponse(html))
    const out = await readOneLink({ http }, 'https://example.com/a', makeSettings())
    expect(out.title).toBe('交通改善計畫')
  })

  it('社群站連抓都不抓，直接標成 js-rendered', async () => {
    const { http, calls } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const out = await readOneLink({ http }, 'https://x.com/someone/status/1', makeSettings())
    expect(out.status).toBe('js-rendered')
    expect(calls).toEqual([])
  })

  it('內網／本機位址不抓', async () => {
    const { http, calls } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const out = await readOneLink({ http }, 'http://192.168.1.20:8080/admin', makeSettings())
    expect(out.status).toBe('private-host')
    expect(calls).toEqual([])
  })

  it('403／429 判成「對方擋住」，跟連不上分開', async () => {
    const { http } = fakeHttp(() => htmlResponse('nope', 403))
    const out = await readOneLink({ http }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('blocked')
  })

  it('連不上就是 fetch-failed', async () => {
    const http: HttpAdapter = {
      fetch: (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as typeof globalThis.fetch,
      supportsStreaming: true
    }
    const out = await readOneLink({ http }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('fetch-failed')
  })

  it('PDF 之類的非網頁另外標，不要混進「讀取失敗」', async () => {
    const { http } = fakeHttp(() => new Response('%PDF-1.7', { status: 200, headers: { 'content-type': 'application/pdf' } }))
    const out = await readOneLink({ http }, 'https://example.com/a.pdf', makeSettings())
    expect(out.status).toBe('unsupported-type')
  })

  it('抓得到頁面但內容薄，且出現登入字樣 → login-required', async () => {
    const { http } = fakeHttp(() => htmlResponse('<html><head><title>會員內容</title></head><body><div>請先登入才能閱讀全文</div></body></html>'))
    const out = await readOneLink({ http }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('login-required')
  })

  it('內容薄但沒有登入字樣 → empty（不要一律賴給登入牆）', async () => {
    const { http } = fakeHttp(() => htmlResponse('<html><head><title>空頁</title></head><body><div>目前沒有資料</div></body></html>'))
    const out = await readOneLink({ http }, 'https://example.com/a', makeSettings())
    expect(out.status).toBe('empty')
  })
})

describe('buildLinkInjection', () => {
  const ok: LinkFetchOutcome = { url: 'https://example.com/a', title: '交通改善計畫', status: 'ok', text: ARTICLE, usedUtility: false }
  const failed: LinkFetchOutcome = { url: 'https://x.com/a/status/1', title: '', status: 'js-rendered', usedUtility: false }

  it('成功的連結帶標題、網址與內文', () => {
    const text = buildLinkInjection([ok]) ?? ''
    expect(text).toContain('[Link]')
    expect(text).toContain('交通改善計畫')
    expect(text).toContain('https://example.com/a')
    expect(text).toContain('行人專用時相')
  })

  it('讀不到的連結也一定要進 prompt，並寫明原因', () => {
    const text = buildLinkInjection([failed]) ?? ''
    expect(text).toContain('讀不到')
    expect(text).toContain('https://x.com/a/status/1')
    // 這句是防模型照著網址掰內容的唯一保險，不能被改掉
    expect(text).toContain('不要憑網址猜內容')
  })

  it('成功與失敗混在同一則訊息時兩者都列出來', () => {
    const text = buildLinkInjection([ok, failed]) ?? ''
    expect(text).toContain('1. 交通改善計畫')
    expect(text).toContain('2. https://x.com/a/status/1')
  })

  it('沒有任何連結時回 null', () => {
    expect(buildLinkInjection([])).toBeNull()
  })
})

describe('getLinkContext', () => {
  it('訊息裡沒有網址時完全不動作（一般聊天零成本）', async () => {
    const { http, calls } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const r = await getLinkContext({ http }, '今天天氣真好', makeSettings())
    expect(r.context).toBeNull()
    expect(r.outcomes).toEqual([])
    expect(calls).toEqual([])
  })

  it('模組關掉時不抓', async () => {
    const { http, calls } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const settings = makeSettings({ linkReader: { enabled: false } })
    const r = await getLinkContext({ http }, '看這篇 https://example.com/a', settings)
    expect(r.context).toBeNull()
    expect(calls).toEqual([])
  })

  it('未設定 linkReader 視為啟用', async () => {
    const { http } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const r = await getLinkContext({ http }, '看這篇 https://example.com/a', makeSettings())
    expect(r.context).toContain('交通改善計畫')
  })

  it('情境覆蓋（enabledOverride）蓋得過全域開關，兩個方向都要成立', async () => {
    const { http } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const off = makeSettings({ linkReader: { enabled: false } })
    expect((await getLinkContext({ http }, 'https://example.com/a', off, true)).context).not.toBeNull()
    const on = makeSettings({ linkReader: { enabled: true } })
    expect((await getLinkContext({ http }, 'https://example.com/a', on, false)).context).toBeNull()
  })

  it('一則訊息最多只讀兩個連結', async () => {
    const { http, calls } = fakeHttp(() => htmlResponse(htmlPage(ARTICLE)))
    const r = await getLinkContext({ http }, 'https://a.com/1 https://b.com/2 https://c.com/3', makeSettings())
    expect(calls).toHaveLength(2)
    expect(r.outcomes).toHaveLength(2)
  })

  it('單一連結整個炸掉也不能讓使用者收不到回覆', async () => {
    const http: HttpAdapter = {
      fetch: (() => { throw new Error('boom') }) as unknown as typeof globalThis.fetch,
      supportsStreaming: true
    }
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const r = await getLinkContext({ http }, 'https://example.com/a', makeSettings())
    expect(r.outcomes[0].status).toBe('fetch-failed')
    expect(r.context).toContain('讀不到')
  })
})
