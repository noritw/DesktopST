import type { WeatherDeps } from './providers'

/**
 * 中央氣象署 Open Data。
 *
 * 這裡**只放背景天氣**（`[Weather]` 那行要用的 F-C0032-001）——兩邊都要，所以共用。
 * 關鍵詞即時查詢（地震 E-A0016-001、颱風 W-C0034-005）仍在
 * `main/cwaService.ts`：那是桌面聊天管線裡的功能，手機還沒接。
 * 兩邊共用的只有下面的 `cwaFetch`。
 */
const CWA_BASE = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore'
const TIMEOUT_MS = 5000

/** 打一支 CWA datastore；HTTP 層失敗會拋，由呼叫端決定要不要退回其他資料來源。 */
export async function cwaFetch(
  deps: WeatherDeps,
  dataset: string,
  params: Record<string, string>,
  apiKey: string
): Promise<unknown> {
  const url = new URL(`${CWA_BASE}/${dataset}`)
  url.searchParams.set('Authorization', apiKey)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await deps.http.fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(tid)
  }
}

export interface CwaForecastRecord {
  locationName: string
  weatherElement: Array<{
    elementName: string
    time: Array<{
      startTime: string
      endTime: string
      parameter: { parameterName: string; parameterUnit?: string }
    }>
  }>
}

export interface CwaForecastResponse {
  success: string
  records?: { location?: CwaForecastRecord[] }
}

/**
 * 背景天氣：用 CWA 縣市預報取代 Open-Meteo 組 `[Weather]`。
 *
 * 台灣的預報 CWA 準得多，所以只要使用者填了金鑰就優先走這條。
 * 失敗一律回 `null` 而不是拋——呼叫端要能安靜退回 Open-Meteo，
 * 使用者不該因為氣象署當機就收不到天氣。
 */
export async function fetchCwaBackgroundWeather(
  deps: WeatherDeps,
  apiKey: string,
  county: string
): Promise<string | null> {
  try {
    const params: Record<string, string> = { elementName: 'Wx,PoP,MinT,MaxT' }
    if (county) params.locationName = county

    const json = (await cwaFetch(deps, 'F-C0032-001', params, apiKey)) as CwaForecastResponse
    if (json.success !== 'true') return null

    const loc = json.records?.location?.[0]
    if (!loc) return null

    const getEl = (name: string) => loc.weatherElement.find((e) => e.elementName === name)
    const wxNow = getEl('Wx')?.time[0]?.parameter.parameterName ?? '—'
    const wxNext = getEl('Wx')?.time[1]?.parameter.parameterName
    const popNow = getEl('PoP')?.time[0]?.parameter.parameterName ?? '—'
    const minTNow = getEl('MinT')?.time[0]?.parameter.parameterName ?? '—'
    const maxTNow = getEl('MaxT')?.time[0]?.parameter.parameterName ?? '—'

    let desc = `${loc.locationName}：${wxNow}`
    if (wxNext && wxNext !== wxNow) desc += `（明日${wxNext}）`
    desc += `，今日氣溫 ${minTNow}–${maxTNow}°C，降雨機率 ${popNow}%`

    return `[Weather]\n${desc}`
  } catch {
    return null
  }
}

/** 測試金鑰：只要 F-C0032-001 回 success 就算過。 */
export async function testCwaApiKey(
  deps: WeatherDeps,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const json = (await cwaFetch(
      deps,
      'F-C0032-001',
      { elementName: 'Wx', limit: '1' },
      apiKey
    )) as CwaForecastResponse
    if (json.success === 'true') return { ok: true }
    return { ok: false, error: 'API 回傳失敗' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('401') || msg.includes('403')) return { ok: false, error: 'API Key 無效' }
    if (msg.includes('abort')) return { ok: false, error: '連線逾時（5 秒）' }
    return { ok: false, error: msg }
  }
}
