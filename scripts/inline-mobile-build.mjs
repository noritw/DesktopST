/**
 * 把 `out/mobile` 的建置產物壓成**單一自足的 index.html**。
 *
 * ## 為什麼一定要這樣
 *
 * relay（`relay.nori.tw` 的 Cloudflare Worker）是反向代理，
 * **每一個請求都要求「`/<deviceId>` 路徑 ＋ `?token=`」**。
 * 它注入頁面的相容層只 patch 了 `window.fetch`：
 *
 *     if (typeof input === 'string' && input.startsWith('/') && !input.startsWith('/' + deviceId))
 *       input = '/' + deviceId + input
 *
 * 但 `<script src>` / `<link rel=stylesheet>` 是**瀏覽器原生的子資源載入，
 * 完全繞過 fetch** —— 既拿不到 deviceId 前綴也帶不了 token。
 * 2026-08-06 實測：relay 對這些請求回 503（缺 deviceId）或 401（缺 token），
 * 於是「掃新版 QR 一片全白」。
 *
 * `assets/mobile.html` 從來沒這個問題，正是因為它是單一檔案、零子資源。
 * 外部 Worker 我們改不了，所以只能讓自己的產物也不需要子資源。
 *
 * ## 順帶的好處
 *
 * APK（Capacitor 走 `file://`）也少一類路徑問題；少一次來回，首屏反而更快。
 *
 * ## 代價
 *
 * 沒有分檔快取，每次進頁面都要重新下載整包（gzip 後約 90KB）。
 * 對「自己家裡的一台電腦 ＋ 自己的手機」這個使用情境完全可接受。
 */
import * as fs from 'fs'
import * as path from 'path'

const outDir = path.resolve(process.cwd(), 'out/mobile')
const htmlPath = path.join(outDir, 'index.html')

if (!fs.existsSync(htmlPath)) {
  console.error('[inline] 找不到 out/mobile/index.html —— 請先跑 vite build')
  process.exit(1)
}

// 獨立模式首啟種子：若本機有預設角色包就抄進 out/mobile（gitignore，不進 repo）
const defaultPackSrc = path.resolve(process.cwd(), 'assets', 'DesktopST_DefaultChara.dstpack')
const defaultPackDest = path.join(outDir, 'DesktopST_DefaultChara.dstpack')
if (fs.existsSync(defaultPackSrc)) {
  fs.copyFileSync(defaultPackSrc, defaultPackDest)
  console.log('[inline] copied DesktopST_DefaultChara.dstpack for standalone seed')
} else {
  console.warn('[inline] DesktopST_DefaultChara.dstpack missing — standalone will seed a blank character')
}

let html = fs.readFileSync(htmlPath, 'utf-8')
const inlined = []

/**
 * `</script>` 出現在 JS 字串裡會提前結束 script 標籤，整頁壞掉。
 * 這是內嵌 JS 的經典地雷，必須轉義。
 */
const escapeForScript = (js) => js.replace(/<\/script>/gi, '<\\/script>')

// ── <script type="module" src="./assets/x.js"> → 內嵌 ──
html = html.replace(
  /<script\b[^>]*\bsrc=["']\.?\/?([^"']+)["'][^>]*><\/script>/gi,
  (match, src) => {
    const file = path.join(outDir, src)
    if (!fs.existsSync(file)) {
      console.warn(`[inline] 找不到 ${src}，保持原樣`)
      return match
    }
    const isModule = /type=["']module["']/i.test(match)
    inlined.push(src)
    const code = escapeForScript(fs.readFileSync(file, 'utf-8'))
    return `<script${isModule ? ' type="module"' : ''}>${code}</script>`
  }
)

// ── <link rel="stylesheet" href="./assets/x.css"> → 內嵌 ──
html = html.replace(
  /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']\.?\/?([^"']+)["'][^>]*>/gi,
  (match, href) => {
    const file = path.join(outDir, href)
    if (!fs.existsSync(file)) {
      console.warn(`[inline] 找不到 ${href}，保持原樣`)
      return match
    }
    inlined.push(href)
    return `<style>${fs.readFileSync(file, 'utf-8')}</style>`
  }
)

fs.writeFileSync(htmlPath, html, 'utf-8')

// 內嵌完就把原始檔刪掉，避免「明明已經內嵌卻還留著一份」造成誤會，
// 也讓 assets/ 空掉時能一眼看出產物確實是自足的。
for (const rel of inlined) {
  try {
    fs.unlinkSync(path.join(outDir, rel))
  } catch {
    /* 刪不掉不影響結果 */
  }
}
const assetsDir = path.join(outDir, 'assets')
if (fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).length === 0) {
  fs.rmdirSync(assetsDir)
}

// ── 驗收：產物必須真的不含任何外部子資源 ──
const leftover = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
  .map((m) => m[1])
  .filter((u) => !u.startsWith('data:') && !u.startsWith('http'))

if (leftover.length > 0) {
  console.error(`[inline] ❌ 仍有外部資源未內嵌：${leftover.join(', ')}`)
  console.error('[inline]    這些在 relay 上一定載不到（會是全白畫面），建置視為失敗。')
  process.exit(1)
}

const kb = (fs.statSync(htmlPath).size / 1024).toFixed(0)
console.log(`[inline] ✅ 已內嵌 ${inlined.length} 個檔案 → 單一 index.html（${kb} KB）`)
