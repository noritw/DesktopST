/**
 * DeST 手機工具 —— 手機相關的動作全部從這裡進去。
 *
 * 以前這些拆成五個 MobileST-*.bat，檔名長得像但做的事完全不同
 * （打包／重開 QR／HMR 預覽／防火牆），每次都要想一下該點哪個。
 * 併成一個選單，預設就是最常用的「打包並裝到手機」，直接 Enter 即可。
 *
 * 三條路徑：
 *   [1] 打包 APK 裝到手機：防火牆 → 打包 → USB 直裝 → 開桌面 DeST → 區網 QR
 *   [2] 只開下載 QR：APK 沒重打，只是要再裝一次（省掉 gradle 那一分鐘）
 *   [3] 手機 UI 即時預覽：改版面用的 HMR，不產 APK
 *
 * 埠：DeST mobileServer 3721、APK 下載頁 8731、手機 UI HMR 5180 起。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const DEST_PORT = 3721
const APK_PORT = Number(process.env.DESTA_APK_PORT || 8731)
const FIREWALL_RULE = 'DeST APK serve'
const apkPath = path.join(root, 'out', 'apk', 'DeST-debug.apk')

// ── 小工具 ────────────────────────────────────────────────

function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host })
    const done = (v) => {
      sock.destroy()
      resolve(v)
    }
    sock.on('connect', () => done(true))
    sock.on('error', () => done(false))
    sock.setTimeout(800, () => done(false))
  })
}

async function freePort(start) {
  let p = start
  while (await portInUse(p)) p++
  return p
}

/** 另開一個看得見的視窗跑指令。detached PowerShell 在某些機器會默默失敗，走 cmd start 最穩。 */
function openWindow(title, command) {
  const stub = path.join(root, 'out', `_run-${title.replace(/\W+/g, '-')}.cmd`)
  fs.mkdirSync(path.dirname(stub), { recursive: true })
  fs.writeFileSync(
    stub,
    ['@echo off', `cd /d "${root}"`, `title ${title}`, command, 'echo.', 'pause'].join('\r\n'),
    'utf8'
  )
  spawn('cmd.exe', ['/c', 'start', title, stub], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  }).unref()
}

function runStep(command, args) {
  const r = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: true })
  return r.status === 0
}

// ── 防火牆 ────────────────────────────────────────────────

function firewallRuleExists() {
  const r = spawnSync('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${FIREWALL_RULE}`], {
    encoding: 'utf8'
  })
  return r.status === 0
}

/**
 * 沒有規則就提權加一次。
 *
 * serve-apk 自己也會試著加，但沒提權時會靜靜失敗 —— 症狀是手機瀏覽器一直轉圈，
 * 看起來像網路問題，其實是被 Windows 擋在門外。所以這裡先問、先提權，
 * 只會麻煩使用者一次（規則是永久的）。
 */
async function ensureFirewall(rl) {
  if (firewallRuleExists()) return
  console.log('')
  console.log(`偵測到還沒開放 TCP ${APK_PORT}。沒開的話手機下載會一直轉圈。`)
  const ans = (await rl.question('現在開放嗎？會跳一次系統管理員授權。(Y/n) ')).trim().toLowerCase()
  if (ans === 'n') {
    console.log('略過。若手機連不上，再跑一次本工具選同一項即可。')
    return
  }
  const args = [
    'advfirewall',
    'firewall',
    'add',
    'rule',
    `name=${FIREWALL_RULE}`,
    'dir=in',
    'action=allow',
    'protocol=TCP',
    `localport=${APK_PORT}`,
    'profile=private,domain'
  ]
  const psArgs = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  try {
    execFileSync(
      'powershell',
      ['-NoProfile', '-Command', `Start-Process netsh -ArgumentList ${psArgs} -Verb RunAs -Wait -WindowStyle Hidden`],
      { stdio: 'ignore' }
    )
  } catch {
    /* 使用者按了取消 */
  }
  console.log(firewallRuleExists() ? `已開放 TCP ${APK_PORT}。` : '沒有加成功（可能被取消）。手機連不上的話再試一次。')
}

// ── 桌面 DeST ─────────────────────────────────────────────

/** 手機裝好後要掃電腦的 QR 同步設定／對話，那需要 DeST 開著。 */
async function ensureDesktopRunning() {
  if (await portInUse(DEST_PORT)) {
    console.log(`桌面 DeST 已經在跑（埠 ${DEST_PORT}），不重開。`)
    return
  }
  console.log('桌面 DeST 沒在跑，另開一個視窗啟動...')
  // 直接 npm run dev 而不是 DesktopST-dev.bat：手機 UI 剛才 sync:android 已經建過了，
  // 再 build:mobile 一次只是多等六秒
  openWindow('DeST dev', 'npm.cmd run dev')
}

