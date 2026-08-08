/**
 * 中央氣象署 Open Data API 查詢服務
 * 偵測使用者訊息中的氣象關鍵詞，即時查詢並組成 prompt 注入字串
 *
 * **桌面限定。** 背景天氣（`[Weather]`）用的 F-C0032-001 已移到
 * `core/weather/cwa.ts` 給兩邊共用；這裡剩下的地震與颱風還沒接到手機。
 */
import {
  cwaFetch as coreCwaFetch,
  fetchCwaBackgroundWeather as coreFetchCwaBackgroundWeather,
  testCwaApiKey as coreTestCwaApiKey,
  type CwaForecastResponse
} from '../core/weather'
import { electronHttp } from './adapters/httpAdapter'

const deps = { http: electronHttp }

export function fetchCwaBackgroundWeather(apiKey: string, county: string): Promise<string | null> {
  return coreFetchCwaBackgroundWeather(deps, apiKey, county)
}

export function testCwaApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  return coreTestCwaApiKey(deps, apiKey)
}

export type RealtimeQueryType = 'forecast' | 'earthquake' | 'typhoon'

export interface RealtimeQueryResult {
  type: RealtimeQueryType
  injectionText: string
  fetchedAt: Date
  /** 若查詢到颱風，回傳中文颱風名 */
  typhoonName?: string
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

const cwaFetch = (dataset: string, params: Record<string, string>, apiKey: string): Promise<unknown> =>
  coreCwaFetch(deps, dataset, params, apiKey)

// ─── 天氣預報 F-C0032-001 ─────────────────────────────────────
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
interface CwaTyphoonMovingPrediction {
  value: string
  lang: string
}

interface CwaTyphoonFix {
  DateTime: string
  CoordinateLongitude: string
  CoordinateLatitude: string
  MaxWindSpeed: string
  MaxGustSpeed: string
  Pressure: string
  MovingSpeed: string
  MovingDirection: string
  MovingPrediction?: CwaTyphoonMovingPrediction[]
}

interface CwaTyphoonRecord {
  Year?: string
  TyphoonName?: string
  CwaTyphoonName?: string
  CwaTdNo?: string
  CwaTyNo?: string
  AnalysisData?: { Fix?: CwaTyphoonFix[] }
  ForecastData?: { Fix?: CwaTyphoonFix[] }
}

interface CwaTyphoonResponse {
  success: string
  records?: {
    TropicalCyclones?: {
      TropicalCyclone?: CwaTyphoonRecord[]
    }
  }
}

/** 從最大風速（m/s）推算颱風強度等級 */
function classifyTyphoonIntensity(maxWindSpeed: number): string {
  if (maxWindSpeed >= 51) return '強烈'
  if (maxWindSpeed >= 33) return '中度'
  if (maxWindSpeed >= 17.2) return '輕度'
  return '熱帶性低氣壓'  // < 17.2 m/s
}

interface FetchTyphoonResult {
  injectionText: string
  typhoonName?: string
}

async function fetchTyphoon(apiKey: string): Promise<FetchTyphoonResult> {
  const json = await cwaFetch('W-C0034-005', {}, apiKey) as CwaTyphoonResponse
  if (json.success !== 'true') throw new Error('CWA API error')

  const cyclones = json.records?.TropicalCyclones?.TropicalCyclone
  if (!cyclones || cyclones.length === 0) {
    return {
      injectionText:
        `[即時查詢：颱風消息]\n` +
        `目前西太平洋無颱風或熱帶低氣壓影響台灣。\n` +
        `（資料來源：中央氣象署）`
    }
  }

  // 可能有多個颱風同時活動，全部列出
  const parts: string[] = ['[即時查詢：颱風消息]']
  let firstTyphoonName: string | undefined

  for (const tc of cyclones) {
    const name = tc.CwaTyphoonName ?? tc.TyphoonName ?? '未命名'
    const engName = tc.TyphoonName ?? ''
    if (!firstTyphoonName) firstTyphoonName = name

    // 取最新的分析資料
    const fixes = tc.AnalysisData?.Fix
    const latest = fixes && fixes.length > 0 ? fixes[fixes.length - 1] : null

    if (!latest) {
      parts.push(`目前有颱風「${name}」活動中（無詳細分析資料）。`)
      continue
    }

    const windSpeed = parseFloat(latest.MaxWindSpeed) || 0
    const intensity = classifyTyphoonIntensity(windSpeed)
    const label = windSpeed >= 17.2 ? `${intensity}颱風` : '熱帶性低氣壓'

    // 移動描述（中文優先）
    const movingZh = latest.MovingPrediction?.find(p => p.lang === 'zh-hant')?.value ?? ''

    let line = `目前有${label}「${name}」`
    if (engName && engName !== name) line += `（${engName}）`

    if (movingZh) {
      line += `，${movingZh}`
    } else {
      const lat = latest.CoordinateLatitude
      const lon = latest.CoordinateLongitude
      if (lat && lon) line += `，位於北緯 ${lat} 度、東經 ${lon} 度附近`
    }

    line += `，近中心最大風速每秒 ${latest.MaxWindSpeed} 公尺，氣壓 ${latest.Pressure} 百帕。`
    parts.push(line)
  }

  parts.push('（資料來源：中央氣象署）')
  return { injectionText: parts.join('\n'), typhoonName: firstTyphoonName }
}

// ─── 主要對外函式 ─────────────────────────────────────────────
/** 根據 type 查詢 CWA API，回傳組好的 prompt 注入字串；失敗時拋例外 */
export async function fetchCwaData(
  type: RealtimeQueryType,
  apiKey: string,
  forecastCounty: string
): Promise<RealtimeQueryResult> {
  let injectionText: string
  let typhoonName: string | undefined
  switch (type) {
    case 'forecast':
      injectionText = await fetchForecast(apiKey, forecastCounty)
      break
    case 'earthquake':
      injectionText = await fetchEarthquake(apiKey)
      break
    case 'typhoon': {
      const result = await fetchTyphoon(apiKey)
      injectionText = result.injectionText
      typhoonName = result.typhoonName
      break
    }
  }
  return { type, injectionText, fetchedAt: new Date(), typhoonName }
}
