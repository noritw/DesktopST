/**
 * DeST 飲食記錄：建置**正式簽章** release APK，並直接 USB 裝到手機、啟動。
 *
 * `NutritionAPK.bat` 原本呼叫 `build-nutrition-apk.mjs`（debug 簽章）。
 * 2026-08-25 owner 手機上裝的是正式簽章版，debug 簽章蓋不上去
 * （`adb install -r` 回 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`），
 * 而那個失敗訊息淹沒在一大串 Gradle 輸出裡，症狀變成「APK 建置看起來成功、
 * 但手機上版本沒變」——跟 DeST 主體 `mobile-tool.mjs` 的 `actionReleaseApk`
 * 2026-08-24 撞到的是同一個坑，這裡改用同一套解法：全程走正式簽章。
 *
 * 建置本身沿用 `build-nutrition-apk-release.mjs`（keystore 檢查、
 * assembleRelease、複製到 `out/apk/`），這支只多做「裝機＋啟動」。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findAdb, hasAdbDevice } from './adbHelpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const mobileRoot = path.join(root, 'nutrition', 'mobile')

function fail(msg, code = 1) {
  console.error(msg)
  process.exit(code)
}

console.log('')
console.log('=== DeST 飲食記錄 正式簽章 APK 一鍵建置／安裝 ===')
console.log('')
console.log('[1/2] 建置正式簽章 APK（node scripts/build-nutrition-apk-release.mjs）...')
const build = spawnSync('node', ['scripts/build-nutrition-apk-release.mjs'], { cwd: root, stdio: 'inherit', shell: true })
if (build.status !== 0) fail('建置失敗，上面有錯誤訊息。', build.status ?? 1)

const pkg = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'package.json'), 'utf8'))
const apkPath = path.join(root, 'out', 'apk', `DeSTNutrition-v${pkg.version}-release.apk`)
if (!fs.existsSync(apkPath)) fail(`建置完成但找不到 APK：${apkPath}`)

console.log('')
console.log('[2/2] USB install ...')
const adb = findAdb()
if (!adb) fail('找不到 adb.exe。請確認 Android SDK platform-tools 已安裝。')
if (!hasAdbDevice(adb)) {
  fail('找不到已授權的 USB 裝置。請確認 USB 偵錯已開啟，並在手機上允許這台電腦。')
}

const install = spawnSync(adb, ['install', '-r', apkPath], { stdio: 'inherit' })
if (install.status !== 0) {
  fail(
    'adb install 失敗。\n' +
      '如果錯誤是 INSTALL_FAILED_UPDATE_INCOMPATIBLE：手機上裝的版本簽章跟這把\n' +
      'keystore 不一樣（例如手動裝過別人建的 APK），要先手動解除安裝再重跑一次\n'+
      '（會清掉食記在手機上的資料，AI 服務金鑰要重新設定或重新從 DeST 匯入）。'
  )
}

console.log('')
console.log(`已安裝：${apkPath}`)
console.log('正在啟動 DeST 飲食記錄...')
spawnSync(adb, ['shell', 'monkey', '-p', 'tw.nori.destnutrition', '1'], { stdio: 'inherit' })