// ── 三個動作 ──────────────────────────────────────────────

async function actionBuildApk(rl) {
  await ensureFirewall(rl)

  console.log('')
  console.log('=== 打包 APK ===')
  if (!runStep('node', ['scripts/build-mobile-apk.mjs'])) {
    console.error('')
    console.error('打包失敗，上面有錯誤訊息。QR 就不開了。')
    return false
  }

  console.log('')
  await ensureDesktopRunning()

  console.log('')
  console.log('=== 開區網下載頁（QR）===')
  console.log('手機跟電腦要在同一個 Wi-Fi（不要訪客網路）。')
  openWindow('DeST APK serve', 'node scripts\\serve-apk.mjs')
  console.log('已另開「DeST APK serve」視窗，QR 在那裡。裝完關掉它即可。')
  return true
}

async function actionServeOnly(rl) {
  if (!fs.existsSync(apkPath)) {
    console.error(`找不到 ${apkPath}`)
    console.error('還沒打包過。請改選 [1]。')
    return false
  }
  const ageMin = Math.round((Date.now() - fs.statSync(apkPath).mtimeMs) / 60000)
  console.log(`使用既有 APK（${ageMin} 分鐘前打包的）。程式碼有改過的話請改選 [1]。`)
  await ensureFirewall(rl)
  openWindow('DeST APK serve', 'node scripts\\serve-apk.mjs')
  console.log('已另開「DeST APK serve」視窗，QR 在那裡。')
  return true
}

async function actionUiPreview(rl) {
  console.log('')
  console.log('這是改版面用的即時預覽（HMR），不會產生 APK。')
  console.log('  [1] 假資料（不必開 DeST，看排版最快）')
  console.log('  [2] 真資料（DeST 要先開著）')
  const pick = (await rl.question('選擇 (1/2，預設 1)：')).trim() || '1'
  const real = pick === '2'

  if (real && !(await portInUse(DEST_PORT))) {
    console.error(`DeST 沒在跑（埠 ${DEST_PORT}）。請先開 DesktopST-dev.bat，再回來選這項。`)
    return false
  }

  const uiPort = await freePort(5180)
  if (!real) {
    openWindow('DeST mobile stub', 'node scripts\\mobile-stub-server.mjs')
  }
  openWindow('DeST mobile UI', `npm.cmd run dev:mobile -- --port ${uiPort} --strictPort`)

  console.log(`手機 UI 啟動中（埠 ${uiPort}），等 Vite 起來...`)
  await new Promise((r) => setTimeout(r, 3500))

  const env = { ...process.env, MOBILE_UI_PORT: String(uiPort) }
  if (real) env.MOBILE_REAL = '1'
  const r = spawnSync('node', ['scripts/mobile-test-qr.mjs'], { cwd: root, stdio: 'inherit', env, shell: true })
  if (r.status !== 0) {
    console.error('產生 QR 失敗。上面有原因。')
    return false
  }
  spawn('cmd.exe', ['/c', 'start', '', path.join(root, 'mobile-test-qr.png')], {
    detached: true,
    stdio: 'ignore'
  }).unref()
  console.log('')
  console.log('掃 QR 開始預覽。改程式碼會即時反映，不用重掃。')
  console.log('結束時關掉另開的那幾個視窗。')
  return true
}

// ── 選單 ──────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

console.log('')
console.log('=== DeST 手機工具 ===')
console.log('')
console.log('  [1] 打包 APK 並裝到手機   （USB 直裝，或掃 QR 下載；順便開桌面 DeST）')
console.log('  [2] 只開下載 QR           （APK 已經打好，省掉重新打包）')
console.log('  [3] 手機 UI 即時預覽      （改版面用，不產 APK）')
console.log('')

const choice = (await rl.question('請選擇（直接 Enter = 1）：')).trim() || '1'

let ok = false
switch (choice) {
  case '1':
    ok = await actionBuildApk(rl)
    break
  case '2':
    ok = await actionServeOnly(rl)
    break
  case '3':
    ok = await actionUiPreview(rl)
    break
  default:
    console.error(`不認得的選項「${choice}」。`)
}

rl.close()
console.log('')
process.exit(ok ? 0 : 1)
