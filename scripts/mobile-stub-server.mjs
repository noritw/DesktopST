/**
 * 假的 mobileServer —— 開發手機 UI 時的替身。
 *
 * 用法與設計理由見 `scripts/README-mobile-stub.md`。**這是開發工具，不會被打包。**
 *
 * ## 一句話
 *
 * 讓 `npm run dev:mobile` 在**沒開 DeST**的情況下也有東西可以接，
 * 而且每一則請求都印在終端 —— 手機上按了什麼、送出去什麼，看得一清二楚。
 *
 * ## 一條規矩（吃過虧才寫下來的）
 *
 * ⚠️ **要連「拒絕條件」一起模擬，不是只回成功。**
 *
 * 2026-08-05：`/api/messages/resend` 在真的 DeST 上只接受**使用者訊息**
 * （`ipcHandlers.ts:639`），但這支 stub 原本照單全收 ——
 * 於是手機 UI 對角色訊息也顯示了「重新發送」，而那顆按鈕在真機上必定失敗。
 * owner 實測回報後才追出來。
 *
 * 同理，`/api/characters/desktop/remove` 用 **HTTP 200 ＋ `ok: false`**
 * 表示「至少要留一個角色」，不是錯誤狀態碼。
 *
 * **新增端點時，先去讀 `mobileServer.ts` 對應那段的失敗分支，一併照抄。**
 * 只模擬成功路徑的 stub 會安靜地掩蓋掉真實限制，比沒有 stub 更糟。
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 5999)

// ── 假資料 ──────────────────────────────────────────────────

/**
 * 角色庫。**存的是完整角色卡**（階段 3 的編輯器要讀 `/api/characters/card/:id`），
 * 不是只有 id 與名字。
 */
const library = [
  {
    id: 'c1', name: '小綠', nicknames: ['綠綠'], avatar: 'stub://c1',
    description: '一隻薄荷色的桌面寵物。', personality: '好奇、話多',
    firstMessage: '嗨！', exampleDialogue: '', emotions: {},
    scenario: '', creatorNotes: '', systemPromptOverride: '',
    newsKeywords: ['貓咪'], lorebookIds: ['b1'],
    createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'c2', name: '小藍', nicknames: [], avatar: 'stub://c2',
    description: '', personality: '冷靜', firstMessage: '', exampleDialogue: '',
    emotions: {}, scenario: '', creatorNotes: '', systemPromptOverride: '',
    newsKeywords: [], lorebookIds: [], createdAt: Date.now(), updatedAt: Date.now()
  },
  {
    id: 'c3', name: '小黃', nicknames: [], avatar: '',
    description: '', personality: '', firstMessage: '', exampleDialogue: '',
    emotions: {}, scenario: '', creatorNotes: '', systemPromptOverride: '',
    newsKeywords: [], lorebookIds: [], createdAt: Date.now(), updatedAt: Date.now()
  }
]

// 完整資料（B3 階段 9）；`/api/lorebooks` 清單只回 {id, name} 摘要，照抄預設組的界線。
let lorebooks = [
  {
    id: 'b1', name: '桌寵世界用語',
    entries: [
      { id: 'e1', keys: ['DeST', '桌友'], content: 'DeST 是使用者開發的桌面程式，暱稱「桌友」。', enabled: true, constant: true, insertion_order: 0 }
    ],
    scan_depth: 0, token_budget: 2000, createdAt: Date.now(), updatedAt: Date.now()
  },
  { id: 'b2', name: 'TRPG 名詞', entries: [], scan_depth: 0, token_budget: 2000, createdAt: Date.now(), updatedAt: Date.now() }
]

/** 角色 id → 手機上傳的主圖 data URI。`/api/avatar/:id` 優先回這個。 */
const uploadedAvatars = new Map()
let presentIds = ['c1', 'c2']
const muted = new Set()

// ── 對話（B3 階段 8）───────────────────────────────────────────
// `messages` 一律指向「目前使用中那個對話」的訊息陣列本身（同一個物件參照，
// 不是複製），送出/刪除/編輯訊息時各處對 `messages` 的 push/splice 才會直接
// 生效在正確的那個對話上。切換/新增/刪除對話時只重新指派這個變數，
// 陣列內容不動——照抄真 `mobileServer.ts` 用同一份 `Conversation` 物件的邏輯。
let messages = [
  {
    id: 'm1',
    role: 'character',
    characterId: 'c1',
    content: '嗨，試試看傳張照片或擲個骰子給我看看？',
    timestamp: Date.now() - 60_000
  }
]
let activeConversationId = 'conv1'
const conversations = [{ id: 'conv1', title: '測試', messages, updatedAt: Date.now() }]

/** messageId → data URI 陣列。`/api/message-image` 從這裡取。 */
const images = new Map()

// ── 設定 ＋ 提醒（B3 階段 4）─────────────────────────────────

// `LANDIRECT=0` 用來驗「API Key 欄位隱藏、寫入回 409」那條路徑
// （真伺服器裡 loopback 一律不算區網直連，stub 直接用環境變數代替）。
const LAN_DIRECT = process.env.LANDIRECT !== '0'

const llmSettings = {
  provider: 'openai',
  models: { openai: 'gpt-5.4-mini', claude: 'claude-sonnet-5', gemini: 'gemini-3.5-flash', grok: 'grok-4.5' },
  endpoint: '',
  apiKeys: { openai: '', claude: '', gemini: '', grok: '' }
}
const PROVIDERS = ['openai', 'claude', 'gemini', 'grok']

const memorySettings = { keepRecentN: 20, autoSummarizeAfter: 50, autoSummarizeEnabled: true }

const moduleToggles = [
  { id: 'desktopst.weather', label: '天氣', enabled: false },
  { id: 'desktopst.spotify', label: 'Spotify 音樂偵測', enabled: false },
  { id: 'desktopst.calendar', label: 'Google 日曆', enabled: false },
  { id: 'desktopst.news', label: '新聞陪聊', enabled: true }
]

// ── 個人新聞報（B3 階段 6）─────────────────────────────────────
//
// ⚠️ 拒絕條件照抄 `src/main/modules/news/{readerFetch,mobileRoutes}.ts`：
//   · 模組沒開 → **HTTP 200 ＋ `{ ok:false, error }`**（不是錯誤狀態碼）
//   · 熱門欄關閉、找不到關鍵字來源 → 同上
//   · quota 少了 sectionGroupId、order 的清單對不起來 → 400
// 只回成功的 stub 會讓「模組沒開」的提示與錯誤重試整條路徑驗不到。

