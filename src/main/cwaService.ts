/**
 * 中央氣象署 Open Data API 查詢服務
 * 偵測使用者訊息中的氣象關鍵詞，即時查詢並組成 prompt 注入字串
 */

const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore'
const TIMEOUT_MS = 5000

export type RealtimeQueryType = 'forecast' | 'earthquake' | 'typhoon'

export interface RealtimeQueryResult {
  type: RealtimeQueryType
  injectionText: string
  fetchedAt: Date
}

// ─── 關鍵詞分組 ───────────────────────────────────────────────
const EARTHQUAKE_KEYWORDS = [
  '地震', '有感', '搖晃', '震了', '抖了', '地震幾級', '震央', '點的地震'
]

const TYPHOON_KEYWORDS = [
  '颱風', '颱風來了', '颱風警報', '颱風假',
  '有沒有颱風', '颱風幾級', '颱風路徑'
]

const FORECAST_KEYWORDS = [
  '明天', '後天', '大後天', '這幾天',
  '下雨', '在下雨', '一直下', '雨要下', '雨停', '雨什麼時候', '晴天', '放晴', '陰天', '颳風', '下雪',
  '帶傘', '雨衣', '要穿幾件', '穿短袖', '穿長袖',
  '幾度', '溫度', '熱嗎', '冷嗎', '變熱', '變冷', '熱不熱', '冷不冷',
  '天氣怎麼樣', '天氣如何', '天氣'
]

/** 偵測訊息中的氣象查詢類型（優先順序：地震 > 颱風 > 天氣預報）*/
export function detectQueryType(message: string): RealtimeQueryType | null {
  if (EARTHQUAKE_KEYWORDS.some(kw => message.includes(kw))) return 'earthquake'
  if (TYPHOON_KEYWORDS.some(kw => message.includes(kw))) return 'typhoon'
  if (FORECAST_KEYWORDS.some(kw => message.includes(kw))) return 'forecast'
  return null
}

// ─── API 呼叫工具 ─────────────────────────────────────────────
async function cwaFetch(dataset: string, params: Record<string, string>, apiKey: string): Promise<unknown> {
  const url = new URL(`${CWA_BASE}/${dataset}`)
  url.searchParams.set('Authorization', apiKey)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(tid)
  }
}

// ─── 天氣預報 F-C0032-001 ─────────────────────────────────────
interface CwaForecastRecord {
  locationName: string
  weatherElement: Array<{
    elementName: string
    time: Array<{
      startTime: string
      endTime: string
      parameter: {
        parameterName: string
        parameterUnit?: string
      }
    }>
  }>
}

interface CwaForecastResponse {
  success: string
  records?: {
    location?: CwaForecastRecord[]
  }
}

async function fetchForecast(apiKey: string, county: string): Promise<string> {
  const params: Record<string, string> = {
    elementName: 'Wx,PoP,MinT,MaxT'
  }
  if (county) params.locationName = county

  const json = await cwaFetch('F-C0032-001', params, apiKey) as CwaForecastResponse
  if (json.success !== 'true') throw new Error('CWA API error')

  const locations = json.records?.location
  if (!locations || locations.length === 0) throw new Error('no locations')

  const loc = locations[0]
  const locName = loc.locationName

  const getEl = (name: string) => loc.weatherElement.find(e => e.elementName === name)
  const wx = getEl('Wx')
  const pop = getEl('PoP')
  const minT = getEl('MinT')
  const maxT = getEl('MaxT')

  // 取第一時段（今晚至明晨）和第二時段（明天白天）
  const period0 = wx?.time[0]
  const period1 = wx?.time[1]
  const wxDesc0 = period0?.parameter.parameterName ?? '未知'
  const wxDesc1 = period1?.parameter.parameterName ?? '未知'

  const pop0 = pop?.time[0]?.parameter.parameterName ?? '—'
  const pop1 = pop?.time[1]?.parameter.parameterName ?? '—'

  const minT0 = minT?.time[0]?.parameter.parameterName ?? '—'
  const maxT0 = maxT?.time[0]?.parameter.parameterName ?? '—'
  const minT1 = minT?.time[1]?.parameter.parameterName ?? '—'
  const maxT1 = maxT?.time[1]?.parameter.parameterName ?? '—'

  const tempRange = minT0 !== '—' && maxT1 !== '—'
    ? `${minT0}–${maxT1}°C`
    : minT0 !== '—' ? `${minT0}–${maxT0}°C` : '—'

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' })

  return (
    `[即時查詢：天氣預報]\n` +
    `${locName}今明天氣：今晚至明晨${wxDesc0}，明天白天${wxDesc1}。\n` +
    `降雨機率：今晚 ${pop0}%，明天白天 ${pop1}%。\n` +
    `氣溫：${tempRange}。\n` +
    `（資料來源：中央氣象署，${now}）`
  )
}

// ─── 地震 E-A0016-001 ─────────────────────────────────────────
interface CwaEqIntensity {
  areaName: string
  areaIntensity: string
}

interface CwaEqRecord {
  EarthquakeNo: number
  OriginTime: string
  EpicenterLocation: string
  EarthquakeMagnitude: {
    MagnitudeValue: number
  }
  FocalDepth: number
  Intensity?: {
    ShakingArea?: CwaEqIntensity[]
  }
}

interface CwaEqResponse {
  success: string
  records?: {
    Earthquake?: CwaEqRecord[]
  }
}

