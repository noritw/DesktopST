/**
 * `cap sync` 之後要補的 Android 設定。
 *
 * ## 為什麼需要這支
 *
 * `android/` 是 gitignored（每個人自己 `cap add android` 產生），所以任何對
 * `AndroidManifest.xml` 的修改都不會進版控 —— 換台機器、或重新 add 一次平台，
 * 改動就沒了。與其在 README 寫「請記得手動加」，不如讓它每次 sync 都自動補上。
 *
 * ## 補什麼
 *
 * **`android:usesCleartextTraffic="true"`**：Android 9 以後預設禁止明文 HTTP。
 * 手機要連使用者自己電腦上的 `http://192.168.x.x:3721`（S1 初始化匯入、區網遙控），
 * 沒有這個旗標會直接被系統擋掉，而且錯誤長得像「連不上」，很難查。
 *
 * 這與 `capacitor.config.ts` 的 `allowMixedContent` 是同一個立場：
 * **不禁止區網 http**（正式 API 一律走 https，那是另一回事）。
 * 電腦端是使用者自己的機器，沒有憑證可簽，要求 https 等於要求使用者裝自簽憑證。
 *
 * **`ACCESS_COARSE_LOCATION`**：天氣定位要用。
 * ⚠️ `@capacitor/geolocation` 的 AndroidManifest 是**空的**，權限不會自動合併進來。
 * 少了它不會有編譯錯誤，APK 照樣裝得起來，只是 `requestPermissions()` 永遠被拒，
 * 畫面上只看得到「定位失敗」—— 而且要在真機上才發現。
 *
 * **只要粗略位置。** 天氣是縣市級的，`ACCESS_FINE_LOCATION` 純屬過度索取，
 * 而且 Android 會多跳一層「精確／大概」讓使用者猶豫。
 * 要改精度的話，`src/mobile/runtime/weather.ts` 請求的權限別名要一起改。
 *
 * ## 還有版本號
 *
 * `cap add android` 產生的 `app/build.gradle` 寫死 `versionCode 1` / `versionName "1.0"`，
 * 於是 Android「設定 → 應用程式」和 `adb shell dumpsys package` 永遠顯示 1.0，
 * 跟 `package.json` 毫無關係。裝了兩個版本也分不出誰是誰。
 * 這裡每次 sync 都從 `package.json` 同步過去。
 *
 * 冪等：已經有的不重複加、值一樣就不寫檔。
 */
import fs from 'node:fs'
import path from 'node:path'

const REQUIRED_PERMISSIONS = ['android.permission.ACCESS_COARSE_LOCATION']

const root = process.cwd()
const manifestPath = path.resolve(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const gradlePath = path.resolve(root, 'android', 'app', 'build.gradle')

if (!fs.existsSync(manifestPath)) {
  console.log('[prepare-android] 沒有 android/ 平台，略過（先跑 npx cap add android）')
  process.exit(0)
}

let xml = fs.readFileSync(manifestPath, 'utf8')
const changes = []

if (xml.includes('android:usesCleartextTraffic')) {
  console.log('[prepare-android] usesCleartextTraffic 已存在，不動')
} else {
  const patched = xml.replace(/<application\b/, '<application\n        android:usesCleartextTraffic="true"')
  if (patched === xml) {
    console.error('[prepare-android] ⚠️ 找不到 <application>，manifest 格式與預期不同，沒有改動')
    process.exit(1)
  }
  xml = patched
  changes.push('usesCleartextTraffic（區網 http 直連需要）')
}

const missing = REQUIRED_PERMISSIONS.filter((p) => !xml.includes(p))
if (missing.length > 0) {
  const lines = missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n')
  const patched = xml.replace('</manifest>', `${lines}\n</manifest>`)
  if (patched === xml) {
    console.error('[prepare-android] ⚠️ 找不到 </manifest>，權限沒補上')
    process.exit(1)
  }
  xml = patched
  changes.push(`權限 ${missing.join('、')}`)
}

if (changes.length > 0) {
  fs.writeFileSync(manifestPath, xml, 'utf8')
  console.log(`[prepare-android] ✅ 已補上：${changes.join('；')}`)
} else {
  console.log('[prepare-android] manifest 沒有要補的東西')
}

syncGradleVersion()

/**
 * 把 `package.json` 的版本同步進 build.gradle。
 *
 * `versionCode` 必須是遞增整數，所以用 major*10000 + minor*100 + patch 壓成一個數
 * （0.4.0 → 400）。前提是 minor 與 patch 不會超過 99，對這個專案綽綽有餘。
 */
function syncGradleVersion() {
  if (!fs.existsSync(gradlePath)) return

  const pkg = JSON.parse(fs.readFileSync(path.resolve(root, 'package.json'), 'utf8'))
  const version = String(pkg.version ?? '').trim()
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!m) {
    console.log(`[prepare-android] package.json 版本「${version}」不是 x.y.z，略過版本同步`)
    return
  }
  const code = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])

  const before = fs.readFileSync(gradlePath, 'utf8')
  const after = before
    .replace(/versionCode\s+\d+/, `versionCode ${code}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`)

  if (after === before) {
    console.log(`[prepare-android] 版本已是 ${version}（code ${code}），不動`)
    return
  }
  if (!after.includes(`versionName "${version}"`)) {
    console.error('[prepare-android] ⚠️ build.gradle 找不到 versionName，版本沒同步')
    return
  }
  fs.writeFileSync(gradlePath, after, 'utf8')
  console.log(`[prepare-android] ✅ 版本同步為 ${version}（versionCode ${code}）`)
}