let newsSources = [
  { id: 'kw-indie', type: 'keyword', label: '獨立遊戲', weight: 'often', enabled: true, origin: 'user', groupId: 'default' },
  { id: 'kw-ai', type: 'keyword', label: 'AI', weight: 'normal', enabled: true, origin: 'user', groupId: 'default' },
  { id: 'kw-cat', type: 'keyword', label: '貓咪', weight: 'normal', enabled: true, origin: 'user', groupId: 'g-life', readerQuota: 2 },
  { id: 'rss-ithome', type: 'rss', label: 'iThome', url: 'https://example.com/ithome.xml', weight: 'normal', enabled: true, origin: 'user' },
  { id: 'loc-台北市', type: 'keyword', label: '台北市', weight: 'normal', enabled: true, origin: 'location' }
]
let newsKeywordGroups = [
  { id: 'default', name: '預設組' },
  { id: 'g-life', name: '生活' }
]
let newsBlacklist = ['詐騙']
let newsReaderGroupIds = []
let newsPerKeyword = 3
let newsBreakoutQuota = 3
const newsBreakoutEnabled = true
/** 釘選／不看了是**電腦端共用**的內容狀態（規劃書 §3 方案 B） */
let newsPinned = []
let newsDismissed = []
let newsSchedule = { enabled: false }

let newsSeq = 0
const newsEnabled = () => moduleToggles.find((m) => m.id === 'desktopst.news')?.enabled !== false

/** 產生一則假新聞。每次呼叫 id 都不同，「換一批」才看得出真的換了。 */
const makeNewsItem = (src, breakout = false) => {
  newsSeq += 1
  const ageMinutes = Math.floor(Math.random() * 3000)
  return {
    id: `n${newsSeq}`,
    title: breakout ? `熱門：大家都在看的第 ${newsSeq} 件事` : `${src.label}：假新聞標題 ${newsSeq}`,
    summary: `這是「${src.label}」的假摘要，用來驗證顯示模式與版面。編號 ${newsSeq}。`,
    source: breakout ? '熱門話題' : src.label + ' 日報',
    tags: [],
    url: `https://example.com/news/${newsSeq}`,
    publishedAt: new Date(Date.now() - ageMinutes * 60000).toISOString(),
    sourceId: breakout ? 'breakout' : src.id,
    sourceType: src.type,
    sourceWeight: src.weight,
    ...(breakout ? { breakout: true } : {}),
    ...(src.type === 'keyword' ? { keyword: src.label } : {})
  }
}

const newsQuotaOf = (src) =>
  typeof src.readerQuota === 'number' && src.readerQuota >= 1 ? src.readerQuota : newsPerKeyword

/** 有在抓的關鍵字來源：跟著「要抓哪些組」走（與真伺服器的 readerSelectionContext 同義） */
const newsActiveSources = () =>
  newsSources.filter((s) => {
    if (!s.enabled) return false
    if (s.type !== 'keyword') return true
    if (s.origin === 'location') return true
    if (newsReaderGroupIds.length === 0) return true
    return newsReaderGroupIds.includes(s.groupId || 'default')
  })

const newsBatchItems = (excludeIds) => {
  const skip = new Set(excludeIds || [])
  const out = []
  if (newsBreakoutEnabled) {
    for (let i = 0; i < newsBreakoutQuota; i++) {
      out.push(makeNewsItem({ id: 'breakout', label: '熱門', type: 'keyword', weight: 'normal' }, true))
    }
  }
  for (const src of newsActiveSources()) {
    const n = src.type === 'keyword' ? newsQuotaOf(src) : newsPerKeyword
    for (let i = 0; i < n; i++) out.push(makeNewsItem(src))
  }
  // 黑名單與 dismiss 在真伺服器是抓取端就濾掉的
  return out.filter(
    (it) => !skip.has(it.id) && !newsDismissed.includes(it.id) && !newsBlacklist.some((w) => it.title.includes(w))
  )
}

const newsSnapshot = () => ({
  sources: newsSources,
  keywordGroups: newsKeywordGroups,
  readerKeywordGroupIds: newsReaderGroupIds,
  readerMaxItems: 30,
  readerPerKeyword: newsPerKeyword,
  readerBreakoutQuota: newsBreakoutQuota
})

/** 單欄重抓：照抄 readerFetch 的分支與錯誤訊息 */
const newsSectionItems = (sectionGroupId) => {
  if (sectionGroupId === '__breakout__') {
    if (!newsBreakoutEnabled) return { ok: false, error: '熱門話題未啟用' }
    const items = []
    for (let i = 0; i < newsBreakoutQuota; i++) {
      items.push(makeNewsItem({ id: 'breakout', label: '熱門', type: 'keyword', weight: 'normal' }, true))
    }
    return { ok: true, items }
  }
  if (sectionGroupId === '__local__') {
    const locs = newsSources.filter((s) => s.origin === 'location' && s.enabled)
    if (locs.length === 0) return { ok: false, error: '地方新聞未啟用' }
    return { ok: true, items: locs.flatMap((src) => [makeNewsItem(src), makeNewsItem(src)]) }
  }
  if (sectionGroupId.startsWith('kw:')) {
    const src = newsSources.find((s) => s.id === sectionGroupId.slice(3) && s.type === 'keyword')
    if (!src || !src.enabled) return { ok: false, error: '找不到此關鍵字來源' }
    return { ok: true, items: Array.from({ length: newsQuotaOf(src) }, () => makeNewsItem(src)) }
  }
  if (sectionGroupId.startsWith('feed:')) {
    const src = newsSources.find((s) => s.id === sectionGroupId.slice(5) && (s.type === 'rss' || s.type === 'json'))
    if (!src || !src.enabled) return { ok: false, error: '找不到此訂閱來源' }
    return { ok: true, items: Array.from({ length: newsPerKeyword }, () => makeNewsItem(src)) }
  }
  return { ok: false, error: '不支援的欄位類型' }
}

/** 新增來源時 id 由伺服器產生（手機端非安全內容沒有 crypto.randomUUID） */
const normalizeNewsSources = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((s) => s && typeof s.label === 'string' && s.label)
    .map((s) => ({
      ...s,
      id: typeof s.id === 'string' && s.id ? s.id : 'src-' + Math.random().toString(36).slice(2, 10),
      type: s.type === 'rss' || s.type === 'json' ? s.type : 'keyword',
      weight: ['often', 'normal', 'rarely'].includes(s.weight) ? s.weight : 'normal',
      enabled: s.enabled !== false
    }))

