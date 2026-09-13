import { describe, expect, it, vi } from 'vitest'
import type { HttpAdapter } from '@core/adapters/http'
import {
  extractAuthor,
  extractOgDescription,
  extractShortDescription,
  looksLikeJunkDescription,
  parseYouTubeVideoId,
  readYouTubeVideo,
  tidyDescription
} from '@core/link/youtube'
import { readOneLink } from '@core/link/reader'
import { makeSettings } from '../fixtures'

/**
 * YouTube：只拿說明欄，不拿字幕（字幕實測不通，見 docs/link-reader-plan.md §9）。
 */

const DESC = '本集我們聊了台灣獨立遊戲的資金來源，包括文策院補助與群眾募資的實際差異。\n受訪者分享了三個失敗案例的細節，以及他認為新團隊最常誤判的兩件事。\n後半段談到發行商合約裡的分潤條款。'

function watchPage(over: { title?: string; desc?: string; author?: string; og?: string } = {}): string {
  const title = over.title ?? '獨立遊戲的錢從哪來 - YouTube'
  const og = over.og ?? '本集我們聊了台灣獨立遊戲的資金來源...'
  const parts = [
    `<html><head><title>${title}</title>`,
    `<meta property="og:description" content="${og}">`,
    '</head><body><script>var ytInitialPlayerResponse = {"videoDetails":{',
    `"author":"${over.author ?? '某某頻道'}",`,
    over.desc === undefined
      ? `"shortDescription":"${DESC.replace(/\n/g, '\\n')}"`
      : `"shortDescription":"${over.desc.replace(/\n/g, '\\n')}"`,
    '}};</script></body></html>'
  ]
  return parts.join('')
}

function fakeHttp(html: string): { http: HttpAdapter; headers: Record<string, string>[] } {
  const headers: Record<string, string>[] = []
  return {
    headers,
    http: {
      fetch: (async (_u: unknown, init: RequestInit) => {
        headers.push((init?.headers ?? {}) as Record<string, string>)
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
      }) as unknown as typeof globalThis.fetch,
      supportsStreaming: true
    }
  }
}

describe('parseYouTubeVideoId', () => {
  it('認得各種影片網址', () => {
    const id = 'dQw4w9WgXcQ'
    expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${id}`)).toBe(id)
    expect(parseYouTubeVideoId(`https://youtu.be/${id}`)).toBe(id)
    expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${id}`)).toBe(id)
    expect(parseYouTubeVideoId(`https://www.youtube.com/live/${id}`)).toBe(id)
    expect(parseYouTubeVideoId(`https://m.youtube.com/watch?v=${id}&t=30s`)).toBe(id)
    expect(parseYouTubeVideoId(`https://music.youtube.com/watch?v=${id}`)).toBe(id)
  })

  it('非影片的 YouTube 網址回 null（讓它落回一般處理）', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/@somechannel')).toBeNull()
    expect(parseYouTubeVideoId('https://www.youtube.com/')).toBeNull()
  })

  it('別家網站一律 null', () => {
    expect(parseYouTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseYouTubeVideoId('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

describe('從 HTML 挖欄位', () => {
  it('shortDescription 拿到的是完整說明，不是被截斷的 og', () => {
    const got = extractShortDescription(watchPage())
    expect(got).toContain('文策院補助')
    expect(got).toContain('分潤條款')   // og:description 那版被截掉的後半
    expect(got).toContain('\n')          // 跳脫字元有還原
  })

  it('被 Range 切斷時寧可不用，也不要半截的說明', () => {
    const truncated = '<html><script>{"shortDescription":"本集我們聊了台灣獨立遊戲'
    expect(extractShortDescription(truncated)).toBe('')
  })

  it('挖得到頻道名與 og:description', () => {
    const html = watchPage({ author: '不務正業頻道' })
    expect(extractAuthor(html)).toBe('不務正業頻道')
    expect(extractOgDescription(html)).toContain('資金來源')
  })
})

describe('說明欄雜訊判斷', () => {
  it('整段都是連結與 hashtag 的判成垃圾', () => {
    expect(looksLikeJunkDescription('https://patreon.com/foo\nhttps://twitter.com/foo\n#遊戲 #實況 #台灣')).toBe(true)
    expect(looksLikeJunkDescription('')).toBe(true)
  })

  it('正常說明不能被誤殺', () => {
    expect(looksLikeJunkDescription(DESC)).toBe(false)
  })

  it('裁切會砍掉整行都是網址的頻道尾巴，留下正文', () => {
    const out = tidyDescription(`${DESC}\n\nhttps://patreon.com/foo\nIG：https://instagram.com/foo`)
    expect(out).toContain('文策院補助')
    expect(out).not.toContain('patreon.com')
    expect(out).not.toContain('instagram.com')
  })
})

describe('readYouTubeVideo', () => {
  it('拿到標題、頻道、完整說明，並標成 video-description', async () => {
    const { http } = fakeHttp(watchPage())
    const out = await readYouTubeVideo({ http }, 'https://youtu.be/dQw4w9WgXcQ')
    expect(out.status).toBe('ok')
    expect(out.title).toBe('獨立遊戲的錢從哪來')   // 尾巴的「- YouTube」要拿掉
    expect(out.sourceKind).toBe('video-description')
    expect(out.text).toContain('某某頻道')
    expect(out.text).toContain('分潤條款')
  })

  it('送 Range 只要開頭那段（手機行動網路會差很多）', async () => {
    const { http, headers } = fakeHttp(watchPage())
    await readYouTubeVideo({ http }, 'https://youtu.be/dQw4w9WgXcQ')
    expect(headers[0].Range).toMatch(/^bytes=0-\d+$/)
  })

  it('說明欄是垃圾時保留標題，但明講沒有可用說明', async () => {
    const { http } = fakeHttp(watchPage({ desc: 'https://patreon.com/foo #tag #tag2' }))
    const out = await readYouTubeVideo({ http }, 'https://youtu.be/dQw4w9WgXcQ')
    expect(out.status).toBe('ok')
    expect(out.text).toContain('沒有可用的說明文字')
    expect(out.text).not.toContain('patreon')
  })
})

describe('接進 readOneLink', () => {
  it('YouTube 影片走專用路徑，不再回 js-rendered', async () => {
    const { http } = fakeHttp(watchPage())
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const out = await readOneLink({ http }, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', makeSettings())
    expect(out.status).toBe('ok')
    expect(out.sourceKind).toBe('video-description')
  })

  it('YouTube 頻道頁仍然是 js-rendered（沒有說明可拿）', async () => {
    const { http } = fakeHttp(watchPage())
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const out = await readOneLink({ http }, 'https://www.youtube.com/@somechannel', makeSettings())
    expect(out.status).toBe('js-rendered')
  })
})
