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

const library = [
  { id: 'c1', name: '小綠' },
  { id: 'c2', name: '小藍' },
  { id: 'c3', name: '小黃' }
]
let presentIds = ['c1', 'c2']
const muted = new Set()

const messages = [
  {
    id: 'm1',
    role: 'character',
    characterId: 'c1',
    content: '嗨，試試看傳張照片或擲個骰子給我看看？',
    timestamp: Date.now() - 60_000
  }
]
/** messageId → data URI 陣列。`/api/message-image` 從這裡取。 */
const images = new Map()

const state = () => ({
  desktopCharacters: presentIds.map((id) => ({
    id,
    name: library.find((c) => c.id === id).name,
    muted: muted.has(id)
  })),
  conversation: { id: 'conv1', title: '測試', messages },
  colorTheme: process.env.THEME || 'mint',
  // NR=0 用來驗「隨機工具總開關關閉時 🎲 入口整個消失」（清單 C6）
  randomToolsEnabled: process.env.NR !== '0',
  maxImages: Number(process.env.MAXIMG || 5)
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
    const color = { c1: '#CBFBC4', c2: '#AAEEFF', c3: '#FFE8AA' }[id]
    if (!color) return res.writeHead(404, cors).end()
    res.writeHead(200, { ...cors, 'Content-Type': 'image/svg+xml' })
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">` +
        `<rect width="96" height="96" fill="${color}"/>` +
        `<text x="48" y="62" font-size="40" text-anchor="middle" fill="#3D5A52">${id.slice(1)}</text></svg>`
    )
  }

  if (url.startsWith('/api/state')) return json(res, state())

  if (url.startsWith('/api/characters/library')) {
    return json(res, {
      characters: library.map((c) => ({ ...c, onDesktop: presentIds.includes(c.id) }))
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