async function fetchEarthquake(apiKey: string): Promise<string> {
  const json = await cwaFetch('E-A0016-001', { limit: '1' }, apiKey) as CwaEqResponse
  if (json.success !== 'true') throw new Error('CWA API error')

  const eqs = json.records?.Earthquake
  if (!eqs || eqs.length === 0) return '[即時查詢：最近地震]\n目前無顯著有感地震記錄。\n（資料來源：中央氣象署）'

  const eq = eqs[0]
  const originTime = new Date(eq.OriginTime)
  const now = new Date()
  const hoursAgo = Math.round((now.getTime() - originTime.getTime()) / (1000 * 60 * 60))

  const dateStr = originTime.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })

  const magnitude = eq.EarthquakeMagnitude?.MagnitudeValue ?? '—'
  const depth = eq.FocalDepth ?? '—'
  const location = eq.EpicenterLocation ?? '未知'

  // 取台北市震度（如有）
  const areas = eq.Intensity?.ShakingArea ?? []
  const taipeiArea = areas.find(a => a.areaName.includes('臺北') || a.areaName.includes('台北'))
  const taipeiIntensity = taipeiArea ? `台北市震度：${taipeiArea.areaIntensity} 級` : ''

  let text =
    `[即時查詢：最近地震]\n` +
    `最近一次顯著有感地震（${dateStr}）\n` +
    `規模 M${magnitude}，震央：${location}，深度 ${depth} km\n`

  if (taipeiIntensity) text += `${taipeiIntensity}\n`

  if (hoursAgo > 6) {
    text += `（此地震發生於約 ${hoursAgo} 小時前）\n`
  }

  text += `（資料來源：中央氣象署）`
  return text
}

// ─── 颱風 W-C0034-005 ─────────────────────────────────────────
interface CwaTyphoonRecord {
  TyphoonName?: string
  TyphoonNameEng?: string
  TyphoonIntensity?: string
  MovingDescription?: string
}

interface CwaTyphoonResponse {
  success: string
  records?: {
    tropicalCyclones?: {
      tropicalCyclone?: CwaTyphoonRecord[]
    }
  }
}

async function fetchTyphoon(apiKey: string): Promise<string> {
  const json = await cwaFetch('W-C0034-005', {}, apiKey) as CwaTyphoonResponse
  if (json.success !== 'true') throw new Error('CWA API error')

  const cyclones = json.records?.tropicalCyclones?.tropicalCyclone
  if (!cyclones || cyclones.length === 0) {
    return (
      `[即時查詢：颱風消息]\n` +
      `目前西太平洋無颱風或熱帶低氣壓影響台灣。\n` +
      `（資料來源：中央氣象署）`
    )
  }

  const tc = cyclones[0]
  const name = tc.TyphoonName ?? tc.TyphoonNameEng ?? '未命名'
  const intensity = tc.TyphoonIntensity ?? ''
  const moving = tc.MovingDescription ?? ''

  return (
    `[即時查詢：颱風消息]\n` +
    `目前有${intensity}颱風「${name}」${moving ? `，${moving}` : ''}。\n` +
    `（資料來源：中央氣象署）`
  )
}

// ─── 主要對外函式 ─────────────────────────────────────────────
/** 根據 type 查詢 CWA API，回傳組好的 prompt 注入字串；失敗時拋例外 */
export async function fetchCwaData(
  type: RealtimeQueryType,
  apiKey: string,
  forecastCounty: string
): Promise<RealtimeQueryResult> {
  let injectionText: string
  switch (type) {
    case 'forecast':
      injectionText = await fetchForecast(apiKey, forecastCounty)
      break
    case 'earthquake':
      injectionText = await fetchEarthquake(apiKey)
      break
    case 'typhoon':
      injectionText = await fetchTyphoon(apiKey)
      break
  }
  return { type, injectionText, fetchedAt: new Date() }
}

/**
 * 背景天氣：從 CWA F-C0032-001 取得簡短的目前天氣描述，
 * 取代 Open-Meteo 作為 [Weather] 注入字串。
 * 失敗時回傳 null（讓呼叫端 fallback 至 Open-Meteo）。
 */
export async function fetchCwaBackgroundWeather(apiKey: string, county: string): Promise<string | null> {
  try {
    const params: Record<string, string> = { elementName: 'Wx,PoP,MinT,MaxT' }
    if (county) params.locationName = county

    const json = await cwaFetch('F-C0032-001', params, apiKey) as CwaForecastResponse
    if (json.success !== 'true') return null

    const loc = json.records?.location?.[0]
    if (!loc) return null

    const getEl = (name: string) => loc.weatherElement.find(e => e.elementName === name)
    const wx = getEl('Wx')
    const pop = getEl('PoP')
    const minT = getEl('MinT')
    const maxT = getEl('MaxT')

    const wxNow = wx?.time[0]?.parameter.parameterName ?? '—'
    const wxNext = wx?.time[1]?.parameter.parameterName
    const popNow = pop?.time[0]?.parameter.parameterName ?? '—'
    const minTNow = minT?.time[0]?.parameter.parameterName ?? '—'
    const maxTNow = maxT?.time[0]?.parameter.parameterName ?? '—'

    let desc = `${loc.locationName}：${wxNow}`
    if (wxNext && wxNext !== wxNow) desc += `（明日${wxNext}）`
    desc += `，今日氣溫 ${minTNow}–${maxTNow}°C，降雨機率 ${popNow}%`

    return `[Weather]\n${desc}`
  } catch {
    return null
  }
}

/** 測試 API Key 是否有效（打一次 F-C0032-001，只要有回 success 即可）*/
export async function testCwaApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const json = await cwaFetch('F-C0032-001', { elementName: 'Wx', limit: '1' }, apiKey) as CwaForecastResponse
    if (json.success === 'true') return { ok: true }
    return { ok: false, error: 'API 回傳失敗' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('401') || msg.includes('403')) return { ok: false, error: 'API Key 無效' }
    if (msg.includes('abort')) return { ok: false, error: '連線逾時（5 秒）' }
    return { ok: false, error: msg }
  }
}
