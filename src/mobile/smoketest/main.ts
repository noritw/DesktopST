/**
 * 手機殼試打（B3 前置）。
 *
 * 這不是產品程式碼，是**一次性的能力探針**。目的是在寫四到八週手機 UI 之前，
 * 先確認 Capacitor 殼跑得起來，並回答 `pre-b3-work-assessment.md` §8 留下的兩個未知數：
 *
 *   1. `rss-parser` 能不能在 WebView 裡跑（它依賴 xml2js）
 *   2. Gemini 靠 Capacitor 的全域 fetch patch 繞過 CORS 到底成不成立
 *      （`@google/generative-ai` v0.21 沒有 fetch 注入選項，只能走全域 fetch，
 *       見 `core/llm/deps.ts`）
 *
 * 兩題都只有真機能給答案，模擬器與桌面瀏覽器都不算數。
 */

/**
 * ⚠️ **不能 `import Parser from 'rss-parser'`。**
 * 它的預設進入點（`lib/parser.js`）直接 require Node 的 `http`／`https`／`url`／
 * `events`／`timers`，bundle 給瀏覽器會五個錯誤全開。
 *
 * 但套件本身附了一份**預先打包的瀏覽器版** `dist/rss-parser.min.js`（UMD，
 * 掛在 `window.RSSParser`）。這裡用 `<script>` 載入那一份，
 * 所以下面才是讀全域變數而不是 import。
 */
declare const RSSParser: new () => {
  parseString(xml: string): Promise<{ title?: string; items: { title?: string }[] }>
}

// ── 結果面板 ───────────────────────────────────────────────

type Status = 'pass' | 'fail'
const results = document.getElementById('results')!
const summaryEl = document.getElementById('summary')!
let passed = 0
let failed = 0

function report(name: string, status: Status, detail: string): void {
  if (status === 'pass') passed++; else failed++
  const card = document.createElement('div')
  card.className = 'card'
  card.innerHTML = `
    <div class="row">
      <span class="badge ${status}">${status === 'pass' ? '✓' : '✕'}</span>
      <span class="name"></span>
    </div>
    <p class="detail"></p>`
  card.querySelector('.name')!.textContent = name
  card.querySelector('.detail')!.textContent = detail
  results.appendChild(card)
  summaryEl.textContent = `通過 ${passed}．失敗 ${failed}`
  summaryEl.style.background = failed ? '#FFE8AA' : '#CBFBC4'
}

async function check(name: string, fn: () => Promise<string> | string): Promise<void> {
  try {
    report(name, 'pass', await fn())
  } catch (e) {
    report(name, 'fail', e instanceof Error ? `${e.name}: ${e.message}` : String(e))
  }
}

// ── 探針 ──────────────────────────────────────────────────

/** 真的會用到的來源之一：Google News 台灣。跨網域且沒有 CORS 標頭，正是要驗的情況。 */
const RSS_URL = 'https://news.google.com/rss?hl=zh-TW&gl=TW&ceid=TW:zh-Hant'

async function run(): Promise<void> {
  await check('WebView 版本', () => {
    const m = navigator.userAgent.match(/Chrome\/([\d.]+)/)
    if (!m) throw new Error(`認不出 Chromium 版本：${navigator.userAgent}`)
    return `Chromium ${m[1]}\n${navigator.userAgent}`
  })

  await check('Capacitor bridge 載入', () => {
    const cap = (window as unknown as { Capacitor?: { getPlatform(): string; isNativePlatform(): boolean } }).Capacitor
    if (!cap) throw new Error('window.Capacitor 不存在 —— 這頁不是跑在原生殼裡')
    return `platform = ${cap.getPlatform()}\nisNative = ${cap.isNativePlatform()}`
  })

  await check('CapacitorHttp 有沒有接管全域 fetch', () => {
    // 原生 patch 會把 window.fetch 換成自己的實作，toString() 就不再是 native code。
    const src = window.fetch.toString()
    const patched = !/\[native code\]/.test(src)
    if (!patched) {
      throw new Error(
        'fetch 仍是瀏覽器原生實作 —— 沒有被接管。\n' +
        '代表跨網域請求會照 CORS 規則走，Gemini 那條路不成立。\n' + src.slice(0, 200)
      )
    }
    return `已被接管（非 native code）\n${src.slice(0, 200)}`
  })

  let rssText = ''
  await check('跨網域抓 RSS（CORS 的真正考驗）', async () => {
    const res = await fetch(RSS_URL)
    rssText = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    if (!rssText.trim()) throw new Error('回應是空的')
    return `HTTP ${res.status}．${rssText.length} 字元\n開頭：${rssText.slice(0, 120)}`
  })

  await check('rss-parser 解析（用 dist 的瀏覽器版）', async () => {
    if (!rssText) throw new Error('上一項沒抓到內容，無法解析')
    if (typeof RSSParser === 'undefined') throw new Error('window.RSSParser 不存在 —— dist bundle 沒載入')
    const parser = new RSSParser()
    const feed = await parser.parseString(rssText)
    const n = feed.items?.length ?? 0
    if (n === 0) throw new Error('解析成功但沒有任何項目')
    return `${n} 則．來源「${feed.title ?? '(無標題)'}」\n第一則：${feed.items[0].title ?? '(無)'}`
  })

  await check('DOMParser 解析同一份（rss-parser 不行時的備案）', () => {
    if (!rssText) throw new Error('上一項沒抓到內容，無法解析')
    const doc = new DOMParser().parseFromString(rssText, 'application/xml')
    if (doc.querySelector('parsererror')) throw new Error('XML 解析錯誤')
    const items = doc.querySelectorAll('item')
    if (items.length === 0) throw new Error('解析成功但沒有 item')
    return `${items.length} 則\n第一則：${items[0].querySelector('title')?.textContent ?? '(無)'}`
  })

  await check('Gemini endpoint 可達性（不帶金鑰）', async () => {
    // 刻意不帶金鑰：能收到 HTTP 錯誤碼就代表請求真的送出去了，沒被 CORS 擋掉。
    // 被 CORS 擋的話會是 TypeError，連狀態碼都拿不到 —— 兩者要分清楚。
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    )
    const body = (await res.text()).slice(0, 200)
    if (res.status === 0) throw new Error('狀態碼 0 —— 通常代表被 CORS 擋掉')
    return `HTTP ${res.status}（預期 400/403，代表請求有送到 Google）\n${body}`
  })

  summaryEl.textContent = failed === 0
    ? `全部通過（${passed} 項）`
    : `通過 ${passed}．失敗 ${failed} —— 看下方紅色項目`
}

void run()
