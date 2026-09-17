import { describe, expect, it, vi } from 'vitest'
import type { HttpAdapter } from '@core/adapters/http'
import {
  extractFacebookEmbedText,
  extractPlurkBody,
  canonicalFromSharePage,
  extractThreadsEmbedText,
  htmlBlockToText,
  parsePlurkResponses,
  parseSocialLink,
  plurkCodeToId,
  readSocialPost,
  sliceBalancedDiv,
  stripExpandAffordances
} from '@core/link/social'
import { readOneLink } from '@core/link/reader'
import { makeSettings } from '../fixtures'

/**
 * 社群貼文連結：噗浪／FB／Threads（2026-09-18）。
 *
 * 這裡的 HTML 片段都是**照真實回應的結構**縮寫的，不是憑空捏的
 * ——抽取邏輯的坑全在「結構長什麼樣」，用理想化的 HTML 測等於沒測。
 */

/* ------------------------------------------------------------------ */
/* 網址判定                                                            */
/* ------------------------------------------------------------------ */

describe('parseSocialLink', () => {
  it('噗浪單噗：認得出來並把 base36 轉成 plurk id', () => {
    const t = parseSocialLink('https://www.plurk.com/p/3j60ce8oo1')
    expect(t).toEqual({
      kind: 'plurk',
      url: 'https://www.plurk.com/p/3j60ce8oo1',
      plurkId: '358751892745441'
    })
  })

  it('噗浪手機版網址 /m/p/ 也要認', () => {
    expect(parseSocialLink('https://www.plurk.com/m/p/3j60ce8oo1')?.kind).toBe('plurk')
  })

  it('FB 粉專貼文與社團貼文要分成不同 kind（拿得到的東西差很多）', () => {
    expect(parseSocialLink('https://www.facebook.com/aspergerhouse/posts/pfbid02abc')?.kind)
      .toBe('facebook-post')
    expect(parseSocialLink('https://www.facebook.com/groups/some.group/permalink/12345/')?.kind)
      .toBe('facebook-group')
  })

  it('社團的 /posts/ 與 /permalink/ 正規化成同一個網址', () => {
    const a = parseSocialLink('https://www.facebook.com/groups/g/permalink/123/')
    const b = parseSocialLink('https://www.facebook.com/groups/g/posts/123/')
    expect(a?.url).toBe(b?.url)
  })

  it('FB 貼文網址後面那串 __cft__ 追蹤參數要被丟掉', () => {
    const t = parseSocialLink(
      'https://www.facebook.com/aspergerhouse/posts/pfbid02abc?__cft__[0]=AZg8wn7X&__tn__=%2CO%2CP-R'
    )
    expect(t?.url).toBe('https://www.facebook.com/aspergerhouse/posts/pfbid02abc')
  })

  it('FB 新版分享連結與舊式 permalink.php 都要認', () => {
    expect(parseSocialLink('https://www.facebook.com/share/p/1DZySPU3pT/')?.kind).toBe('facebook-post')
    expect(parseSocialLink('https://www.facebook.com/permalink.php?story_fbid=9&id=8')?.kind)
      .toBe('facebook-post')
  })

  it('Threads 兩個網域都認，正規化到 threads.com', () => {
    expect(parseSocialLink('https://www.threads.net/@zuck/post/C90rSTwO78K')?.url)
      .toBe('https://www.threads.com/@zuck/post/C90rSTwO78K')
  })

  /*
   * ⚠️ 「複製連結」給的是短網址，**不是** /@user/post/<code>。
   * 使用者實際會貼的就是這個形式，漏掉等於最常見的用法全部讀不到
   * （2026-09-18 owner 實測當場中）。
   */
  it('Threads 的「複製連結」短網址 /share/<code> 要認得，並標成 shareLink', () => {
    const t = parseSocialLink('https://www.threads.com/share/BAR6zALcz2/')
    expect(t).toEqual({
      kind: 'threads',
      url: 'https://www.threads.com/share/BAR6zALcz2/',
      shareLink: true
    })
  })

  it('FB 的「複製連結」短網址 /share/p/ 與 /share/v/ 也要標成 shareLink', () => {
    expect(parseSocialLink('https://www.facebook.com/share/p/1DZySPU3pT/')?.shareLink).toBe(true)
    expect(parseSocialLink('https://www.facebook.com/share/v/abc123/')?.shareLink).toBe(true)
  })

  it('story.php 正規化成 permalink.php（嵌入端點只吃後者）', () => {
    expect(parseSocialLink('https://www.facebook.com/story.php?story_fbid=9&id=8')?.url)
      .toBe('https://www.facebook.com/permalink.php?story_fbid=9&id=8')
  })

  it('正規網址不該被標成 shareLink（否則會白跑一趟解析）', () => {
    expect(parseSocialLink('https://www.threads.com/@a/post/XYZ')?.shareLink).toBeUndefined()
  })

  it('不是「單篇貼文」的社群網址一律回 null（留給 js-rendered 處理）', () => {
    for (const u of [
      'https://www.threads.com/@zuck',
      'https://www.facebook.com/Meta',
      'https://www.facebook.com/groups/some.group',
      'https://www.plurk.com/someuser',
      'https://www.plurk.com/',
      'https://example.com/a'
    ]) {
      expect(parseSocialLink(u), u).toBeNull()
    }
  })

  it('壞掉的網址不會拋', () => {
    expect(parseSocialLink('not a url')).toBeNull()
  })
})

