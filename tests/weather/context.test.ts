import { beforeEach, describe, expect, it } from 'vitest'
import type { HttpAdapter } from '@core/adapters'
import { getWeatherContextString, invalidateWeatherCache } from '@core/weather'
import { DEFAULT_SETTINGS, type AppSettings } from '@core/types'

function http(routes: Record<string, unknown | number>): HttpAdapter & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    supportsStreaming: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      for (const [needle, body] of Object.entries(routes)) {
        if (!url.includes(needle)) continue
        if (typeof body === 'number') return new Response('err', { status: body })
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  }
}

const OPEN_METEO = {
  current: {
    temperature_2m: 28,
    relative_humidity_2m: 70,
    weather_code: 0,
    wind_speed_10m: 3.4
  }
}

/** CWA 縣市預報的最小回應（只放程式真的會讀的欄位）。 */
const CWA_FORECAST = {
  success: 'true',
  records: {
    location: [
      {
        locationName: '臺北市',
        weatherElement: [
          { elementName: 'Wx', time: [{ parameter: { parameterName: '多雲' } }, { parameter: { parameterName: '陰短暫雨' } }] },
          { elementName: 'PoP', time: [{ parameter: { parameterName: '30' } }] },
          { elementName: 'MinT', time: [{ parameter: { parameterName: '24' } }] },
          { elementName: 'MaxT', time: [{ parameter: { parameterName: '31' } }] }
        ]
      }
    ]
  }
}

function settings(over: Partial<AppSettings['weather']> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    // 潤飾要靠輔助模型；這裡一律關掉，免得測試去打 LLM
    llm: { ...DEFAULT_SETTINGS.llm, utilityEnabled: false },
    weather: {
      enabled: true,
      polish: false,
      locationName: '臺北市',
      latitude: 25.05,
      longitude: 121.53,
      locationSource: 'manual',
      ...over
    }
  }
}

describe('getWeatherContextString', () => {
  beforeEach(() => invalidateWeatherCache())

  it('組出 [Weather] 區塊', async () => {
    const h = http({ 'api.open-meteo.com': OPEN_METEO })
    expect(await getWeatherContextString(settings(), { http: h })).toBe(
      '[Weather]\n臺北市：晴天，氣溫 28°C，濕度 70%，風速 3.4 m/s'
    )
  })

  it('沒開、或沒設地點就回 null，不打任何網路', async () => {
    const h = http({ 'api.open-meteo.com': OPEN_METEO })
    expect(await getWeatherContextString(settings({ enabled: false }), { http: h })).toBeNull()
    expect(await getWeatherContextString(settings({ locationName: '' }), { http: h })).toBeNull()
    expect(await getWeatherContextString(settings({ latitude: 0 }), { http: h })).toBeNull()
    expect(h.calls).toHaveLength(0)
  })

  it('30 分鐘內重複問只打一次外部服務', async () => {
    const h = http({ 'api.open-meteo.com': OPEN_METEO })
    const s = settings()
    await getWeatherContextString(s, { http: h })
    await getWeatherContextString(s, { http: h })
    await getWeatherContextString(s, { http: h })
    expect(h.calls).toHaveLength(1)
  })

  it('換地點會讓快取失效', async () => {
    const h = http({ 'api.open-meteo.com': OPEN_METEO })
    await getWeatherContextString(settings(), { http: h })
    await getWeatherContextString(settings({ locationName: '高雄市' }), { http: h })
    expect(h.calls).toHaveLength(2)
  })

  it('填了 CWA 金鑰就改用氣象署，不打 Open-Meteo', async () => {
    const h = http({ 'opendata.cwa.gov.tw': CWA_FORECAST, 'api.open-meteo.com': OPEN_METEO })
    const out = await getWeatherContextString(
      settings({ realtimeQuery: { enabled: true, cwaApiKey: 'CWA-XXX', forecastCounty: '臺北市' } }),
      { http: h }
    )
    expect(out).toBe('[Weather]\n臺北市：多雲（明日陰短暫雨），今日氣溫 24–31°C，降雨機率 30%')
    expect(h.calls.some((u) => u.includes('api.open-meteo.com'))).toBe(false)
  })

  it('CWA 掛掉時安靜退回 Open-Meteo —— 氣象署當機不該讓對話收不到天氣', async () => {
    const h = http({ 'opendata.cwa.gov.tw': 503, 'api.open-meteo.com': OPEN_METEO })
    const out = await getWeatherContextString(
      settings({ realtimeQuery: { enabled: true, cwaApiKey: 'CWA-XXX', forecastCounty: '' } }),
      { http: h }
    )
    expect(out).toContain('氣溫 28°C')
  })

  it('金鑰解不開（留著密文）時當作沒有金鑰', async () => {
    const h = http({ 'opendata.cwa.gov.tw': CWA_FORECAST, 'api.open-meteo.com': OPEN_METEO })
    const out = await getWeatherContextString(
      settings({ realtimeQuery: { enabled: true, cwaApiKey: 'enc:v1:GARBAGE', forecastCounty: '' } }),
      { http: h }
    )
    expect(out).toContain('氣溫 28°C')
    expect(h.calls.some((u) => u.includes('opendata.cwa.gov.tw'))).toBe(false)
  })

  it('即時查詢沒啟用時，就算有金鑰也不走 CWA', async () => {
    const h = http({ 'opendata.cwa.gov.tw': CWA_FORECAST, 'api.open-meteo.com': OPEN_METEO })
    await getWeatherContextString(
      settings({ realtimeQuery: { enabled: false, cwaApiKey: 'CWA-XXX', forecastCounty: '' } }),
      { http: h }
    )
    expect(h.calls.some((u) => u.includes('opendata.cwa.gov.tw'))).toBe(false)
  })

  it('全部來源都失敗時回 null，讓呼叫端整段略過', async () => {
    const h = http({ 'api.open-meteo.com': 500, 'wttr.in': 500 })
    expect(await getWeatherContextString(settings(), { http: h })).toBeNull()
  })
})
