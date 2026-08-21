/**
 * 桌面的天氣入口 —— **邏輯本體已搬到 `core/weather/`**，這裡只補上兩件平台的事：
 *
 * 1. 注入 Electron 的 HTTP adapter（core 不許碰平台 API）
 * 2. 關鍵詞即時查詢（地震／颱風）仍是桌面限定，見 `cwaService.ts`
 *
 * 手機獨立版走同一份 core，所以 WMO 對照表、Open-Meteo 參數、
 * `[Weather]` 的排版都只有一份。
 */
import {
  detectLocationByIP as coreDetectLocationByIP,
  fetchWeather as coreFetchWeather,
  fetchWeatherOpenMeteo as coreFetchWeatherOpenMeteo,
  fetchWeatherWttrIn as coreFetchWeatherWttrIn,
  geocodeCity as coreGeocodeCity,
  getWeatherContextString as coreGetWeatherContextString,
  polishWeatherDescription as corePolishWeatherDescription,
  type WeatherData
} from '../core/weather'
import { electronHttp } from './adapters/httpAdapter'
import { detectQueryType, fetchCwaData } from './cwaService'
import type { AppSettings } from './types'

const deps = { http: electronHttp }

export type { WeatherData }
export {
  buildWeatherTemplate,
  getCachedWeatherData,
  invalidateWeatherCache
} from '../core/weather'

export function geocodeCity(name: string): Promise<{ name: string; lat: number; lon: number } | null> {
  return coreGeocodeCity(deps, name)
}

export async function detectLocationByIP(): Promise<{ city: string; lat: number; lon: number } | null> {
  const hit = await coreDetectLocationByIP(deps)
  return hit ? { city: hit.name, lat: hit.lat, lon: hit.lon } : null
}

export function fetchWeatherOpenMeteo(lat: number, lon: number): Promise<WeatherData | null> {
  return coreFetchWeatherOpenMeteo(deps, lat, lon)
}

export function fetchWeatherWttrIn(locationName: string): Promise<WeatherData | null> {
  return coreFetchWeatherWttrIn(deps, locationName)
}

export function fetchWeather(lat: number, lon: number, locationName: string): Promise<WeatherData | null> {
  return coreFetchWeather(deps, lat, lon, locationName)
}

export function polishWeatherDescription(
  locationName: string,
  data: WeatherData,
  settings: AppSettings
): Promise<string> {
  return corePolishWeatherDescription(locationName, data, settings, deps)
}

/** 取得天氣注入字串（附快取）。settings 不符條件時回 null。 */
export function getWeatherContextString(settings: AppSettings): Promise<string | null> {
  return coreGetWeatherContextString(settings, deps)
}

export interface RealtimeQueryContextResult {
  injectionText: string | null
  /** 若查詢到颱風，回傳中文颱風名（供災害新聞補搜用） */
  typhoonName?: string
}

/**
 * 即時氣象查詢：偵測使用者訊息中的氣象關鍵詞，命中時向中央氣象署查詢並回傳注入字串。
 * 功能未啟用、無 Key、或查詢失敗時靜默回傳 null。
 *
 * **桌面限定** —— 手機獨立版目前只有背景 `[Weather]`，沒有這條關鍵詞路徑。
 */
export async function getRealtimeQueryContextString(
  userMessage: string,
  settings: AppSettings
): Promise<RealtimeQueryContextResult> {
  const rq = settings.weather?.realtimeQuery
  if (!rq?.enabled || !rq.cwaApiKey) return { injectionText: null }

  const type = detectQueryType(userMessage)
  if (!type) return { injectionText: null }

  // 載入時已經解過密；解不開的值會原樣留著密文，那種情況當作沒金鑰
  const apiKey = rq.cwaApiKey
  if (apiKey.startsWith('enc:v1:')) return { injectionText: null }

  const county = rq.forecastCounty || settings.weather?.locationName || ''

  try {
    const result = await fetchCwaData(type, apiKey, county)
    return { injectionText: result.injectionText, typhoonName: result.typhoonName }
  } catch (e) {
    console.warn('[cwa] realtime query failed:', (e as Error).message)
    return { injectionText: null }
  }
}