// ── 預設組（B3 階段 5）───────────────────────────────────────
// 完整資料與清單摘要分開，照抄真 mobileServer 的界線。
let personas = [{ id: 'p1', name: '預設使用者', displayName: '小諾', nickname: '諾諾', description: '喜歡和角色聊天。', createdAt: Date.now(), updatedAt: Date.now() }]
let worlds = [{ id: 'w1', name: '預設世界觀', worldSetting: '現代台灣。', interactionExample: '', lorebookIds: ['b1'], createdAt: Date.now(), updatedAt: Date.now() }]
let scenes = [{ id: 's1', name: '日常', activePersonaId: 'p1', activeWorldId: 'w1', desktopCharacters: [], lorebookIds: [], moduleOverrides: {}, createdAt: Date.now(), updatedAt: Date.now() }]
let activePersonaId = 'p1'
let activeWorldId = 'w1'
let activeSceneId = 's1'

let reminders = [
  {
    id: 'r1',
    label: '早安問候',
    prompt: '',
    schedule: { type: 'daily', hour: 8, minute: 0 },
    enabled: true,
    createdAt: Date.now()
  }
]

const state = () => ({
  desktopCharacters: presentIds.map((id) => ({
    id,
    name: library.find((c) => c.id === id).name,
    muted: muted.has(id)
  })),
  conversation: { id: activeConversationId, title: conversations.find((c) => c.id === activeConversationId)?.title ?? '對話', messages },
  colorTheme: process.env.THEME || 'mint',
  // NR=0 用來驗「隨機工具總開關關閉時 🎲 入口整個消失」（清單 C6）
  randomToolsEnabled: process.env.NR !== '0',
  maxImages: Number(process.env.MAXIMG || 5)
  ,activeSceneId, activePersonaId, activeWorldId
})

// ── 基礎設施 ────────────────────────────────────────────────

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*'
}

const clients = new Set()
const push = (obj) => {
  const s = JSON.stringify(obj)
  for (const c of clients) {
    try {
      c.send(s)
    } catch {
      /* 連線剛斷，下一輪就會被清掉 */
    }
  }
}

const json = (res, payload, status = 200) => {
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        resolve({})
      }
    })
  })

/** 假回覆：思考 → 角色訊息。真的 LLM 不在這裡，只驗 UI 的流程。 */
const fakeReply = (characterId, content, delay = 1200) => {
  push({ type: 'thinking', characterId })
  setTimeout(() => {
    const reply = {
      id: 'rep-' + Date.now(),
      role: 'character',
      characterId,
      content,
      timestamp: Date.now()
    }
    messages.push(reply)
    push({ type: 'thinking-done', characterId })
    push({ type: 'message', message: reply })
  }, delay)
}

