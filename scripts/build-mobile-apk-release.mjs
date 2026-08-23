/**
 * DeST 手機獨立版：建置**正式簽章** release APK。
 *
 * 跟 `build-mobile-apk.mjs`（debug、隨手裝機測試用）是姊妹腳本，差異只有：
 * ①要求 `android/keystore.properties` 一定要存在，不存在就直接失敗，
 * **絕不悄悄退回成未簽章／debug 簽章**——那樣裝起來看起來沒事，
 * 卻是一顆下次沒辦法覆蓋更新的地雷。②跑 `assembleRelease` 而非
 * `assembleDebug`。③預設不 adb 自動裝機（release 是要拿去發布的檔案，
 * 不該被開發機的舊安裝記錄干擾；真要測可以自己 `adb install -r`）。
 *
 * keystore 怎麼來、密碼怎麼保管：`docs/pre-b3-work-assessment.md` §9。
 * **這支腳本、還有它呼叫的 `prepare-android.mjs`，都不會產生或讀取密碼明文
 * 印出到終端機**——密碼只會被 Gradle 讀去簽章，不會經過這支 Node 程式。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const jdk21 = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot'
const keystoreProps = path.join(root, 'android', 'keystore.properties')
const apkSrc = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
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
console.log('=== DeST 正式簽章 release APK ===')
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

if (!fs.existsSync(keystoreProps)) {
  fail(
    '找不到 android/keystore.properties，拒絕建置未簽章的 release APK。\n\n' +
      '先照 docs/pre-b3-work-assessment.md §9 產生 keystore（在你自己的機器上、\n' +
      '自己的終端機執行 keytool，不要透過 AI），然後在 android/ 底下建立\n' +
      'keystore.properties，四行：\n\n' +
      '  storeFile=你的 .jks 絕對路徑（例如 D:/secure/dest-release.jks）\n' +
      '  storePassword=你的 keystore 密碼\n' +
      '  keyAlias=dest\n' +
      '  keyPassword=你的 key 密碼\n\n' +
      '這個檔案已被 .gitignore 擋兩層，不會進版控。'
  )
}

const env = {
  ...process.env,
  JAVA_HOME: jdk21,
  Path: `${jdk21}\\bin;${process.env.Path || process.env.PATH || ''}`,
  PATH: `${jdk21}\\bin;${process.env.PATH || process.env.Path || ''}`
}

console.log(`[1/4] JAVA_HOME = ${env.JAVA_HOME}`)
console.log('[2/4] build:mobile + cap sync android（會順便把簽章設定接進 build.gradle）...')
run('npm.cmd', ['run', 'sync:android'], { env, shell: true })

console.log('[3/4] gradlew assembleRelease ...')
run(path.join(root, 'android', 'gradlew.bat'), ['assembleRelease'], {
  cwd: path.join(root, 'android'),
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

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.mkdirSync(outDir, { recursive: true })
const apkDst = path.join(outDir, `DeST-v${pkg.version}-release.apk`)
fs.copyFileSync(apkSrc, apkDst)
const sizeMb = (fs.statSync(apkDst).size / (1024 * 1024)).toFixed(1)

console.log('')
console.log(`[4/4] 完成：${apkDst}  (${sizeMb} MB)`)
console.log('')
console.log('這是正式簽章的檔案，可以直接發布。發布前建議先手動裝到一台')
console.log('（或多台）真機驗證一輪，尤其是「能不能蓋掉舊版正常升級」這件事——')
console.log('第一次發正式簽章版時沒有舊版可蓋，這條之後才驗得到。')
