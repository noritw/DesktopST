import type { HttpAdapter } from '../adapters'
import { wmoToDesc } from './wmo'

/**
 * 天氣查詢需要的平台能力。
 *
 * 形狀比照 `LLMDeps`：包成物件而不是直接收 `HttpAdapter`，日後要加東西才不必改所有簽名。
 *
 * 為什麼要注入而不是直接用全域 `fetch`：手機端的全域 `fetch` 被
 * CapacitorHttp patch 掉才繞得過 WebView 的 CORS，而那個 patch 是在
 * plugin 初始化後才生效。走 adapter 才能確保拿到的是 patch 過的那個
 * （理由同 `mobile/adapters/httpAdapter.ts` 的註解）。
 */
export interface WeatherDeps {
  http: HttpAdapter
}

export interface WeatherData {
  description: string
  temperatureC: number
  humidity: number
  windSpeed: number
}

export interface GeoPoint {
  name: string
  lat: number
  lon: number
}

/** 對外部服務的逾時。天氣是聊天的背景配料，不值得讓使用者等。 */
const TIMEOUT_MS = 5000

async function getJson(http: HttpAdapter, url: string): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await http.fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 地名 → 座標。 */
export async function geocodeCity(deps: WeatherDeps, name: string): Promise<GeoPoint | null> {
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
    `&count=1&language=zh`
  const json = (await getJson(deps.http, url)) as {
    results?: Array<{ name: string; latitude: number; longitude: number }>
  } | null
  const r = json?.results?.[0]
  if (!r) return null
  return { name: r.name, lat: r.latitude, lon: r.longitude }
}

/**
 * 座標 → 地名（反向地理編碼）。
 *
 * Open-Meteo 的地理編碼**只有正向**，所以這支換一家。BigDataCloud 的
 * `reverse-geocode-client` 是給前端直接打的免金鑰端點。
 *
 * 手機用 GPS 定位時只拿得到經緯度，但 `locationName` 要拿來組
 * `[Weather]` 那行、也是 wttr.in 備援與 CWA 縣市的依據，不能空著。
 */
export async function reverseGeocode(
  deps: WeatherDeps,
  lat: number,
  lon: number
): Promise<string | null> {
  const url =
    `https://api-bdc.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}` +
    `&localityLanguage=zh`
  const json = (await getJson(deps.http, url)) as {
    city?: string
    locality?: string
    principalSubdivision?: string
  } | null
  if (!json) return null
  const name = json.city || json.locality || json.principalSubdivision || ''
  return name.trim() || null
}

/**
 * 用對外 IP 猜位置。
 *
 * 兩家依序試。ip-api 排第一是因為它給**中文**市名，換成英文的會讓
 * `[Weather]` 那行突然變成 `Taipei：晴天`。
 *
 * ip-api 免費版只有明文 HTTP。這裡可以接受：請求不含任何使用者資料，
 * 回應揭露的「你在哪個城市」本來就是網路業者從 IP 就看得到的東西。
 * 真正在意精確位置的是 GPS 那條路，走的是裝置本機、根本不出網路。
 */
export async function detectLocationByIP(deps: WeatherDeps): Promise<GeoPoint | null> {
  const viaIpApi = (await getJson(
    deps.http,
    'http://ip-api.com/json/?lang=zh-TW&fields=city,lat,lon,status'
  )) as { status?: string; city?: string; lat?: number; lon?: number } | null
  if (viaIpApi?.status === 'success' && typeof viaIpApi.lat === 'number') {
    return { name: viaIpApi.city || '', lat: viaIpApi.lat, lon: viaIpApi.lon as number }
  }

  // 備援：ip-api 有 45 次／分鐘的限制，共用出口 IP 的環境會撞到
  const viaIpWho = (await getJson(deps.http, 'https://ipwho.is/')) as {
    success?: boolean
    city?: string
    latitude?: number
    longitude?: number
  } | null
  if (viaIpWho?.success && typeof viaIpWho.latitude === 'number') {
    return {
      name: viaIpWho.city || '',
      lat: viaIpWho.latitude,
      lon: viaIpWho.longitude as number
    }
  }

  return null
}

export async function fetchWeatherOpenMeteo(
  deps: WeatherDeps,
  lat: number,
  lon: number
): Promise<WeatherData | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
  const json = (await getJson(deps.http, url)) as {
    current?: {
      temperature_2m: number
      relative_humidity_2m: number
      weather_code: number
      wind_speed_10m: number
    }
  } | null
  const c = json?.current
  if (!c) return null
  return {
    description: wmoToDesc(c.weather_code),
    temperatureC: Math.round(c.temperature_2m),
    humidity: Math.round(c.relative_humidity_2m),
    windSpeed: Math.round(c.wind_speed_10m * 10) / 10
  }
}

export async function fetchWeatherWttrIn(
  deps: WeatherDeps,
  locationName: string
): Promise<WeatherData | null> {
  const url = `https://wttr.in/${encodeURIComponent(locationName)}?format=j1`
  const json = (await getJson(deps.http, url)) as {
    current_condition?: Array<{
      temp_C: number
      humidity: number
      weatherDesc: Array<{ value: string }>
      windspeedKmph: number
    }>
  } | null
  const c = json?.current_condition?.[0]
  if (!c) return null
  return {
    description: c.weatherDesc?.[0]?.value || '未知',
    temperatureC: Math.round(c.temp_C),
    humidity: Math.round(c.humidity),
    windSpeed: Math.round(c.windspeedKmph / 3.6 * 10) / 10
  }
}

/** Open-Meteo 為主，掛掉時退 wttr.in（需要地名，所以只在有名字時才試）。 */
export async function fetchWeather(
  deps: WeatherDeps,
  lat: number,
  lon: number,
  locationName: string
): Promise<WeatherData | null> {
  const data = await fetchWeatherOpenMeteo(deps, lat, lon)
  if (data) return data
  if (!locationName) return null
  return fetchWeatherWttrIn(deps, locationName)
}

export function buildWeatherTemplate(locationName: string, data: WeatherData): string {
  return `[Weather]\n${locationName}：${data.description}，氣溫 ${data.temperatureC}°C，` +
    `濕度 ${data.humidity}%，風速 ${data.windSpeed} m/s`
}
