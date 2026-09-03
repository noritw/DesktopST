import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HttpAdapter } from '@core/adapters'
import { detectQueryType, fetchCwaData, getRealtimeQueryContextString } from '@core/weather'

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

describe('detectQueryType', () => {
  it('偵測地震關鍵詞', () => {
    expect(detectQueryType('剛剛地震了嗎')).toBe('earthquake')
  })

  it('偵測颱風關鍵詞', () => {
    expect(detectQueryType('颱風幾級')).toBe('typhoon')
  })

  it('偵測天氣預報關鍵詞', () => {
    expect(detectQueryType('明天天氣怎麼樣')).toBe('forecast')
  })

  it('沒有關鍵詞時回 null', () => {
    expect(detectQueryType('你好嗎')).toBeNull()
  })

  it('優先順序：地震 > 颱風 > 天氣預報', () => {
    expect(detectQueryType('颱風天有地震嗎')).toBe('earthquake')
    expect(detectQueryType('颱風來了明天天氣如何')).toBe('typhoon')
  })
})

describe('fetchCwaData', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-22T12:00:00+08:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('forecast：組出天氣預報注入字串', async () => {
    const deps = {
      http: http({
        'F-C0032-001': {
          success: 'true',
          records: {
            location: [
              {
                locationName: '臺北市',
                weatherElement: [
                  { elementName: 'Wx', time: [{ parameter: { parameterName: '多雲' } }, { parameter: { parameterName: '陰短暫雨' } }] },
                  { elementName: 'PoP', time: [{ parameter: { parameterName: '30' } }, { parameter: { parameterName: '60' } }] },
                  { elementName: 'MinT', time: [{ parameter: { parameterName: '24' } }] },
                  { elementName: 'MaxT', time: [{ parameter: { parameterName: '31' } }, { parameter: { parameterName: '29' } }] }
                ]
              }
            ]
          }
        }
      })
    }
    const result = await fetchCwaData(deps, 'forecast', 'test-key', '臺北市')
    expect(result.type).toBe('forecast')
    expect(result.injectionText).toContain('臺北市今明天氣')
    expect(result.injectionText).toContain('降雨機率：今晚 30%，明天白天 60%')
  })

  it('earthquake：有地震記錄時組出注入字串（震度取自使用者設定的縣市，不是寫死台北）', async () => {
    const deps = {
      http: http({
        'E-A0016-001': {
          success: 'true',
          records: {
            Earthquake: [
              {
                EarthquakeNo: 1,
                OriginTime: '2026-08-22 10:00:00',
                EpicenterLocation: '花蓮縣近海',
                EarthquakeMagnitude: { MagnitudeValue: 5.2 },
                FocalDepth: 10,
                Intensity: { ShakingArea: [{ AreaDesc: '臺北市', CountyName: '臺北市', AreaIntensity: '2級' }, { AreaDesc: '高雄市', CountyName: '高雄市', AreaIntensity: '1級' }] }
              }
            ]
          }
        }
      })
    }
    const result = await fetchCwaData(deps, 'earthquake', 'test-key', '台北市')
    expect(result.injectionText).toContain('最近一次顯著有感地震')
    expect(result.injectionText).toContain('規模 M5.2')
    expect(result.injectionText).toContain('臺北市震度：2級')
  })

  it('earthquake：沒設定縣市時不附震度那行（不再預設猜台北）', async () => {
    const deps = {
      http: http({
        'E-A0016-001': {
          success: 'true',
          records: {
            Earthquake: [{
              EarthquakeNo: 2,
              OriginTime: '2026-08-22 10:00:00',
              EpicenterLocation: '花蓮縣近海',
              EarthquakeMagnitude: { MagnitudeValue: 5.2 },
              FocalDepth: 10,
              Intensity: { ShakingArea: [{ AreaDesc: '臺北市', CountyName: '臺北市', AreaIntensity: '2級' }] }
            }]
          }
        }
      })
    }
    const result = await fetchCwaData(deps, 'earthquake', 'test-key', '')
    expect(result.injectionText).not.toContain('震度：')
  })

  it('earthquake：無記錄時回沒有地震的訊息', async () => {
    const deps = { http: http({ 'E-A0016-001': { success: 'true', records: { Earthquake: [] } } }) }
    const result = await fetchCwaData(deps, 'earthquake', 'test-key', '')
    expect(result.injectionText).toContain('目前無顯著有感地震記錄')
  })

  it('typhoon：有颱風時回傳注入字串與颱風名', async () => {
    const deps = {
      http: http({
        'W-C0034-005': {
          success: 'true',
          records: {
            TropicalCyclones: {
              TropicalCyclone: [
                {
                  CwaTyphoonName: '海葵',
                  TyphoonName: 'Haikui',
                  AnalysisData: {
                    Fix: [
                      {
                        DateTime: '2026-08-22T10:00:00+08:00',
                        CoordinateLongitude: '121.5',
                        CoordinateLatitude: '23.5',
                        MaxWindSpeed: '40',
                        MaxGustSpeed: '50',
                        Pressure: '960',
                        MovingSpeed: '10',
                        MovingDirection: 'N',
                        MovingPrediction: [{ value: '向北移動', lang: 'zh-hant' }]
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
      })
    }
    const result = await fetchCwaData(deps, 'typhoon', 'test-key', '')
    expect(result.typhoonName).toBe('海葵')
    expect(result.injectionText).toContain('中度颱風「海葵」')
    expect(result.injectionText).toContain('向北移動')
  })

  it('typhoon：無颱風時回沒有颱風的訊息', async () => {
    const deps = { http: http({ 'W-C0034-005': { success: 'true', records: {} } }) }
    const result = await fetchCwaData(deps, 'typhoon', 'test-key', '')
    expect(result.injectionText).toContain('目前西太平洋無颱風')
    expect(result.typhoonName).toBeUndefined()
  })

  it('API 回傳失敗時拋例外', async () => {
    const deps = { http: http({ 'E-A0016-001': 500 }) }
    await expect(fetchCwaData(deps, 'earthquake', 'test-key', '')).rejects.toThrow()
  })
})

describe('getRealtimeQueryContextString', () => {
  it('未啟用時回 null', async () => {
    const deps = { http: http({}) }
    const r = await getRealtimeQueryContextString('地震了嗎', { weather: { realtimeQuery: { enabled: false, cwaApiKey: 'k', forecastCounty: '' } } }, deps)
    expect(r.injectionText).toBeNull()
  })

  it('沒有 Key 時回 null', async () => {
    const deps = { http: http({}) }
    const r = await getRealtimeQueryContextString('地震了嗎', { weather: { realtimeQuery: { enabled: true, cwaApiKey: '', forecastCounty: '' } } }, deps)
    expect(r.injectionText).toBeNull()
  })

  it('沒有命中關鍵詞時回 null', async () => {
    const deps = { http: http({}) }
    const r = await getRealtimeQueryContextString('你好嗎', { weather: { realtimeQuery: { enabled: true, cwaApiKey: 'k', forecastCounty: '' } } }, deps)
    expect(r.injectionText).toBeNull()
  })

  it('金鑰還是密文時回 null（解密失敗的安全退回）', async () => {
    const deps = { http: http({}) }
    const r = await getRealtimeQueryContextString(
      '地震了嗎',
      { weather: { realtimeQuery: { enabled: true, cwaApiKey: 'enc:v1:xxxx', forecastCounty: '' } } },
      deps
    )
    expect(r.injectionText).toBeNull()
  })

  it('查詢失敗時靜默回 null，不拋例外', async () => {
    const deps = { http: http({ 'E-A0016-001': 500 }) }
    const r = await getRealtimeQueryContextString(
      '地震了嗎',
      { weather: { realtimeQuery: { enabled: true, cwaApiKey: 'k', forecastCounty: '' } } },
      deps
    )
    expect(r.injectionText).toBeNull()
  })

  it('命中且成功時回傳注入字串', async () => {
    const deps = { http: http({ 'E-A0016-001': { success: 'true', records: { Earthquake: [] } } }) }
    const r = await getRealtimeQueryContextString(
      '地震了嗎',
      { weather: { realtimeQuery: { enabled: true, cwaApiKey: 'k', forecastCounty: '' } } },
      deps
    )
    expect(r.injectionText).toContain('目前無顯著有感地震記錄')
  })
})
