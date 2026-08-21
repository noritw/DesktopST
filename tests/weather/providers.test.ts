import { describe, expect, it } from 'vitest'
import type { HttpAdapter } from '@core/adapters'
import {
  buildWeatherTemplate,
  detectLocationByIP,
  fetchWeather,
  geocodeCity,
  reverseGeocode,
  wmoToDesc
} from '@core/weather'

/**
 * 假 HTTP：依網址挑一份回應。回傳的 `calls` 讓測試能斷言「有沒有真的打第二家」。
 *
 * 沒對應到的網址一律 404 —— 這樣「備援有沒有被叫到」才驗得出來，
 * 若讓未知網址成功回空物件，退回邏輯會被靜默略過。
 */
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

const deps = (h: HttpAdapter): { http: HttpAdapter } => ({ http: h })

describe('core/weather providers', () => {
  it('WMO 代碼翻成中文；沒收錄的代碼不炸，回「未知」', () => {
    expect(wmoToDesc(0)).toBe('晴天')
    expect(wmoToDesc(95)).toBe('雷陣雨')
    expect(wmoToDesc(12345)).toBe('未知')
  })

  it('地名查座標', async () => {
    const h = http({
      'geocoding-api': { results: [{ name: '臺北市', latitude: 25.05, longitude: 121.53 }] }
    })
    expect(await geocodeCity(deps(h), '台北')).toEqual({ name: '臺北市', lat: 25.05, lon: 121.53 })
  })

  it('查不到城市回 null，不是拋例外', async () => {
    const h = http({ 'geocoding-api': { results: [] } })
    expect(await geocodeCity(deps(h), '不存在的地方')).toBeNull()
  })

  it('反查地名：city 空的時候退到 locality', async () => {
    const h = http({ 'reverse-geocode-client': { city: '', locality: '大安區' } })
    expect(await reverseGeocode(deps(h), 25, 121)).toBe('大安區')
  })

  it('IP 定位以 ip-api 為主（它才給中文市名）', async () => {
    const h = http({ 'ip-api.com': { status: 'success', city: '臺北市', lat: 25.05, lon: 121.53 } })
    expect(await detectLocationByIP(deps(h))).toEqual({ name: '臺北市', lat: 25.05, lon: 121.53 })
    expect(h.calls.some((u) => u.includes('ipwho.is'))).toBe(false)
  })

  it('ip-api 撞到流量限制時改問 ipwho.is', async () => {
    const h = http({
      'ip-api.com': 429,
      'ipwho.is': { success: true, city: 'Taipei', latitude: 25.05, longitude: 121.53 }
    })
    expect(await detectLocationByIP(deps(h))).toEqual({ name: 'Taipei', lat: 25.05, lon: 121.53 })
  })

  it('兩家都失敗才回 null', async () => {
    const h = http({ 'ip-api.com': 500, 'ipwho.is': 500 })
    expect(await detectLocationByIP(deps(h))).toBeNull()
  })

  it('Open-Meteo 的數值會四捨五入，風速留一位小數', async () => {
    const h = http({
      'api.open-meteo.com': {
        current: {
          temperature_2m: 27.62,
          relative_humidity_2m: 71.4,
          weather_code: 3,
          wind_speed_10m: 3.44
        }
      }
    })
    expect(await fetchWeather(deps(h), 25, 121, '臺北市')).toEqual({
      description: '陰天',
      temperatureC: 28,
      humidity: 71,
      windSpeed: 3.4
    })
  })

  it('Open-Meteo 掛掉時退回 wttr.in，並把 km/h 換算成 m/s', async () => {
    const h = http({
      'api.open-meteo.com': 503,
      'wttr.in': {
        current_condition: [
          { temp_C: 30, humidity: 60, weatherDesc: [{ value: 'Sunny' }], windspeedKmph: 18 }
        ]
      }
    })
    expect(await fetchWeather(deps(h), 25, 121, '臺北市')).toEqual({
      description: 'Sunny',
      temperatureC: 30,
      humidity: 60,
      windSpeed: 5
    })
  })

  it('沒有地名就不試 wttr.in —— 那支只吃地名，用座標問也是白問', async () => {
    const h = http({ 'api.open-meteo.com': 503 })
    expect(await fetchWeather(deps(h), 25, 121, '')).toBeNull()
    expect(h.calls.some((u) => u.includes('wttr.in'))).toBe(false)
  })

  it('注入字串的格式與桌面一致', () => {
    expect(
      buildWeatherTemplate('臺北市', {
        description: '晴天',
        temperatureC: 28,
        humidity: 70,
        windSpeed: 3.4
      })
    ).toBe('[Weather]\n臺北市：晴天，氣溫 28°C，濕度 70%，風速 3.4 m/s')
  })
})
