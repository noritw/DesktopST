import type { AppSettings } from './types'
import { applyUtilitySettings } from './llm/index'
import { chatWithLLM } from './llm/index'

// WMO weather interpretation codes → 中文描述
const WMO_DESC: Record<number, string> = {
  0: '晴天', 1: '大致晴天', 2: '局部多雲', 3: '陰天',
  45: '起霧', 48: '霧凇',
  51: '細毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
  80: '陣雨', 81: '中陣雨', 82: '強陣雨',
  85: '陣雪', 86: '大陣雪',
  95: '雷陣雨', 96: '雷陣雨夾冰雹', 99: '強雷陣雨夾冰雹'
}

function wmoToDesc(code: number): string {
  return WMO_DESC[code] ?? '未知'
}

export interface WeatherData {
  description: string
  temperatureC: number
  humidity: number
  windSpeed: number
}

// In-memory cache – resets on app restart
let cache: {
  locationName: string
  data: WeatherData
  template: string
  polished?: string
  fetchedAt: number
  polishedAt?: number  // 獨立追蹤 polish 時間，跨天氣刷新週期延用
} | null = null
const CACHE_TTL = 30 * 60 * 1000  // 天氣資料：30 分鐘
const POLISH_TTL = 5 * 60 * 1000  // 潤飾結果：5 分鐘

export function invalidateWeatherCache(): void {
  cache = null
}

export async function geocodeCity(name: string): Promise<{ name: string; lat: number; lon: number } | null> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json() as { results?: Array<{ name: string; latitude: number; longitude: number }> }
    const r = json.results?.[0]
    if (!r) return null
    return { name: r.name, lat: r.latitude, lon: r.longitude }
  } catch {
    return null
  }
}

export async function detectLocationByIP(): Promise<{ city: string; lat: number; lon: number } | null> {
  try {
    const res = await fetch('http://ip-api.com/json/?lang=zh-TW&fields=city,lat,lon,status')
    if (!res.ok) return null
    const json = await res.json() as { status: string; city: string; lat: number; lon: number }
    if (json.status !== 'success') return null
    return { city: json.city, lat: json.lat, lon: json.lon }
  } catch {
    return null
  }
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`
    const res = await fetch(url)
    if (!res.ok) return null
    const json = await res.json() as {
      current?: {
        temperature_2m: number
        relative_humidity_2m: number
        weather_code: number
        wind_speed_10m: number
      }
    }
    const c = json.current
    if (!c) return null
    return {
      description: wmoToDesc(c.weather_code),
      temperatureC: Math.round(c.temperature_2m),
      humidity: Math.round(c.relative_humidity_2m),
      windSpeed: Math.round(c.wind_speed_10m * 10) / 10
    }
  } catch {
    return null
  }
}

export function buildWeatherTemplate(locationName: string, data: WeatherData): string {
  return `[使用者所在地天氣]\n${locationName}：${data.description}，氣溫 ${data.temperatureC}°C，濕度 ${data.humidity}%，風速 ${data.windSpeed} m/s`
}

export async function polishWeatherDescription(locationName: string, data: WeatherData, settings: AppSettings): Promise<string> {
  const utilitySettings: AppSettings = {
    ...applyUtilitySettings(settings),
    llm: {
      ...applyUtilitySettings(settings).llm,
      maxResponseTokens: 80
    }
  }
  const userPrompt =
    `請用一句口語化的中文描述以下天氣狀況，供 AI 角色作為背景資訊參考。` +
    `不要列數字，不要寫成對話，不要加角色語氣，就一句自然的說明。\n` +
    `位置：${locationName}，天氣：${data.description}，氣溫 ${data.temperatureC}°C，` +
    `濕度 ${data.humidity}%，風速 ${data.windSpeed} m/s`
  try {
    const { content } = await chatWithLLM({
      settings: utilitySettings,
      character: { id: '__weather__', name: 'weather', emotions: {}, personality: '', description: '' },
      messages: [{ id: '__w', role: 'user', content: userPrompt, timestamp: Date.now() }],
      persona: null,
      world: null,
      desktopCharacterNames: [],
      isReminder: true
    })
    const polished = content.trim()
    if (!polished) throw new Error('empty')
    return `[使用者所在地天氣]\n${polished}`
  } catch {
    return buildWeatherTemplate(locationName, data)
  }
}

/** 取得天氣注入字串（附快取）。settings 不符條件時回 null。 */
export async function getWeatherContextString(settings: AppSettings): Promise<string | null> {
  const w = settings.weather
  if (!w?.enabled || !w.locationName || !w.latitude || !w.longitude) return null

  const now = Date.now()

  // 天氣資料快取仍有效 → 直接回傳（polish 也一起快取）
  if (cache && cache.locationName === w.locationName && now - cache.fetchedAt < CACHE_TTL) {
    if (w.polish && settings.llm.utilityEnabled && cache.polished) return cache.polished
    return cache.template
  }

  // 天氣資料過期 → 重新抓氣象
  const data = await fetchWeather(w.latitude, w.longitude)
  if (!data) return null

  const template = buildWeatherTemplate(w.locationName, data)

  // 嘗試延用舊 polish 結果（同地點 + 5 分鐘內）
  const sameLocation = cache?.locationName === w.locationName
  let polished: string | undefined = sameLocation ? cache?.polished : undefined
  let polishedAt: number | undefined = sameLocation ? cache?.polishedAt : undefined

  // 只在 polish 啟用且上次潤飾超過 5 分鐘（或從未潤飾）才重送輔助模型
  if (w.polish && settings.llm.utilityEnabled) {
    const stale = !polishedAt || now - polishedAt >= POLISH_TTL
    if (stale) {
      polished = await polishWeatherDescription(w.locationName, data, settings)
      polishedAt = now
    }
  }

  cache = { locationName: w.locationName, data, template, polished, polishedAt, fetchedAt: now }
  return (w.polish && settings.llm.utilityEnabled && polished) ? polished : template
}

/** 回傳 cache 內的原始天氣資料（供 UI 顯示狀態用）。*/
export function getCachedWeatherData(): { data: WeatherData; fetchedAt: number } | null {
  if (!cache) return null
  return { data: cache.data, fetchedAt: cache.fetchedAt }
}
