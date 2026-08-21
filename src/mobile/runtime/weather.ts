import { detectLocationByIP, reverseGeocode, type WeatherDeps } from '@core/weather'
import type { WeatherLocationSource } from '@core/types'

export interface DetectedLocation {
  name: string
  lat: number
  lon: number
  source: Extract<WeatherLocationSource, 'gps' | 'ip'>
}

/**
 * GPS 逾時。比天氣本身的 5 秒寬 ——冷啟動時 Android 要等定位晶片
 * 拿到第一個 fix，室內尤其慢；太短會讓每次都白等一輪再退回 IP。
 */
const GPS_TIMEOUT_MS = 10000

/**
 * 不要相信 plugin 自己的 `timeout`。
 *
 * `Geolocation.getCurrentPosition({ timeout })` 在 Android 上不保證會兌現——
 * 沒有定位權限或定位服務關閉時，那個 Promise 可能永遠不 settle，
 * 於是 `detectMobileLocation` 連「退回 IP」都走不到，UI 就一直轉圈
 * （owner 2026-08-09 回報「按抓取位置卡在那邊很久」）。
 * 外面再包一層自己控的計時器，逾時就當作定位失敗往下走。
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    work,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))
  ])
}

/**
 * 讀取 Capacitor 的 Geolocation plugin。
 *
 * **動態 import 是刻意的。** 手機 UI 也跑在瀏覽器（`dev:mobile` 煙測）與
 * vitest 裡，那些環境沒有原生 plugin。靜態 import 會讓整個模組在載入時就炸，
 * 連「退回 IP 定位」都走不到。
 */
async function loadGeolocation(): Promise<{
  plugin: typeof import('@capacitor/geolocation').Geolocation
} | null> {
  try {
    const mod = await import('@capacitor/geolocation')
    /*
     * ⚠️ **一定要包在物件裡，不可以直接 `return mod.Geolocation`。**
     *
     * async function 回傳時，JS 會去摸回傳值的 `.then` 判斷它是不是 thenable；
     * 而 Capacitor 的 plugin proxy **把任何屬性存取都當成原生方法呼叫**，
     * 於是那一摸就變成呼叫原生的 `Geolocation.then()`：
     *
     *   Uncaught (in promise) Error: "Geolocation.then()" is not implemented on android
     *
     * 原生端沒有這個方法、也就不會回呼 resolve／reject，
     * 外面那個 `await loadGeolocation()` 就**永遠卡住** ——
     * 連權限對話框都跳不出來（owner 2026-08-09 實機回報「按抓取位置卡住」）。
     * 包一層普通物件，`.then` 是 undefined，這條路才走得下去。
     */
    return { plugin: mod.Geolocation }
  } catch {
    return null
  }
}

/**
 * 用裝置 GPS 定位。拿不到就回 `null`，由呼叫端退回 IP。
 *
 * 權限被拒**不是錯誤**：使用者本來就有權不給定位，退回 IP 仍然能用。
 * 所以這裡一律吞掉例外，不往上拋。
 */
async function locateByGps(deps: WeatherDeps): Promise<DetectedLocation | null> {
  const loaded = await loadGeolocation()
  if (!loaded) return null
  const Geolocation = loaded.plugin

  try {
    /*
     * **只要粗略位置。** 天氣是縣市級的，`ACCESS_FINE_LOCATION` 純屬過度索取，
     * 而且 Android 會多跳一層「精確／大概」讓使用者猶豫。
     * AndroidManifest 也只宣告了 `ACCESS_COARSE_LOCATION`，兩邊要一致。
     */
    const status = await withTimeout(Geolocation.checkPermissions(), GPS_TIMEOUT_MS)
    if (!status) return null
    if (status.coarseLocation !== 'granted' && status.location !== 'granted') {
      // 權限對話框要等使用者按，給寬一點；不回應就當作沒給。
      const asked = await withTimeout(
        Geolocation.requestPermissions({ permissions: ['coarseLocation'] }),
        GPS_TIMEOUT_MS * 3
      )
      if (!asked) return null
      if (asked.coarseLocation !== 'granted' && asked.location !== 'granted') return null
    }

    const pos = await withTimeout(
      Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: GPS_TIMEOUT_MS }),
      GPS_TIMEOUT_MS
    )
    if (!pos) return null
    const lat = pos.coords.latitude
    const lon = pos.coords.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null

    /*
     * 座標本身就夠查天氣了，但 `locationName` 還要拿來顯示、組 `[Weather]`
     * 那行、以及當 CWA 縣市的備援，所以反查一次地名。
     * 反查失敗不算失敗——寧可顯示「目前位置」也不要整個定位白做。
     */
    const name = (await reverseGeocode(deps, lat, lon)) ?? '目前位置'
    return { name, lat, lon, source: 'gps' }
  } catch {
    return null
  }
}

/**
 * 手機定位：**GPS 優先，退回 IP**。
 *
 * 順序跟桌面相反是因為手機會移動。桌面只有對外 IP 可用，而 IP 常常落在
 * 電信商的機房，出門在外會直接指到別的縣市；手機有定位硬體，沒理由不用。
 */
export async function detectMobileLocation(deps: WeatherDeps): Promise<DetectedLocation | null> {
  const gps = await locateByGps(deps)
  if (gps) return gps

  const ip = await detectLocationByIP(deps)
  if (!ip) return null
  return { name: ip.name || '目前位置', lat: ip.lat, lon: ip.lon, source: 'ip' }
}