// ── 路由 ────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
  const url = req.url

  // 訊息裡的圖片（送出時存下來的那份原圖）
  const imgMatch = url.match(/^\/api\/message-image\/([^/]+)\/(\d+)/)
  if (imgMatch) {
    const uri = images.get(decodeURIComponent(imgMatch[1]))?.[Number(imgMatch[2])]
    if (!uri) return res.writeHead(404, cors).end()
    const buf = Buffer.from(uri.split(',')[1], 'base64')
    res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg', 'Content-Length': buf.length })
    return res.end(buf)
  }

  // 頭像：用角色 id 產一張純色方圖，看得出誰是誰就夠了。
  // 未知 id 回 404 —— 那條路徑要驗的是 🐾 fallback（清單 D6）。
  if (url.startsWith('/api/avatar/')) {
    const id = decodeURIComponent(url.split('/').pop().split('?')[0])
    const uploaded = uploadedAvatars.get(id)
    if (uploaded) {
      const buf = Buffer.from(uploaded.split(',')[1], 'base64')
      res.writeHead(200, { ...cors, 'Content-Type': 'image/jpeg', 'Content-Length': buf.length })
      return res.end(buf)
    }
    // ⚠️ 真伺服器在角色卡的 `avatar` 是空的時候回 **404**（`mobileServer.ts`：
    // `if (!char?.avatar)`）。這裡照抄，否則「沒設主圖」的角色在 stub 上看起來
    // 永遠有圖，🐾 fallback（清單 D6）與編輯器的破圖處理就驗不到。
    const card = library.find((c) => c.id === id)
    if (card && !card.avatar) return res.writeHead(404, cors).end()
    const color = { c1: '#CBFBC4', c2: '#AAEEFF', c3: '#FFE8AA' }[id]
    if (!color) return res.writeHead(404, cors).end()
    res.writeHead(200, { ...cors, 'Content-Type': 'image/svg+xml' })
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
        `<rect width="96" height="96" fill="${color}"/>` +
        `<text x="48" y="62" font-size="40" text-anchor="middle" fill="#3D5A52">${id.slice(1)}</text></svg>`
    )
  }

  // 測試用觸發器：從瀏覽器或 curl 打一下就推一則提醒（G7 的 toast 路徑）。
  // 真伺服器是排程到點才推，桌機上沒辦法乾等，所以 stub 給一個手動入口。
  if (url.startsWith('/api/test/reminder')) {
    const content = new URL(url, 'http://x').searchParams.get('content') || '該喝水了'
    push({ type: 'reminder', content })
    console.log(`[test] 推送提醒：${content}`)
    return json(res, { ok: true, content })
  }

  if (url.startsWith('/api/state')) return json(res, state())

  if (url.startsWith('/api/characters/library')) {
    return json(res, {
      characters: library.map((c) => ({ id: c.id, name: c.name, onDesktop: presentIds.includes(c.id) }))
    })
  }

  if (url.startsWith('/api/send')) {
    const p = await readBody(req)
    const imgs = p.images || []
    const kb = imgs.map((i) => Math.round((i.length * 3) / 4 / 1024) + 'KB').join(',')
    console.log(
      `[send] "${p.content}" 圖:${imgs.length}${kb ? ` (${kb})` : ''}` +
        ` skipLlm:${!!p.skipLlm} random:${JSON.stringify(p.randomResults) || '-'}`
    )

    const id = 'real-' + Date.now()
    const msg = {
      id,
      role: 'user',
      content: p.content,
      timestamp: Date.now(),
      imageCount: imgs.length || undefined,
      randomResults: p.randomResults
    }
    if (imgs.length) images.set(id, imgs)
    messages.push(msg)
    push({ type: 'message', message: msg })
    json(res, { ok: true })

    // 清單 A7：skipLlm 時角色不回話
    if (!p.skipLlm) {
      fakeReply(presentIds[0] || 'c1', imgs.length ? `收到 ${imgs.length} 張圖囉！` : `你說：「${p.content}」`)
    }
    return
  }

  // 摘要清單。**必須用精確比對**，不能用 startsWith，否則會連下面幾支
  // /api/lorebooks/:id、/create、/save、/delete 一起吃掉（都是同一個字首）。
  if (url === '/api/lorebooks') return json(res, { lorebooks: lorebooks.map((b) => ({ id: b.id, name: b.name })) })

  // 完整讀寫（B3 階段 9）
  const lorebookGetMatch = url.match(/^\/api\/lorebooks\/([^/?]+)$/)
  if (req.method === 'GET' && lorebookGetMatch) {
    const book = lorebooks.find((b) => b.id === decodeURIComponent(lorebookGetMatch[1]))
    if (!book) return json(res, { error: '找不到這本用語解說' }, 404)
    return json(res, { book })
  }

  if (url === '/api/lorebooks/create') {
    const p = await readBody(req)
    const now = Date.now()
    const book = { id: 'b' + now, name: (p.name || '').trim() || '用語解說', entries: [], scan_depth: 0, token_budget: 2000, createdAt: now, updatedAt: now }
    lorebooks.push(book)
    console.log(`[lorebooks] create -> ${book.name}`)
    return json(res, { book })
  }

  if (url === '/api/lorebooks/save') {
    const p = await readBody(req)
    // 拒絕條件：缺 id 或 id 不存在——不能只模擬成功路徑（scripts/README-mobile-stub.md）。
    if (!p.book || !p.book.id) return json(res, { error: 'book required' }, 400)
    const idx = lorebooks.findIndex((b) => b.id === p.book.id)
    if (idx === -1) return json(res, { error: 'Lorebook not found' }, 404)
    const book = { ...p.book, updatedAt: Date.now() }
    lorebooks[idx] = book
    console.log(`[lorebooks] save -> ${book.name}（${book.entries.length} 條）`)
    return json(res, { book })
  }

  if (url === '/api/lorebooks/delete') {
    const p = await readBody(req)
    if (!p.id) return json(res, { error: 'id required' }, 400)
    lorebooks = lorebooks.filter((b) => b.id !== p.id)
    console.log(`[lorebooks] delete -> ${p.id}`)
    return json(res, { ok: true })
  }

  // ── 連線資訊 ＋ 設定 ＋ 提醒（B3 階段 4）─────────────────

  if (url.startsWith('/api/connection-info')) return json(res, { lanDirect: LAN_DIRECT })

  if (url.startsWith('/api/settings/llm-provider')) {
    const p = await readBody(req)
    if (!PROVIDERS.includes(p.provider)) return json(res, { error: '不支援的供應商' }, 400)
    llmSettings.provider = p.provider
    console.log(`[settings] provider -> ${p.provider}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/settings/llm-model')) {
    const p = await readBody(req)
    if (!PROVIDERS.includes(p.provider)) return json(res, { error: '不支援的供應商' }, 400)
    if (!String(p.model || '').trim()) return json(res, { error: '模型名稱不可空白' }, 400)
    llmSettings.models[p.provider] = p.model.trim()
    console.log(`[settings] model[${p.provider}] -> ${p.model}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/settings/llm-endpoint')) {
    const p = await readBody(req)
    llmSettings.endpoint = String(p.endpoint || '').trim() || undefined
    console.log(`[settings] endpoint -> ${llmSettings.endpoint || '(空)'}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/settings/llm-apikey')) {
    const p = await readBody(req)
    // ⚠️ 照抄真伺服器：非區網直連一律拒絕（409），不是假裝存了。
    if (!LAN_DIRECT) return json(res, { error: 'API key can only be set over a direct LAN connection' }, 409)
    if (!PROVIDERS.includes(p.provider)) return json(res, { error: '不支援的供應商' }, 400)
    llmSettings.apiKeys[p.provider] = p.apiKey || ''
    console.log(`[settings] apiKey[${p.provider}] set (${(p.apiKey || '').length} chars)`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/settings/llm')) {
    const hasApiKey = {}
    for (const pr of PROVIDERS) hasApiKey[pr] = !!llmSettings.apiKeys[pr]?.trim()
    return json(res, {
      llm: {
        provider: llmSettings.provider,
        model: llmSettings.models[llmSettings.provider],
        models: llmSettings.models,
        endpoint: llmSettings.endpoint,
        hasApiKey
      }
    })
  }

  if (url.startsWith('/api/settings/memory')) {
    if (req.method === 'GET') return json(res, { memory: memorySettings })
    const p = await readBody(req)
    const keepRecentN = Math.round(Number(p.keepRecentN))
    const autoSummarizeAfter = Math.round(Number(p.autoSummarizeAfter))
    // 照抄真伺服器的範圍檢查（`setMemorySettingsDirect`）
    if (!Number.isFinite(keepRecentN) || keepRecentN < 1 || keepRecentN > 200) {
      return json(res, { error: '「保留最近幾則」超出範圍（1–200）' }, 400)
    }
    if (!Number.isFinite(autoSummarizeAfter) || autoSummarizeAfter < 1 || autoSummarizeAfter > 500) {
      return json(res, { error: '「自動摘要門檻」超出範圍（1–500）' }, 400)
    }
    Object.assign(memorySettings, { keepRecentN, autoSummarizeAfter, autoSummarizeEnabled: !!p.autoSummarizeEnabled })
    console.log('[settings] memory ->', JSON.stringify(memorySettings))
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/settings/modules/toggle')) {
    const p = await readBody(req)
    const m = moduleToggles.find((x) => x.id === p.id)
    if (!m) return json(res, { error: '未知的模組' }, 400)
    m.enabled = !!p.enabled
    console.log(`[settings] module ${p.id} -> ${m.enabled}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/settings/modules')) return json(res, { modules: moduleToggles })

  if (url === '/api/presets' && req.method === 'GET') return json(res, {
    personas: personas.map(({ id, name, displayName, nickname }) => ({ id, name, displayName, nickname })),
    worlds: worlds.map(({ id, name, worldSetting }) => ({ id, name, worldSetting: worldSetting.slice(0, 100) })),
    activePersonaId, activeWorldId
  })
  if (url === '/api/scenes' && req.method === 'GET') return json(res, { scenes: scenes.map(({ id, name }) => ({ id, name })) })
  if (url === '/api/presets/activate-persona') {
    const p = await readBody(req)
    if (!personas.some(x => x.id === p.id)) return json(res, { error: 'Preset not found' }, 400)
    activePersonaId = p.id; console.log(`[presets] activate persona ${p.id}`); return json(res, { ok: true })
  }
  if (url === '/api/presets/activate-world') {
    const p = await readBody(req)
    if (!worlds.some(x => x.id === p.id)) return json(res, { error: 'Preset not found' }, 400)
    activeWorldId = p.id; console.log(`[presets] activate world ${p.id}`); return json(res, { ok: true })
  }
  if (url === '/api/scenes/apply') {
    const p = await readBody(req)
    if (!scenes.some(x => x.id === p.id)) return json(res, { error: 'Preset not found' }, 400)
    activeSceneId = p.id; console.log(`[presets] apply scene ${p.id}`); return json(res, { ok: true })
  }
  const presetMatch = url.match(/^\/api\/presets\/(persona|world|scene)\/(.+)$/)
  if (presetMatch) {
    const [, kind, action] = presetMatch
    const p = req.method === 'GET' ? null : await readBody(req)
    let list = kind === 'persona' ? personas : kind === 'world' ? worlds : scenes
    if (req.method === 'GET') {
      const found = list.find(x => x.id === decodeURIComponent(action))
      return found ? json(res, { preset: found }) : json(res, { error: 'Preset not found' }, 404)
    }
    if (action === 'save') {
      if (!p.preset || typeof p.preset !== 'object') return json(res, { error: 'preset required' }, 400)
      const incoming = p.preset
      if (!String(incoming.name || '').trim()) return json(res, { error: 'Preset name required' }, 400)
      const id = incoming.id || `${kind}-${Date.now()}`
      const existing = list.findIndex(x => x.id === id)
      const saved = { ...incoming, id, createdAt: existing >= 0 ? list[existing].createdAt : Date.now(), updatedAt: Date.now() }
      if (existing >= 0) list[existing] = saved; else list.push(saved)
      if (kind === 'persona') personas = list; else if (kind === 'world') worlds = list; else scenes = list
      console.log(`[presets] save ${kind} ${id}`)
      // 照抄真伺服器：讓其他已連線裝置知道要重抓，不然改名只有動手那台看得到
      // （PersonaIdentity.tsx／CurrentContext.tsx 這種常駐元件才會跟著刷新）。
      push({ type: 'desktop-updated' })
      return json(res, { preset: saved })
    }
    if (action === 'delete') {
      if (!p.id) return json(res, { error: 'id required' }, 400)
      const found = list.findIndex(x => x.id === p.id)
      if (found < 0) return json(res, { error: 'Preset not found' }, 404)
      if ((kind === 'persona' || kind === 'world') && list.length <= 1) return json(res, { error: 'last-preset' }, 409)
      list.splice(found, 1)
      if (kind === 'persona') { personas = list; if (activePersonaId === p.id) activePersonaId = list[0]?.id || '' }
      else if (kind === 'world') { worlds = list; if (activeWorldId === p.id) activeWorldId = list[0]?.id || '' }
      else scenes = list
      console.log(`[presets] delete ${kind} ${p.id}`)
      push({ type: 'desktop-updated' })
      return json(res, { ok: true })
    }
  }

  // ── 對話清單（B3 階段 8）───────────────────────────────────
  if (url === '/api/conversations' && req.method === 'GET') {
    return json(res, {
      conversations: [...conversations]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ id, title, updatedAt }) => ({ id, title, updatedAt, active: id === activeConversationId }))
    })
  }
  if (url === '/api/conversations/load') {
    const p = await readBody(req)
    const conv = conversations.find((c) => c.id === p.id)
    if (!conv) return json(res, { error: 'Conversation not found' }, 404)
    activeConversationId = conv.id
    messages = conv.messages
    console.log(`[conversations] load ${conv.id}`)
    push({ type: 'desktop-updated' }) // 模擬真伺服器換對話後推播，讓手機端知道要重抓 /api/state
    return json(res, { ok: true })
  }
  if (url === '/api/conversations/new') {
    const p = await readBody(req)
    const title = String(p?.title || '').trim() || '新對話'
    const conv = { id: 'conv-' + Date.now(), title, messages: [], updatedAt: Date.now() }
    conversations.push(conv)
    activeConversationId = conv.id
    messages = conv.messages
    console.log(`[conversations] new ${conv.id} "${title}"`)
    return json(res, { conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, active: true } })
  }
  if (url === '/api/conversations/rename') {
    const p = await readBody(req)
    const conv = conversations.find((c) => c.id === p.id)
    if (!conv) return json(res, { error: 'Conversation not found' }, 404)
    conv.title = String(p.title || '').trim() || '新對話'
    conv.updatedAt = Date.now()
    console.log(`[conversations] rename ${conv.id} -> "${conv.title}"`)
    return json(res, { conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, active: conv.id === activeConversationId } })
  }
  if (url === '/api/conversations/delete') {
    const p = await readBody(req)
    const idx = conversations.findIndex((c) => c.id === p.id)
    if (idx < 0) return json(res, { error: 'Conversation not found' }, 404)
    conversations.splice(idx, 1)
    console.log(`[conversations] delete ${p.id}`)
    if (activeConversationId !== p.id) {
      return json(res, { activeConversationId })
    }
    // 刪的是目前使用中的：照真伺服器邏輯，換到別的對話，全刪光了就生一個新的空對話。
    const next = conversations[0] ?? (() => {
      const fresh = { id: 'conv-' + Date.now(), title: '新對話', messages: [], updatedAt: Date.now() }
      conversations.push(fresh)
      return fresh
    })()
    activeConversationId = next.id
    messages = next.messages
    return json(res, { activeConversationId: next.id })
  }

  if (url.startsWith('/api/reminders/create')) {
    const now = new Date()
    const reminder = {
      id: 'rem-' + Date.now(),
      label: '',
      prompt: '',
      schedule: { type: 'daily', hour: now.getHours(), minute: now.getMinutes() },
      enabled: true,
      createdAt: Date.now()
    }
    reminders.push(reminder)
    console.log(`[reminders] create -> ${reminder.id}`)
    return json(res, { reminder })
  }

  if (url.startsWith('/api/reminders/save')) {
    const p = await readBody(req)
    // 照抄真伺服器：沒有 id 回 400（`mobileServer.ts` 的 `/api/reminders/save`）
    if (!p.reminder?.id) return json(res, { error: 'reminder required' }, 400)
    const idx = reminders.findIndex((r) => r.id === p.reminder.id)
    if (idx >= 0) reminders[idx] = p.reminder
    else reminders.push(p.reminder)
    console.log(`[reminders] save ${p.reminder.id} "${p.reminder.label}"`)
    return json(res, { reminder: p.reminder })
  }

  if (url.startsWith('/api/reminders/delete')) {
    const p = await readBody(req)
    if (!p.id) return json(res, { error: 'id required' }, 400)
    reminders = reminders.filter((r) => r.id !== p.id)
    console.log(`[reminders] delete ${p.id}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/reminders/toggle')) {
    const p = await readBody(req)
    if (!p.id) return json(res, { error: 'id required' }, 400)
    const r = reminders.find((x) => x.id === p.id)
    if (r) r.enabled = !!p.enabled
    console.log(`[reminders] toggle ${p.id} -> ${!!p.enabled}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/reminders')) return json(res, { reminders })

  // ── 個人新聞報（B3 階段 6）────────────────────────────────

  if (url === '/api/news/reader/state') {
    return json(res, {
      enabled: newsEnabled(),
      ...newsSnapshot(),
      pinnedItems: newsPinned,
      dismissedIds: newsDismissed
    })
  }

  if (url === '/api/news/reader/batch') {
    const p = await readBody(req)
    if (!newsEnabled()) return json(res, { ok: false, error: '新聞模組尚未啟用' })
    const items = newsBatchItems(p.excludeIds)
    console.log(`[news] batch exclude=${(p.excludeIds || []).length} strict=${!!p.strictExclude} -> ${items.length} 則`)
    return json(res, { ok: true, items, fetchedAt: Date.now(), ...newsSnapshot() })
  }

  if (url === '/api/news/reader/section') {
    const p = await readBody(req)
    if (!newsEnabled()) return json(res, { ok: false, error: '新聞模組尚未啟用' })
    if (!p.sectionGroupId) return json(res, { ok: false, error: '缺少 sectionGroupId' })
    const r = newsSectionItems(p.sectionGroupId)
    console.log(`[news] section ${p.sectionGroupId} ->`, r.ok ? `${r.items.length} 則` : r.error)
    if (!r.ok) return json(res, r)
    const skip = new Set(p.excludeIds || [])
    return json(res, {
      ok: true,
      sectionGroupId: p.sectionGroupId,
      items: r.items.filter((i) => !skip.has(i.id) && !newsDismissed.includes(i.id)),
      fetchedAt: Date.now(),
      ...newsSnapshot()
    })
  }

  if (url === '/api/news/reader/pinned') {
    const p = await readBody(req)
    newsPinned = Array.isArray(p.items) ? p.items : []
    console.log(`[news] 釘選 ${newsPinned.length} 則`)
    return json(res, { pinnedItems: newsPinned, dismissedIds: newsDismissed })
  }

  if (url === '/api/news/reader/dismissed') {
    const p = await readBody(req)
    // 上限 500，與 readerState.ts 一致
    newsDismissed = (Array.isArray(p.ids) ? p.ids : []).filter((x) => typeof x === 'string').slice(-500)
    console.log(`[news] 不看了 ${newsDismissed.length} 則`)
    return json(res, { pinnedItems: newsPinned, dismissedIds: newsDismissed })
  }

  if (url === '/api/news/reader/quota') {
    const p = await readBody(req)
    if (!p.sectionGroupId) return json(res, { error: 'sectionGroupId required' }, 400)
    const n = Math.max(0, Math.min(20, Math.floor(Number(p.quota))))
    if (!Number.isFinite(n)) return json(res, { error: 'quota must be a number' }, 400)
    if (p.sectionGroupId === '__breakout__') newsBreakoutQuota = n
    else if (p.sectionGroupId.startsWith('kw:')) {
      newsSources = newsSources.map((s) => {
        if (s.id !== p.sectionGroupId.slice(3)) return s
        if (n === newsPerKeyword || n < 1) {
          const { readerQuota, ...rest } = s
          return rest
        }
        return { ...s, readerQuota: Math.max(1, n) }
      })
    } else newsPerKeyword = Math.max(1, n)
    console.log(`[news] quota ${p.sectionGroupId} -> ${n}`)
    const r = newsSectionItems(p.sectionGroupId)
    if (!r.ok) return json(res, r)
    return json(res, { ok: true, sectionGroupId: p.sectionGroupId, items: r.items, fetchedAt: Date.now(), ...newsSnapshot() })
  }

  if (url === '/api/news/reader/groups') {
    const p = await readBody(req)
    newsReaderGroupIds = (Array.isArray(p.ids) ? p.ids : []).filter((x) => typeof x === 'string' && x)
    console.log('[news] 關鍵字組 ->', newsReaderGroupIds.length ? newsReaderGroupIds.join(',') : '全部組')
    return json(res, { ok: true, readerKeywordGroupIds: newsReaderGroupIds })
  }

  if (url === '/api/news/reader/order') {
    const p = await readBody(req)
    const ordered = (Array.isArray(p.orderedSourceIds) ? p.orderedSourceIds : []).filter((x) => typeof x === 'string' && x)
    if (ordered.length === 0) return json(res, { error: 'orderedSourceIds required' }, 400)
    const byId = new Map(newsSources.map((s) => [s.id, s]))
    const seen = new Set()
    const next = []
    for (const id of ordered) {
      const src = byId.get(id)
      if (!src || seen.has(id)) continue
      seen.add(id)
      next.push(src)
    }
    for (const src of newsSources) if (!seen.has(src.id)) next.push(src)
    // 真伺服器對數量對不起來的清單回 400（照抄，不要靜靜接受）
    if (next.length !== newsSources.length) return json(res, { error: 'source list mismatch' }, 400)
    newsSources = next
    console.log('[news] 欄位順序 ->', newsSources.map((s) => s.label).join(' > '))
    return json(res, { ok: true, sources: newsSources })
  }

  if (url === '/api/news/mark-opened') {
    const p = await readBody(req)
    console.log(`[news] 開原文加分：${p.sourceId}`)
    return json(res, { ok: true })
  }

  if (url === '/api/news/settings' && req.method === 'GET') {
    return json(res, {
      enabled: newsEnabled(),
      sources: newsSources,
      keywordGroups: newsKeywordGroups,
      blacklist: newsBlacklist
    })
  }

  if (url === '/api/news/settings') {
    const p = await readBody(req)
    if (Array.isArray(p.sources)) newsSources = normalizeNewsSources(p.sources)
    // 照抄 `main/modules/news/settings.ts` 的 normalizeKeywordGroups：沒帶 id 就生一個
    // （不是丟掉那一筆）；帶了 id 但已經出現過（多半是陣列裡本來就有的
    // `{id:'default',...}`）要跳過不重配，否則預設組會憑空多一份複本。
    if (Array.isArray(p.keywordGroups)) {
      const seen = new Set(['default'])
      const rest = []
      for (const g of p.keywordGroups) {
        if (!g || typeof g.name !== 'string' || !g.name.trim()) continue
        const hasId = typeof g.id === 'string' && g.id.length > 0
        if (hasId && seen.has(g.id)) continue
        let id = hasId ? g.id : 'grp-' + Math.random().toString(36).slice(2, 10)
        while (seen.has(id)) id = 'grp-' + Math.random().toString(36).slice(2, 10)
        seen.add(id)
        rest.push({ id, name: g.name.trim() })
      }
      newsKeywordGroups = [{ id: 'default', name: '預設組' }, ...rest]
    }
    if (Array.isArray(p.blacklist)) newsBlacklist = p.blacklist.filter((w) => typeof w === 'string' && w)
    console.log(`[news] 設定 -> 關鍵字 ${newsSources.filter((s) => s.type === 'keyword').length}、黑名單 ${newsBlacklist.length}`)
    return json(res, {
      enabled: newsEnabled(),
      sources: newsSources,
      keywordGroups: newsKeywordGroups,
      blacklist: newsBlacklist
    })
  }

  if (url === '/api/news/scheduler' && req.method === 'GET') return json(res, newsSchedule)

  if (url === '/api/news/scheduler') {
    const p = await readBody(req)
    // 要開卻沒給排程＝設定不完整，真伺服器回 400
    if (p.enabled && !p.schedule) return json(res, { error: 'schedule required' }, 400)
    newsSchedule = p.enabled ? { enabled: true, schedule: p.schedule } : { enabled: false }
    console.log('[news] 排程 ->', JSON.stringify(newsSchedule))
    return json(res, newsSchedule)
  }

  // ── 角色卡讀寫（階段 3）────────────────────────────────────
  //
  // ⚠️ 這一段必須放在下面那個 `/api/characters/` 萬用分支**之前**，
  // 否則會被它整碗吃掉並一律回 `{ ok: true }` —— 又是一次「假裝成功」。

  const cardMatch = url.match(/^\/api\/characters\/card\/([^?]+)/)
  if (cardMatch) {
    const id = decodeURIComponent(cardMatch[1])
    const card = library.find((c) => c.id === id)
    console.log(`[card] ${id} -> ${card ? 'ok' : '404'}`)
    // 真伺服器對不存在的 id 回 404（→ DataError not-found）
    if (!card) return json(res, { error: 'Character not found' }, 404)
    return json(res, { character: card })
  }

  if (url.startsWith('/api/characters/create')) {
    const p = await readBody(req)
    const now = Date.now()
    const char = {
      id: 'c' + now, name: (p.name || '').trim() || '新角色', nicknames: [], avatar: '',
      description: '', personality: '', firstMessage: '', exampleDialogue: '',
      emotions: {}, scenario: '', creatorNotes: '', systemPromptOverride: '',
      newsKeywords: [], lorebookIds: [], createdAt: now, updatedAt: now
    }
    library.push(char)
    console.log(`[create] ${char.id} ${char.name}`)
    return json(res, { character: char })
  }

  if (url.startsWith('/api/characters/save')) {
    const p = await readBody(req)
    const incoming = p.character || {}
    const idx = library.findIndex((c) => c.id === incoming.id)
    // 拒絕條件照抄 mobileServer：找不到角色 404、名稱空白 400
    if (idx < 0) return json(res, { error: 'Character not found' }, 404)
    if (!String(incoming.name || '').trim()) return json(res, { error: '角色名稱不可空白' }, 400)
    // ⚠️ 信任邊界：真伺服器**不採用**手機送來的 avatar／emotions／spriteIds
    //（那是本機檔案路徑）。這裡照樣忽略，免得 stub 上會動、真機上不會。
    library[idx] = {
      ...library[idx],
      ...incoming,
      avatar: library[idx].avatar,
      emotions: library[idx].emotions,
      spriteIds: library[idx].spriteIds,
      updatedAt: Date.now()
    }
    console.log(`[save] ${incoming.id} ${incoming.name}`)
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/characters/delete')) {
    const p = await readBody(req)
    const idx = library.findIndex((c) => c.id === p.id)
    if (idx < 0) return json(res, { error: 'Character not found' }, 404)
    if (library.length <= 1) {
      console.log(`[delete-rejected] ${p.id} last-character`)
      return json(res, { error: 'last-character' }, 409)
    }
    library.splice(idx, 1)
    presentIds = presentIds.filter((i) => i !== p.id)
    console.log(`[delete] ${p.id}`)
    push({ type: 'desktop-updated' })
    return json(res, { ok: true })
  }

  if (url.startsWith('/api/characters/avatar')) {
    const p = await readBody(req)
    const card = library.find((c) => c.id === p.id)
    if (!card) return json(res, { error: 'Character not found' }, 404)
    const kb = Math.round(((p.data || '').length * 3) / 4 / 1024)
    console.log(`[avatar] ${p.id} ${p.ext} ${kb}KB`)
    uploadedAvatars.set(p.id, `data:image/jpeg;base64,${p.data}`)
    card.avatar = `stub://uploaded/${p.id}`
    return json(res, { avatar: card.avatar })
  }

  if (url.startsWith('/api/characters/import-card')) {
    const p = await readBody(req)
    console.log(`[import-card] kind=${p.kind} ${Math.round(((p.data || '').length * 3) / 4 / 1024)}KB`)
    // 真伺服器對「不是角色卡的 PNG」回 400（PNG 裡沒有 chara 區塊）。
    // stub 沒辦法真的解析，改以「太小的檔案」當同一類失敗，讓錯誤路徑走得到。
    if (!p.data || p.data.length < 64) return json(res, { error: '內容無法解析為有效角色卡資料' }, 400)
    const now = Date.now()
    const char = {
      id: 'imp' + now, name: `匯入的角色 ${library.length + 1}`, nicknames: [], avatar: '',
      description: '（來自匯入的假卡）', personality: '', firstMessage: '', exampleDialogue: '',
      emotions: {}, scenario: '', creatorNotes: '', systemPromptOverride: '',
      newsKeywords: [], lorebookIds: [], createdAt: now, updatedAt: now
    }
    library.push(char)
    return json(res, { character: char })
  }

  if (url.startsWith('/api/characters/export-card')) {
    const p = await readBody(req)
    const card = library.find((c) => c.id === p.id)
    if (!card) return json(res, { error: 'Character not found' }, 404)
    // ⚠️ 這仍是假內容，不是真的 `exportToStJson()` 輸出。
    // 真伺服器會做完整 SillyTavern 欄位對照（`spec` / `data.*` 巢狀結構、
    // 暱稱塞進 alternate_greetings 之類的轉換），那段邏輯只存在於
    // `src/main/stCardMapper.ts`，stub 沒有理由重寫一份。
    // 這裡只是把手上有的欄位攤平塞進去，讓「下載下來的檔案看起來有內容」
    // 這件事測得到 —— 驗證真正的欄位對照仍要接真的 DeST。
    const body = p.kind === 'json'
      ? Buffer.from(JSON.stringify({
          name: card.name,
          description: card.description,
          personality: card.personality,
          first_mes: card.firstMessage,
          mes_example: card.exampleDialogue,
          scenario: card.scenario,
          creator_notes: card.creatorNotes,
          system_prompt: card.systemPromptOverride,
          _stub_note: '這是假伺服器產生的簡化內容，非真實 SillyTavern 格式輸出'
        }, null, 2), 'utf-8')
      : Buffer.from('stub-png-' + card.id, 'utf-8')
    console.log(`[export-card] ${p.id} ${p.kind}`)
    return json(res, {
      data: body.toString('base64'),
      filename: `${card.name}.${p.kind === 'json' ? 'json' : 'png'}`
    })
  }

  if (url.startsWith('/api/characters/export-pack')) {
    const p = await readBody(req)
    // 真伺服器：一個角色都沒選 → 400「尚未選擇任何角色」
    if (!Array.isArray(p.ids) || p.ids.length === 0) return json(res, { error: '尚未選擇任何角色' }, 400)
    console.log(`[export-pack] ${p.ids.join(',')} global=${!!p.includeGlobalSettings} lore=${!!p.includeLorebooks}`)
    return json(res, {
      data: Buffer.from('stub-dstpack').toString('base64'),
      filename: `DeST-${new Date().toISOString().slice(0, 10)}.dstpack`
    })
  }

  if (url.startsWith('/api/characters/import-pack')) {
    const p = await readBody(req)
    console.log(`[import-pack] onConflict=${p.onConflict} global=${!!p.applyGlobalSettings}`)
    // 真伺服器：檔案過小或已損毀 → 400
    if (!p.data || p.data.length < 64) return json(res, { error: '檔案過小或已損毀' }, 400)
    return json(res, { imported: 2, skipped: 1 })
  }

  if (url.startsWith('/api/characters/') || url.startsWith('/api/messages/')) {
    const p = await readBody(req)
    let out = { ok: true }

    if (url.includes('/desktop/add')) {
      if (!presentIds.includes(p.characterId)) presentIds.push(p.characterId)
    } else if (url.includes('/desktop/remove')) {
      // ⚠️ 拒絕用 200 + ok:false，不是錯誤狀態碼（清單 D5）
      if (presentIds.length <= 1) out = { ok: false }
      else presentIds = presentIds.filter((i) => i !== p.characterId)
    } else if (url.includes('toggle-mute')) {
      if (muted.has(p.characterId)) muted.delete(p.characterId)
      else muted.add(p.characterId)
      out = { muted: muted.has(p.characterId) }
    } else if (url.includes('/speak')) {
      fakeReply(p.characterId, '（主動開口）今天過得怎麼樣？', 900)
    } else if (url.includes('/messages/delete')) {
      const i = messages.findIndex((m) => m.id === p.id)
      if (i >= 0) messages.splice(i, 1)
    } else if (url.includes('/messages/edit')) {
      const m = messages.find((m) => m.id === p.id)
      if (m) m.content = p.content
    } else if (url.includes('/messages/resend')) {
      // ⚠️ 比照 `resendMessageDirect`：**只接受使用者訊息**，
      // 砍掉「這則含以後」再重新產生一次回覆。
      const i = messages.findIndex((m) => m.id === p.id)
      const m = messages[i]
      if (i < 0 || m.role !== 'user') {
        out = { error: '只能重新發送使用者訊息' }
      } else {
        const { content } = m
        messages.splice(i)
        messages.push({ id: 'again-' + Date.now(), role: 'user', content, timestamp: Date.now() })
        fakeReply(presentIds[0] || 'c1', `（重新回一次）你說：「${content}」`, 1000)
      }
    }

    console.log(`[${url}]`, JSON.stringify(p), '->', JSON.stringify(out))
    // 真伺服器對「只能重新發送使用者訊息」回的是 400，不是 200 ＋ error。
    // 這裡照抄狀態碼，否則 UI 會把它當成功。
    if (out.error) return json(res, out, 400)
    // 角色類異動會讓電腦端推 desktop-updated → 手機重抓（state-invalidated）
    if (url.includes('/desktop/') || url.includes('toggle-mute')) push({ type: 'desktop-updated' })
    return json(res, out)
  }

  // 沒實作的端點一律 404，讓「這支還沒模擬」在終端一眼看得出來。
  console.log(`[404] ${url}`)
  return json(res, {}, 404)
})

new WebSocketServer({ server }).on('connection', (ws) => {
  clients.add(ws)
  ws.on('close', () => clients.delete(ws))
})

// 綁 0.0.0.0：真手機要連得進來（`host: true` 的 vite 也是同樣理由）
server.listen(PORT, '0.0.0.0', () => {
  console.log(`假 mobileServer 起在 :${PORT}`)
  console.log(`手機開：http://<電腦區網IP>:5180/?server=http://<電腦區網IP>:${PORT}&token=x`)
})
