/**
 * DeST 飲食記錄：建置 debug APK，接著 USB 有裝置就直接安裝。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const jdk21 = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot'
const mobileRoot = path.join(root, 'nutrition', 'mobile')
const androidRoot = path.join(mobileRoot, 'android')
const apkPath = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')

function fail(message, code = 1) {
  console.error(message)
  process.exit(code)
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    env: options.env || process.env,
    stdio: 'inherit',
    shell: options.shell ?? false
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

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }

  const result = spawnSync('where.exe', ['adb'], { encoding: 'utf8' })
  const first = (result.stdout || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return first && fs.existsSync(first) ? first : null
}

function getDevice(adb) {
  const result = spawnSync(adb, ['devices'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  return (result.stdout || '')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .find(([serial, state]) => serial && state === 'device')?.[0] ?? null
}

if (!fs.existsSync(jdk21)) {
  fail(`找不到 JDK 21：${jdk21}\n請安裝 Adoptium JDK 21；不要使用 Android Studio 的 JBR。`)
}
if (!fs.existsSync(path.join(androidRoot, 'gradlew.bat'))) {
  fail('找不到 nutrition/mobile/android/gradlew.bat。請先建立 Android project。')
}

const env = {
  ...process.env,
  JAVA_HOME: jdk21,
  Path: `${jdk21}\\bin;${process.env.Path || process.env.PATH || ''}`,
  PATH: `${jdk21}\\bin;${process.env.PATH || process.env.Path || ''}`
}

console.log('')
console.log('=== DeST 飲食記錄 APK 一鍵建置／安裝 ===')
console.log('')
console.log('[1/3] build mobile + Capacitor sync ...')
run('npm.cmd', ['run', 'sync:nutrition:android'], { env, shell: true })

console.log('[2/3] assembleDebug ...')
// 用絕對路徑呼叫：某些環境（NoDefaultCurrentDirectoryInExePath）下 cmd 不會搜尋
// 目前目錄，只寫 'gradlew.bat' 會 not recognized。
run(path.join(androidRoot, 'gradlew.bat'), ['assembleDebug'], { cwd: androidRoot, env, shell: true })

if (!fs.existsSync(apkPath)) fail(`建置完成但找不到 APK：${apkPath}`)

console.log('[3/3] USB install ...')
const adb = findAdb()
if (!adb) fail('找不到 adb.exe。請確認 Android SDK platform-tools 已安裝。')

const device = getDevice(adb)
if (!device) {
  fail('找不到已授權的 USB 裝置。請確認 USB 偵錯已開啟，並在手機上允許這台電腦。')
}

run(adb, ['-s', device, 'install', '-r', apkPath])
console.log('')
console.log(`已安裝到 ${device}：${apkPath}`)
console.log('正在啟動 DeST 飲食記錄...')
run(adb, ['-s', device, 'shell', 'monkey', '-p', 'tw.nori.destnutrition', '1'])
