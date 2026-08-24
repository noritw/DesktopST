/**
 * DeST 手機工具 —— 手機相關的動作全部從這裡進去。
 *
 * 以前這些拆成五個 MobileST-*.bat，檔名長得像但做的事完全不同
 * （打包／重開 QR／HMR 預覽／防火牆），每次都要想一下該點哪個。
 * 併成一個選單，預設就是最常用的「打包並裝到手機」，直接 Enter 即可。
 *
 * 五條路徑：
 *   [1] 打包 APK 裝到手機：防火牆 → 打包 → USB 直裝 → 開桌面 DeST → 區網 QR
 *   [2] 只開下載 QR：APK 沒重打，只是要再裝一次（省掉 gradle 那一分鐘）
 *   [3] 手機 UI 即時預覽：改版面用的 HMR，不產 APK
 *   [4] 打包正式簽章 APK 並裝到手機：跟 [1] 是姊妹選項，差在簽章跟已發布的
 *       版本一致，能直接覆蓋安裝、不必先解除安裝清資料（2026-08-24 加，
 *       QR 配對合併那次順手補的——debug 簽章裝不上已經裝過正式版的手機）
 *   [5] 產生 App 圖示：改完 assets/AppIcon-android.png 後重出五種密度的資源。
 *       有「預覽」子選項，因為構圖被圓形遮罩裁到、單色版亮度沒壓夠這兩件事
 *       都要看到圖才知道，而裝機驗證一輪要好幾分鐘（2026-08-24 加）
 *
 * 埠：DeST mobileServer 3721、APK 下載頁 8731、手機 UI HMR 5180 起。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { tryAdbInstall } from './adbHelpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const DEST_PORT = 3721
const APK_PORT = Number(process.env.DESTA_APK_PORT || 8731)
const FIREWALL_RULE = 'DeST APK serve'
const apkPath = path.join(root, 'out', 'apk', 'DeST-debug.apk')
const releaseApkPath = () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  return path.join(root, 'out', 'apk', `DeST-v${pkg.version}-release.apk`)
}

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

/**
 * 打包正式簽章 APK，優先 USB 直裝，裝不上才退回區網 QR。
 *
 * 跟 [1]（debug）平行、不是取代——debug 版還是改版面時最快的日常測試手段。
 * 這個選項存在的理由單純是「手機上已經裝過正式簽章版時，debug 簽章蓋不上去」
 * （2026-08-24 實測撞到），要嘛先解除安裝清掉手機資料，要嘛用跟手機上那份
 * 同一把簽章重新裝——這裡走後者。
 */
async function actionReleaseApk(rl) {
  console.log('')
  console.log('=== 打包正式簽章 APK ===')
  console.log('需要 android/keystore.properties 已經存在（沒有的話下面會直接失敗並說明怎麼做）。')
  if (!runStep('node', ['scripts/build-mobile-apk-release.mjs'])) {
    console.error('')
    console.error('打包失敗，上面有錯誤訊息。')
    return false
  }

  const releasePath = releaseApkPath()
  if (!fs.existsSync(releasePath)) {
    console.error(`打包步驟回報成功，但找不到 ${releasePath}（不應該發生，回報給開發者）。`)
    return false
  }

  console.log('')
  const installed = tryAdbInstall(releasePath)
  if (installed) return true

  await ensureFirewall(rl)
  console.log('')
  await ensureDesktopRunning()

  console.log('')
  console.log('=== 開區網下載頁（QR）===')
  console.log('手機跟電腦要在同一個 Wi-Fi（不要訪客網路）。')
  process.env.DESTA_APK_PATH = releasePath
  openWindow('DeST APK serve', 'node scripts\\serve-apk.mjs')
  console.log('已另開「DeST APK serve」視窗，QR 在那裡。裝完關掉它即可。')
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

/**
 * 產生 App 圖示。實際工作在 scripts/gen-android-icons.ps1（要 System.Drawing，
 * Node 這邊沒有影像處理，不想為了縮圖多裝一個 sharp）。
 *
 * 為什麼需要「預覽」這一步：Android 的圓形遮罩只露出畫布中央 66.6%，
 * 方形構圖的角色圖放進去下襬會被裁掉；而桌布主題化的單色版是啟動器
 * 自己取暗部生成的，亮度沒壓夠就只會剩輪廓。這兩件事都要看到圖才知道，
 * 但「打包→裝機→等轉場動畫」一輪要好幾分鐘，所以先在電腦上看。
 */
async function actionIcons(rl) {
  console.log('')
  console.log('=== 產生 App 圖示 ===')
  console.log('來源圖：assets\\AppIcon-android.png（改圖就是改這張）')
  console.log('')
  console.log('  [1] 預覽        （改完圖先看，不寫入專案）')
  console.log('  [2] 正式產生    （寫入 android 資源，之後再打包）')
  console.log('  [3] 分析亮度    （改色前參考：哪些顏色在單色版會實心）')
  console.log('')
  const pick = (await rl.question('選擇 (1/2/3，預設 1)：')).trim() || '1'

  // 路徑用正斜線：runStep 是 shell:true，反斜線會被當成跳脫字元吃掉
  // （`scripts\gen-...` 會變成 `scriptsgen-...`）。PowerShell 吃正斜線沒問題。
  const args = ['-ExecutionPolicy', 'Bypass', '-File', 'scripts/gen-android-icons.ps1']

  if (pick === '3') {
    args.push('-Analyze')
  } else if (pick === '1' || pick === '2') {
    const scaleIn = (await rl.question('角色縮放（0.40～0.70，直接 Enter = 0.55）：')).trim()
    if (scaleIn) {
      const n = Number(scaleIn)
      if (!Number.isFinite(n) || n < 0.2 || n > 1) {
        console.error(`縮放值「${scaleIn}」不合理，要是 0.2～1 之間的小數。`)
        return false
      }
      args.push('-Scale', String(n))
    }
    if (pick === '1') args.push('-Preview')
  } else {
    console.error(`不認得的選項「${pick}」。`)
    return false
  }

  if (!runStep('powershell', args)) {
    console.error('')
    console.error('產生失敗，上面有錯誤訊息。')
    return false
  }

  if (pick === '1') {
    // 預覽圖直接開起來，省得使用者自己去翻檔案
    const preview = path.join(root, 'icon-preview.png')
    if (fs.existsSync(preview)) {
      spawn('cmd.exe', ['/c', 'start', '', preview], { detached: true, stdio: 'ignore' }).unref()
    }
    console.log('滿意的話回到這個選單選 [2] 正式產生，再用 [4] 打包。')
  } else if (pick === '2') {
    console.log('接著用 [4] 打包正式簽章 APK（或 [1] 打 debug）。')
  }
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
console.log('  [4] 打包正式簽章 APK      （手機上已裝正式版時用這個才裝得上去）')
console.log('  [5] 產生 App 圖示         （改完 AppIcon-android.png 後跑這個）')
console.log('')

const choice = (await rl.question('請選擇（直接 Enter = 1）：')).trim() || '1'

let ok = false
switch (choice) {
  case '1':
    ok = await actionBuildApk(rl)
    break
  case '4':
    ok = await actionReleaseApk(rl)
    break
  case '2':
    ok = await actionServeOnly(rl)
    break
  case '3':
    ok = await actionUiPreview(rl)
    break
  case '5':
    ok = await actionIcons(rl)
    break
  default:
    console.error(`不認得的選項「${choice}」。`)
}

rl.close()
console.log('')
process.exit(ok ? 0 : 1)
