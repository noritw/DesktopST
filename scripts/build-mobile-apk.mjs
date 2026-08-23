/**
 * DeST 手機獨立版：建置 debug APK，接著 USB 有裝置就直接裝上去。
 *
 * 由 `scripts/mobile-tool.mjs`（MobileST.bat）呼叫，也可以單獨跑。
 * 用 Node 而不是 PowerShell，是因為 PS 5.1 讀 UTF-8 無 BOM 會炸。
 *
 * 這支只負責「產出並安裝」；區網 QR 下載頁是 mobile-tool 的事，不要在這裡開，
 * 否則單獨跑一次就會冒出一個關不掉的 serve 視窗。
 */
import { spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tryAdbInstall } from './adbHelpers.mjs'

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
// ⚠️ 裸檔名在有些機器會找不到：Windows 的 NoDefaultCurrentDirectoryInExePath=1
// （安全性設定）會關掉 cmd.exe 用 cwd 找可執行檔的行為，`shell:true` 底下
// 跑 'gradlew.bat' 就會回「不是內部或外部命令」，即使 cwd 設對了。用絕對路徑繞過。
run(path.join(root, 'android', 'gradlew.bat'), ['assembleDebug'], {
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

const installed = tryAdbInstall(apkDst)

if (!installed) {
  try {
    execFileSync('explorer.exe', [`/select,${apkDst}`])
  } catch {
    /* 開不開檔案總管無關緊要 */
  }
}

console.log('')
// 只挑「第一個非內部 IPv4」的話，裝了 Tailscale／VPN 的電腦常會先列出虛擬網卡
// （100.64.0.0/10 那段），這個提示就會印一個手機根本連不到的位址——優先挑真正
// 的私有網段（192.168.x／10.x／172.16-31.x），跟 `serve-apk.mjs` 的 `pickLanIPv4()`
// 用同一套判斷（2026-08-24，qr-entry-merge-plan.md 那次順手一起修）。
function pickHintIp() {
  const addrs = Object.values(os.networkInterfaces()).flat().filter((x) => x && x.family === 'IPv4' && !x.internal)
  const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  return addrs.find((x) => isPrivate(x.address))?.address ?? addrs[0]?.address ?? '未知'
}
console.log(`本機 IP 提示：${pickHintIp()}`)