describe('plurkCodeToId', () => {
  it('base36 轉十進位', () => {
    expect(plurkCodeToId('3j60ce8oo1')).toBe('358751892745441')
  })

  it('不合格式或超出安全整數範圍回 null（寧可不處理也不要算錯 id）', () => {
    expect(plurkCodeToId('!!')).toBeNull()
    expect(plurkCodeToId('')).toBeNull()
    expect(plurkCodeToId('zzzzzzzzzzzz')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* HTML 抽取                                                           */
/* ------------------------------------------------------------------ */

describe('sliceBalancedDiv', () => {
  it('巢狀 div 要配對到正確的結尾，不能停在第一個 </div>', () => {
    const html = '<div class="x">前<div class="inner">中</div>後</div>尾巴'
    const inner = sliceBalancedDiv(html, html.indexOf('<div class="x"'))
    expect(inner).toBe('前<div class="inner">中</div>後')
    expect(inner).not.toContain('尾巴')
  })

  it('沒配對到結尾時回空字串，不回半截（半截會安靜地通過長度檢查）', () => {
    const html = '<div class="x">前面有很長的內容但是沒有關閉標籤'
    expect(sliceBalancedDiv(html, 0)).toBe('')
  })
})

describe('htmlBlockToText', () => {
  it('<br> 與 </p> 變換行，整篇不會壓成一行', () => {
    expect(htmlBlockToText('第一行<br />第二行<br>第三行')).toBe('第一行\n第二行\n第三行')
  })

  it('行內標籤整個拿掉、不留空白（不然 hashtag 會跟標點分家）', () => {
    const html = '我認為 <span class="hashtag">#以色列的模式</span>是最好的。'
    expect(htmlBlockToText(html)).toBe('我認為 #以色列的模式是最好的。')
  })

  it('數值實體要還原，emoji 不能壞掉', () => {
    expect(htmlBlockToText('&#x53f0;&#x7063; &#x1f9cb;')).toBe('台灣 🧋')
  })

  it('連續空行壓成一個', () => {
    expect(htmlBlockToText('A<br><br><br><br>B')).toBe('A\n\nB')
  })
})

describe('stripExpandAffordances', () => {
  it('砍掉摺疊點的 ⋯⋯ 與結尾的「查看更多」', () => {
    expect(stripExpandAffordances('第一段\n⋯⋯\n第二段\n\n查看更多')).toBe('第一段\n第二段')
  })

  it('句子裡正常用的刪節號不能被砍', () => {
    expect(stripExpandAffordances('他說⋯⋯然後就走了')).toBe('他說⋯⋯然後就走了')
  })
})

/* ------------------------------------------------------------------ */
/* 噗浪                                                                */
/* ------------------------------------------------------------------ */

const PLURK_PAGE = `<!DOCTYPE html><html><head><title>ಠ_ಠ - 內文 - Plurk</title></head><body>
<article id="permanent-plurk">
<div class="plurk bigplurk" data-pid="358751892745441" data-uid="99999">
<div class="user"><a href="/anonymous" data-uid="99999" class="name">ಠ_ಠ</a>
<span class="qualifier q_whispers">偷偷說</span></div>
<div class="time"><time datetime="2026-09-17T11:38:27Z">Sep 17</time></div>
<div class="content"><div class="text_holder">收容所開放認養<br /><span class="hashtag">#在竹北</span><br />
<a href="https://apc.example.gov.tw/x" class="ex_link">https://apc.example.gov.tw/...</a>
<div class="pictures"><img src="https://images.plurk.com/a.jpg"></div></div></div>
</div></article></body></html>`

describe('extractPlurkBody', () => {
  it('抽得到作者、限定詞與正文，巢狀的圖片區塊不會把正文切斷', () => {
    const got = extractPlurkBody(PLURK_PAGE)
    expect(got.author).toBe('ಠ_ಠ')
    // 「偷偷說／覺得／想要」是語意的一部分，不是裝飾，一定要帶
    expect(got.qualifier).toBe('偷偷說')
    expect(got.text).toContain('收容所開放認養')
    expect(got.text).toContain('#在竹北')
    expect(got.text).toContain('https://apc.example.gov.tw/...')
  })
})

describe('parsePlurkResponses', () => {
  const RAW = JSON.stringify({
    responses: [
      { id: 1, user_id: 99999, content_raw: '第一則回應', qualifier: ':' },
      { id: 2, user_id: 42, content_raw: '第二則回應', qualifier: '覺得' },
      { id: 3, user_id: 42, content_raw: '   ' }
    ],
    users: { 42: { display_name: '小明', nick_name: 'ming' } }
  })

  it('對得到使用者名稱，空回應會被濾掉', () => {
    const got = parsePlurkResponses(RAW)
    expect(got).toHaveLength(2)
    expect(got[1]).toEqual({ author: '小明', qualifier: '覺得', text: '第二則回應' })
  })

  it('qualifier 的 ":" 是內部值（代表沒有限定詞），不可以顯示出來', () => {
    expect(parsePlurkResponses(RAW)[0].qualifier).toBe('')
  })

  it('壞掉的 JSON 回空陣列而不是拋（這是非官方端點，壞掉是遲早的事）', () => {
    expect(parsePlurkResponses('<html>not json</html>')).toEqual([])
    expect(parsePlurkResponses('{"responses":"nope"}')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* Facebook                                                            */
/* ------------------------------------------------------------------ */

const FB_EMBED = `<html><body><div class="_4i-s">
<div data-testid="post_message" class="_5pbx userContent">
<div id="id_x" class="text_exposed_root"><p>第一段內容，這裡在講兵役制度的三國比較。</p><p>第二段內容，裡面有<span class="hashtag">#標籤</span>，談的是替代役的設計差異。</p>
<span class="text_exposed_show"><p>被「查看更多」摺起來的第三段，這段在原始頁面上要點開才看得到。</p></span></div>
</div></div>
<div class="_5pcr">底下是留言區，不要抓進來</div></body></html>`

/**
 * 造一個「只有 og:description」的頁面。
 *
 * 內文刻意用數值實體編碼——FB／Threads 真的是這樣送的，用明文寫等於沒測到
 * `decodeHtmlEntities`。也刻意寫得夠長：`readOgExcerpt` 有 20 字的下限，
 * 太短會被判成 empty（門檻是刻意的，不該為了測試調低）。
 */
function ogOnlyPage(text: string): string {
  const encoded = [...text].map(c => `&#x${c.codePointAt(0)!.toString(16)};`).join('')
  return `<html><head><meta property="og:description" content="${encoded}" /></head></html>`
}

describe('extractFacebookEmbedText', () => {
  it('抽得到全文，包含被「查看更多」摺起來的段落', () => {
    const got = extractFacebookEmbedText(FB_EMBED)
    expect(got).toContain('第一段內容')
    expect(got).toContain('被「查看更多」摺起來的第三段')
  })

  it('不會把容器外的留言區一起抓進來', () => {
    expect(extractFacebookEmbedText(FB_EMBED)).not.toContain('底下是留言區')
  })

  it('沒有 post_message 容器時回空字串（呼叫端會退回 og 摘要）', () => {
    expect(extractFacebookEmbedText('<html><body>nope</body></html>')).toBe('')
  })
})

/* ------------------------------------------------------------------ */
/* Threads                                                             */
/* ------------------------------------------------------------------ */

/** 真實結構：回覆時**母貼文排在前面**，目標貼文的 class 多一個 Full */
const THREADS_EMBED = `<html><body>
<div class="BodyContainerParent BodyContainer">
<span class="TextContentContainer" id="u_0_1"><span class="BodyTextContainer"><span>母貼文的內容，這是被回覆的那一則貼文。</span></span></span>
</div>
<div class="BodyContainerNoThreadLine">
<span class="TextContentContainerFull TextContentContainer" id="u_0_2"><span class="BodyTextContainer"><a href="https://www.threads.com/@zuck">@zuck</a><span> 這才是使用者貼的那一則，內容要夠長才不會被當成抽取失敗。</span></span></span>
</div></body></html>`

describe('extractThreadsEmbedText', () => {
  it('⚠️ 要拿帶 Full 的那一個，不是第一個——拿錯會安靜地回傳別人的貼文', () => {
    const got = extractThreadsEmbedText(THREADS_EMBED)
    expect(got.text).toContain('這才是使用者貼的那一則')
    expect(got.text).not.toContain('母貼文的內容')
  })

  it('母貼文另外回傳（回覆脫離上文常常等於沒有資訊）', () => {
    expect(extractThreadsEmbedText(THREADS_EMBED).parent).toBe('母貼文的內容，這是被回覆的那一則貼文。')
  })

  it('沒有 Full 時退回最後一個；只有一則時沒有母貼文', () => {
    const single = '<span class="TextContentContainer"><span class="BodyTextContainer"><span>只有一則貼文</span></span></span>'
    expect(extractThreadsEmbedText(single)).toEqual({ text: '只有一則貼文', parent: '' })
  })

  it('完全找不到容器時回空，不拋', () => {
    expect(extractThreadsEmbedText('<html></html>')).toEqual({ text: '', parent: '' })
  })
})

/* ------------------------------------------------------------------ */
/* 短網址解析                                                          */
/* ------------------------------------------------------------------ */

describe('canonicalFromSharePage', () => {
  it('Threads：從 og:url 取正規網址，查詢字串要去掉', () => {
    const html = '<meta property="og:url" content="https://www.threads.com/@seeghost/post/DdV4tL3E2xA?xmt=AQG0iEkMyp&slof=1" />'
    expect(canonicalFromSharePage(html, 'threads'))
      .toBe('https://www.threads.com/@seeghost/post/DdV4tL3E2xA')
  })

  /*
   * ⚠️ FB **不能直接拿 og:url**（2026-09-18 實測）：它給的是
   * `/<ownerId>/posts/<一長串中文 slug>/<storyId>/`，那個形式丟進
   * `plugins/post.php` 會被回「貼文已無法取得」。只有 permalink.php 吃。
   */
  it('FB：從 og:url 挖出兩個數字 id 自己組 permalink.php', () => {
    const html = '<meta property="og:url" content="https://www.facebook.com/100072192611198/posts/%E9%A0%98%E9%A4%8A/979446181138460/" />'
    expect(canonicalFromSharePage(html, 'facebook-post'))
      .toBe('https://www.facebook.com/permalink.php?story_fbid=979446181138460&id=100072192611198')
  })

  it('FB：og:url 缺席時退回頁面裡的 story.php 參數', () => {
    const html = '<a href="/story.php?story_fbid=979446181138460&amp;id=100072192611198&amp;rdid=x">x</a>'
    expect(canonicalFromSharePage(html, 'facebook-post'))
      .toBe('https://www.facebook.com/permalink.php?story_fbid=979446181138460&id=100072192611198')
  })

  it('兩者都挖不到時回 null（呼叫端會退回摘要，不是硬湊一個錯網址）', () => {
    expect(canonicalFromSharePage('<html></html>', 'threads')).toBeNull()
    expect(canonicalFromSharePage('<html></html>', 'facebook-post')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* 端到端（mock HttpAdapter）                                          */
/* ------------------------------------------------------------------ */

function htmlRes(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function makeHttp(routes: Array<[RegExp, () => Response]>): { http: HttpAdapter; calls: string[] } {
  const calls: string[] = []
  const http: HttpAdapter = {
    supportsStreaming: false,
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      const hit = routes.find(([re]) => re.test(url))
      if (!hit) return new Response('not found', { status: 404 })
      return hit[1]()
    }) as unknown as typeof globalThis.fetch
  }
  return { http, calls }
}

describe('readSocialPost', () => {
  it('噗浪：主文＋回應串，並標成 social-post（不是摘要）', async () => {
    const { http } = makeHttp([
      [/plurk\.com\/p\//, () => htmlRes(PLURK_PAGE)],
      [/Responses\/get/, () => new Response(
        JSON.stringify({ responses: [{ id: 1, user_id: 42, content_raw: '推', qualifier: ':' }], users: { 42: { display_name: '小明' } } }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )]
    ])
    const out = await readSocialPost(http, parseSocialLink('https://www.plurk.com/p/3j60ce8oo1')!)
    expect(out.status).toBe('ok')
    expect(out.sourceKind).toBe('social-post')
    expect(out.text).toContain('ಠ_ಠ 偷偷說：')
    expect(out.text).toContain('收容所開放認養')
    expect(out.text).toContain('- 小明：推')
  })

  it('噗浪：回應端點壞掉時主文照樣要回得出來（非官方端點，不能拖累主文）', async () => {
    const { http } = makeHttp([
      [/plurk\.com\/p\//, () => htmlRes(PLURK_PAGE)],
      [/Responses\/get/, () => new Response('boom', { status: 500 })]
    ])
    const out = await readSocialPost(http, parseSocialLink('https://www.plurk.com/p/3j60ce8oo1')!)
    expect(out.status).toBe('ok')
    expect(out.text).toContain('收容所開放認養')
    expect(out.text).not.toContain('回應（')
  })

  it('FB 粉專貼文：走官方嵌入拿全文', async () => {
    const { http, calls } = makeHttp([[/plugins\/post\.php/, () => htmlRes(FB_EMBED)]])
    const out = await readSocialPost(http, parseSocialLink('https://www.facebook.com/page/posts/pfbid1')!)
    expect(calls[0]).toContain('plugins/post.php')
    expect(out.sourceKind).toBe('social-post')
    expect(out.text).toContain('被「查看更多」摺起來的第三段')
  })

  it('FB 粉專貼文：嵌入被拒時退回 og 摘要，並標成 social-excerpt', async () => {
    const { http } = makeHttp([
      [/plugins\/post\.php/, () => htmlRes('<html><body>貼文已無法取得</body></html>')],
      [/facebook\.com\/page\/posts/, () => htmlRes(
        ogOnlyPage('這是開頭預覽的內容，後面還有看不到的部分，所以只能算摘要...')
      )]
    ])
    const out = await readSocialPost(http, parseSocialLink('https://www.facebook.com/page/posts/pfbid1')!)
    expect(out.sourceKind).toBe('social-excerpt')
    expect(out.text).toContain('這是開頭預覽的內容')
  })

  it('FB 社團貼文：連嵌入都不試（社團不支援），直接拿 og 摘要', async () => {
    const { http, calls } = makeHttp([[/groups/, () => htmlRes(
      ogOnlyPage('社團貼文的開頭內容在這裡，剩下的要登入才看得到，所以拿不到全文...')
    )]])
    const out = await readSocialPost(http, parseSocialLink('https://www.facebook.com/groups/g/posts/1/')!)
    expect(calls.some(c => c.includes('plugins/post.php'))).toBe(false)
    expect(out.sourceKind).toBe('social-excerpt')
  })

  it('Threads：拿帶 Full 的那一則，母貼文當作前情提要附上', async () => {
    const { http } = makeHttp([[/\/embed/, () => htmlRes(THREADS_EMBED)]])
    const out = await readSocialPost(http, parseSocialLink('https://www.threads.com/@a/post/XYZ')!)
    expect(out.sourceKind).toBe('social-post')
    expect(out.text).toContain('這才是使用者貼的那一則')
    expect(out.text).toContain('這則是回覆')
  })

  it('抓取失敗回 fetch-failed，不拋', async () => {
    const { http } = makeHttp([])
    const out = await readSocialPost(http, parseSocialLink('https://www.plurk.com/p/3j60ce8oo1')!)
    expect(out.status).toBe('fetch-failed')
  })
})

/* ------------------------------------------------------------------ */
/* 接進 reader                                                         */
/* ------------------------------------------------------------------ */

describe('readOneLink 的社群分流', () => {
  const settings = makeSettings()

  it('社群貼文要在 js-rendered 判定之前被攔下來', async () => {
    const { http } = makeHttp([[/\/embed/, () => htmlRes(THREADS_EMBED)]])
    const out = await readOneLink({ http } as never, 'https://www.threads.com/@a/post/XYZ', settings)
    expect(out.status).toBe('ok')
  })

  it('社群站的非貼文網址照樣落回 js-rendered', async () => {
    const { http } = makeHttp([])
    const out = await readOneLink({ http } as never, 'https://www.threads.com/@a', settings)
    expect(out.status).toBe('js-rendered')
  })
})
