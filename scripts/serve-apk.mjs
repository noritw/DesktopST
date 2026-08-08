/**
 * 在區網開一個暫時下載頁，讓手機掃 QR 拿 debug APK。
 * 由 MobileST-build-apk.bat / MobileST-serve-apk.bat 呼叫。
 */
import { execFile, execFileSync } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const apkPath = path.join(root, 'out', 'apk', 'DeST-debug.apk')
const qrPath = path.join(root, 'out', 'apk', 'DeST-debug-qr.png')

if (!fs.existsSync(apkPath)) {
  console.error(`找不到 APK：${apkPath}`)
  console.error('請先跑 MobileST-build-apk.bat')
  process.exit(1)
}

/** 略過 169.254 link-local／虛擬卡，優先一般家用區網。 */
function pickLanIPv4() {
  const scored = []
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const family = a.family === 4 || a.family === 'IPv4'
      if (!family || a.internal) continue
      const ip = a.address
      if (ip.startsWith('169.254.')) continue
      let score = 0
      if (ip.startsWith('192.168.')) score += 30
      else if (ip.startsWith('10.')) score += 20
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 20
      else score += 5
      if (/wi-?fi|wlan|乙太|ethernet/i.test(name)) score += 10
      scored.push({ ip, name, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored
}

const candidates = pickLanIPv4()
const ip = candidates[0]?.ip ?? '127.0.0.1'
const port = Number(process.env.DESTA_APK_PORT || 8731)
// QR 指向下載頁（幾 KB），不要直連 40MB APK —— 手機瀏覽器直連常會一直轉圈
const pageUrl = `http://${ip}:${port}/`
const apkUrl = `http://${ip}:${port}/DeST-debug.apk`

const qrPng = await QRCode.toBuffer(pageUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
fs.writeFileSync(qrPath, qrPng)
const qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`

const apkStat = fs.statSync(apkPath)
const sizeMb = (apkStat.size / (1024 * 1024)).toFixed(1)

function ensureFirewallRule() {
  try {
    execFileSync(
      'netsh',
      [
        'advfirewall',
        'firewall',
        'add',
        'rule',
        'name=DeST APK serve',
        'dir=in',
        'action=allow',
        'protocol=TCP',
        `localport=${port}`,
        'profile=private,domain'
      ],
      { stdio: 'ignore' }
    )
    console.log(`已嘗試加入防火牆允許規則（TCP ${port}）。`)
  } catch {
    console.log(`（未提權）無法自動開防火牆。若手機連不上，請在「Windows 安全性」允許 Node，或手動放行 TCP ${port}。`)
  }
}

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DeST debug APK</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 2rem auto; padding: 0 1rem; color: #3D5A52; background: #F7FFFC; }
    a.btn { display: block; text-align: center; padding: 0.9rem 1rem; border-radius: 1rem; background: #7ec8b8; color: #fff; text-decoration: none; font-weight: 600; }
    p { line-height: 1.5; }
    code { word-break: break-all; }
    img.qr { display: block; width: min(100%, 280px); margin: 1rem auto; border-radius: 1rem; background: #fff; }
  </style>
</head>
<body>
  <h1>DeST debug APK</h1>
  <p>約 ${sizeMb} MB。同一個 Wi-Fi 下點下面下載。</p>
  <p><a class="btn" href="/DeST-debug.apk">下載並安裝</a></p>
  <p>若只下載不安裝：用檔案管理員打開 APK，允許「未知應用程式」來源。</p>
  <p><small><code>${apkUrl}</code></small></p>
  <hr style="border:none;border-top:1px solid #cfe8df;margin:1.5rem 0" />
  <p style="opacity:.75">電腦端可掃這張（內容＝本頁）：</p>
  <img class="qr" alt="page QR" src="${qrDataUrl}" />
</body>
</html>`

function openOnWindows(target) {
  execFile('cmd', ['/c', 'start', '', target], { windowsHide: true }, () => {})
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', pageUrl)
  const from = req.socket.remoteAddress || '?'
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${url.pathname} from ${from}`)

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html)
    return
  }
  if (url.pathname === '/DeST-debug.apk') {
    res.writeHead(200, {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': apkStat.size,
      'Content-Disposition': 'attachment; filename="DeST-debug.apk"',
      'Cache-Control': 'no-store'
    })
    fs.createReadStream(apkPath).pipe(res)
    return
  }
  if (url.pathname === '/qr.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    res.end(qrPng)
    return
  }
  res.writeHead(404)
  res.end('not found')
})

server.on('error', (err) => {
  console.error(`無法綁定埠 ${port}：${err.message}`)
  console.error('若上次 serve 還開著，先關掉那個視窗再試。')
  process.exit(1)
})

ensureFirewallRule()

server.listen(port, '0.0.0.0', () => {
  console.log('')
  console.log('區網下載已就緒（關掉本視窗即停止 —— 關掉就下載不了）')
  console.log(`頁面：${pageUrl}`)
  console.log(`APK ：${apkUrl}`)
  if (candidates.length > 1) {
    console.log('其他網卡（若掃錯網段可改手動開）：')
    for (const c of candidates.slice(1)) console.log(`  - http://${c.ip}:${port}/  (${c.name})`)
  }
  console.log('')
  console.log('手機掃碼後應先看到下載頁，再點綠色按鈕。')
  console.log('若瀏覽器一直轉圈：確認 serve 視窗還開著、手機與電腦同一個 Wi-Fi（不要訪客網路）。')
  console.log('')
  openOnWindows(pageUrl)
  openOnWindows(qrPath)
})
