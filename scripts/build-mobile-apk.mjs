/**
 * DeST 手機獨立版：一鍵建置 debug APK。
 * 由 MobileST-build-apk.bat 呼叫（避開 PowerShell 5.1 讀 UTF-8 無 BOM 會炸的問題）。
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const jdk21 = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot'
const apkSrc = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
const outDir = path.join(root, 'out', 'apk')
const apkDst = path.join(outDir, 'DeST-debug.apk')

function fail(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

function run(command, args, opts = {}) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: opts.cwd || root,
    env: opts.env || process.env,
    stdio: 'inherit',
    shell: opts.shell ?? false
  })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) fail(`指令失敗（exit ${result.status}）`, result.status ?? 1)
}

function findAdb() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe') : '',
    process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe') : ''
  ].filter(Boolean)

  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }

  try {
    const which = spawnSync('where.exe', ['adb'], { encoding: 'utf8' })
    const first = (which.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    if (first && fs.existsSync(first)) return first
  } catch {
    /* ignore */
  }
  return null
}

function hasAdbDevice(adb) {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8' })
  if (result.status !== 0) return false
  return (result.stdout || '')
    .split(/\r?\n/)
    .slice(1)
    .some((line) => /\tdevice$/.test(line))
}

console.log('')
console.log('=== DeST 手機 APK 一鍵打包 ===')
console.log('')

if (!fs.existsSync(jdk21)) {
  fail(
    `找不到 JDK 21：${jdk21}\n` +
      'Gradle 8.14 不能用 Android Studio 的 jbr（JDK 25）。請先裝 Adoptium JDK 21。'
  )
}

if (!fs.existsSync(path.join(root, 'android', 'gradlew.bat'))) {
  fail('找不到 android/gradlew.bat。請先在本機跑過：npx cap add android')
}

const env = {
  ...process.env,
  JAVA_HOME: jdk21,
  Path: `${jdk21}\\bin;${process.env.Path || process.env.PATH || ''}`,
  PATH: `${jdk21}\\bin;${process.env.PATH || process.env.Path || ''}`
}

console.log(`[1/4] JAVA_HOME = ${env.JAVA_HOME}`)
console.log('[2/4] build:mobile + cap sync android ...')
run('npm.cmd', ['run', 'sync:android'], { env, shell: true })

console.log('[3/4] gradlew assembleDebug ...')
run('gradlew.bat', ['assembleDebug'], {
  cwd: path.join(root, 'android'),
  env,
  shell: true
})

if (!fs.existsSync(apkSrc)) {
  fail(`建置結束但找不到 APK：${apkSrc}`)
}

fs.mkdirSync(outDir, { recursive: true })
fs.copyFileSync(apkSrc, apkDst)
const sizeMb = (fs.statSync(apkDst).size / (1024 * 1024)).toFixed(1)

console.log('')
console.log(`[4/4] 完成：${apkDst}  (${sizeMb} MB)`)
console.log('')

let installed = false
const adb = findAdb()
if (adb) {
  if (hasAdbDevice(adb)) {
    console.log('偵測到 USB 裝置，嘗試 adb install -r ...')
    const install = spawnSync(adb, ['install', '-r', apkDst], { stdio: 'inherit' })
    if (install.status === 0) {
      installed = true
      console.log('已安裝到手機。直接打開 DeST 即可測。')
    } else {
      console.log('adb install 失敗（權限／簽名衝突常見）。改走區網下載。')
    }
  } else {
    console.log('沒有可用的 adb device（USB 偵錯未開或沒接上）。改走區網下載。')
  }
} else {
  console.log('本機找不到 adb。改走區網下載。')
}

console.log('')
console.log('正在開檔案總管到 APK 資料夾...')
try {
  execFileSync('explorer.exe', [`/select,${apkDst}`])
} catch {
  /* ignore */
}

console.log('')
console.log('接著會開區網下載頁（含 QR）。手機跟電腦同一個 Wi-Fi，掃碼即可下載安裝。')
console.log('裝完後關掉那個「DeST APK serve」視窗即可。')
console.log('')

// cmd start 才能穩定跳出可見視窗；PowerShell detached 在這台常默默失敗
const serveBat = path.join(outDir, '_serve-once.cmd')
fs.writeFileSync(
  serveBat,
  [
    '@echo off',
    `cd /d "${root}"`,
    'title DeST APK serve',
    'node scripts\\serve-apk.mjs',
    'echo.',
    'if errorlevel 1 echo serve failed',
    'pause'
  ].join('\r\n'),
  'utf8'
)
spawn('cmd.exe', ['/c', 'start', 'DeST APK serve', serveBat], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: false
}).unref()

console.log('測試提醒（這輪的變更）：')
console.log('  1. 設定 → 天氣 → 「自動偵測位置」應跳定位權限；允許後顯示「（裝置定位）」')
console.log('  2. 拒絕權限再按一次：應退回 IP 並顯示「（連線位置推估）」，不是報錯')
console.log('  3. 按「立即更新」應出現氣溫濕度')
console.log('  4. 開著天氣送一則訊息 → 完整 Prompt 裡要看得到 [Weather] 區塊')
console.log('  5. 設定 → 與電腦同步 → 掃 QR → 電腦的潤飾／CWA 設定會過來，但**地點不會被蓋掉**')
console.log('  6. 同一顆按鈕再按一次：設定更新，角色與對話數量不變')

console.log('')
console.log(`本機 IP 提示：${Object.values(os.networkInterfaces()).flat().find((x) => x && x.family === 'IPv4' && !x.internal)?.address ?? '未知'}`)
console.log('打包流程結束。請看另開的 serve 視窗與 QR 圖。')
