import { applyUtilitySettings, chatWithLLM } from '../llm'
import { SECRET_PREFIX } from '../adapters'
import type { AppSettings } from '../types'
import { fetchCwaBackgroundWeather } from './cwa'
import { buildWeatherTemplate, fetchWeather, type WeatherData, type WeatherDeps } from './providers'

/**
 * 天氣快取。**程序記憶體，重開就沒了** —— 天氣本來就該重抓，不值得落地。
 *
 * 桌面與手機各自載入一份這個模組，所以互不干擾。
 */
let cache: {
  locationName: string
  data: WeatherData
  template: string
  polished?: string
  fetchedAt: number
  /** 與 `fetchedAt` 分開記：潤飾比天氣本身穩定，可以跨越天氣刷新週期沿用。 */
  polishedAt?: number
} | null = null

const CACHE_TTL = 30 * 60 * 1000
const POLISH_TTL = 5 * 60 * 1000

export function invalidateWeatherCache(): void {
  cache = null
}

/** 供 UI 顯示「上次抓到什麼」。 */
export function getCachedWeatherData(): { data: WeatherData; fetchedAt: number } | null {
  return cache ? { data: cache.data, fetchedAt: cache.fetchedAt } : null
}

/** 拿得到可用的 CWA 金鑰就回傳，否則空字串。 */
function usableCwaKey(settings: AppSettings): string {
  const rq = settings.weather?.realtimeQuery
  if (!rq?.enabled || !rq.cwaApiKey) return ''
  /*
   * 解不開的金鑰長得跟密文一樣（`secrets.decrypt` 失敗時原樣回傳，
   * 避免把使用者的金鑰洗成空字串）。這種情況當作沒有金鑰，走 Open-Meteo。
   */
  if (rq.cwaApiKey.startsWith(SECRET_PREFIX)) return ''
  return rq.cwaApiKey
}

/**
 * 把天氣數據交給輔助模型潤成一句話。
 *
 * 失敗一律退回制式模板 —— 天氣是背景配料，不該因為潤飾失敗就整段消失。
 */
export async function polishWeatherDescription(
  locationName: string,
  data: WeatherData,
  settings: AppSettings,
  deps: WeatherDeps
): Promise<string> {
  const utility = applyUtilitySettings(settings)
  const userPrompt =
    `請用一句口語化的中文描述以下天氣狀況，供 AI 角色作為背景資訊參考。` +
    `不要列數字，不要寫成對話，不要加角色語氣，就一句自然的說明。\n` +
    `位置：${locationName}，天氣：${data.description}，氣溫 ${data.temperatureC}°C，` +
    `濕度 ${data.humidity}%，風速 ${data.windSpeed} m/s`
  try {
    const { content } = await chatWithLLM(
      {
        settings: { ...utility, llm: { ...utility.llm, maxResponseTokens: 80 } },
        character: { id: '__weather__', name: 'weather', emotions: {}, personality: '', description: '' },
        messages: [{ id: '__w', role: 'user', content: userPrompt, timestamp: Date.now() }],
        persona: null,
        world: null,
        desktopCharacterNames: [],
        isReminder: true
      },
      deps
    )
    const polished = content.trim()
    if (!polished) throw new Error('empty')
    return `[Weather]\n${polished}`
  } catch {
    return buildWeatherTemplate(locationName, data)
  }
}

/**
 * 組出要塞進 system prompt 的 `[Weather]` 區塊，附 30 分鐘快取。
 * 條件不成立（沒開、沒地點）時回 `null`，呼叫端不必自己判斷。
 *
 * 資料來源順序：CWA（有金鑰時，台灣預報準得多）→ Open-Meteo → wttr.in。
 */
export async function getWeatherContextString(
  settings: AppSettings,
  deps: WeatherDeps
): Promise<string | null> {
  const w = settings.weather
  if (!w?.enabled || !w.locationName || !w.latitude || !w.longitude) return null

  const now = Date.now()

  const cwaKey = usableCwaKey(settings)
  if (cwaKey) {
    const county = w.realtimeQuery?.forecastCounty || w.locationName
    if (cache && cache.locationName === county && now - cache.fetchedAt < CACHE_TTL) {
      return cache.template
    }
    const cwaStr = await fetchCwaBackgroundWeather(deps, cwaKey, county)
    if (cwaStr) {
      cache = {
        locationName: county,
        data: cache?.data ?? { description: '', temperatureC: 0, humidity: 0, windSpeed: 0 },
        template: cwaStr,
        fetchedAt: now
      }
      return cwaStr
    }
    // CWA 掛了就往下走 Open-Meteo，不要讓使用者整段收不到天氣
  }

  if (cache && cache.locationName === w.locationName && now - cache.fetchedAt < CACHE_TTL) {
    if (w.polish && settings.llm.utilityEnabled && cache.polished) return cache.polished
    return cache.template
  }

  const data = await fetchWeather(deps, w.latitude, w.longitude, w.locationName)
  if (!data) return null

  const template = buildWeatherTemplate(w.locationName, data)

  const sameLocation = cache?.locationName === w.locationName
  let polished = sameLocation ? cache?.polished : undefined
  let polishedAt = sameLocation ? cache?.polishedAt : undefined

  if (w.polish && settings.llm.utilityEnabled) {
    const stale = !polishedAt || now - polishedAt >= POLISH_TTL
    if (stale) {
      polished = await polishWeatherDescription(w.locationName, data, settings, deps)
      polishedAt = now
    }
  }

  cache = { locationName: w.locationName, data, template, polished, polishedAt, fetchedAt: now }
  return w.polish && settings.llm.utilityEnabled && polished ? polished : template
}
