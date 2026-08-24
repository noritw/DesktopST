/**
 * DeST 飲食記錄：建置**正式簽章** release APK。
 *
 * 跟 `build-nutrition-apk.mjs`（debug、隨手裝機測試用）是姊妹腳本，差異只有：
 * ①要求 `nutrition/mobile/android/keystore.properties` 一定要存在，不存在就
 * 直接失敗，**絕不悄悄退回成未簽章／debug 簽章**——那樣裝起來看起來沒事，
 * 卻是一顆下次沒辦法覆蓋更新的地雷。②跑 `assembleRelease` 而非
 * `assembleDebug`。③預設不 adb 自動裝機（release 是要拿去發布的檔案，
 * 不該被開發機的舊安裝記錄干擾；真要測可以自己 `adb install -r`）。
 *
 * 沿用 DeST 主體同一把 keystore（`android/keystore.properties`），
 * 因為兩個 App 的 applicationId 不同（`tw.nori.dest` vs `tw.nori.destnutrition`），
 * 同一把金鑰簽多個 App 不會互相干擾。這支腳本、還有它呼叫的 Gradle，
 * 都不會把密碼明文印到終端機——密碼只會被 Gradle 讀去簽章。
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
const keystoreProps = path.join(androidRoot, 'keystore.properties')
const apkSrc = path.join(androidRoot, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const outDir = path.join(root, 'out', 'apk')

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
console.log('=== DeST 飲食記錄 正式簽章 release APK ===')
console.log('')

if (!fs.existsSync(jdk21)) {
  fail(
    `找不到 JDK 21：${jdk21}\n` +
      'Gradle 不能用 Android Studio 的 jbr。請先裝 Adoptium JDK 21。'
  )
}

if (!fs.existsSync(path.join(androidRoot, 'gradlew.bat'))) {
  fail('找不到 nutrition/mobile/android/gradlew.bat。請先建立 Android project。')
}

if (!fs.existsSync(keystoreProps)) {
  fail(
    '找不到 nutrition/mobile/android/keystore.properties，拒絕建置未簽章的 release APK。\n\n' +
      '如果已經有 DeST 主體的 android/keystore.properties，直接沿用同一把即可，\n' +
      '在 nutrition/mobile/android/ 底下建立同樣四行的 keystore.properties：\n\n' +
      '  storeFile=你的 .jks 絕對路徑\n' +
      '  storePassword=你的 keystore 密碼\n' +
      '  keyAlias=dest\n' +
      '  keyPassword=你的 key 密碼\n\n' +
      '這個檔案已被根目錄 .gitignore 的 `keystore.properties` 規則擋住，不會進版控。'
  )
}

const env = {
  ...process.env,
  JAVA_HOME: jdk21,
  Path: `${jdk21}\\bin;${process.env.Path || process.env.PATH || ''}`,
  PATH: `${jdk21}\\bin;${process.env.PATH || process.env.Path || ''}`
}

console.log(`[1/4] JAVA_HOME = ${env.JAVA_HOME}`)
console.log('[2/4] build:nutrition:mobile + cap sync android...')
run('npm.cmd', ['run', 'sync:nutrition:android'], { env, shell: true })

console.log('[3/4] gradlew assembleRelease ...')
run(path.join(androidRoot, 'gradlew.bat'), ['assembleRelease'], {
  cwd: androidRoot,
  env,
  shell: true
})

if (!fs.existsSync(apkSrc)) {
  fail(
    `建置結束但找不到 APK：${apkSrc}\n` +
      '常見原因：keystore.properties 裡的密碼或路徑錯了——Gradle 通常會在\n' +
      '上面的建置輸出裡印出明確的簽章錯誤，往上翻看看。'
  )
}

const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
fs.mkdirSync(outDir, { recursive: true })
const apkDst = path.join(outDir, `DeST飲食記錄-v${pkg.version}-release.apk`)
fs.copyFileSync(apkSrc, apkDst)
const sizeMb = (fs.statSync(apkDst).size / (1024 * 1024)).toFixed(1)

console.log('')
console.log(`[4/4] 完成：${apkDst}  (${sizeMb} MB)`)
console.log('')
console.log('這是正式簽章的檔案，可以直接發布。發布前建議先手動裝到一台')
console.log('（或多台）真機驗證一輪，尤其是「能不能蓋掉舊版正常升級」這件事——')
console.log('第一次發正式簽章版時沒有舊版可蓋，這條之後才驗得到。')
