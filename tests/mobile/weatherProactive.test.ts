import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@core/types'
import type { AppSettings } from '@core/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { checkWeatherProactive, MIN_POLL_INTERVAL_MS } from '../../src/mobile/runtime/weatherProactive'
import * as keys from '@core/store/keys'

/**
 * 天氣主動發話（獨立模式）的手機 runtime 層：節流、每日計數跨程序落盤、
 * 影子模式不真的發話。判斷邏輯本身（`diffWeatherEvents`／`gateProactiveEvents`）
 * 已經在 `tests/weather/proactive.test.ts` 測過，這裡只測手機平台的接線。
 */

const NOW = new Date('2026-09-05T10:00:00+08:00').getTime()

function makeSettings(overrides: Partial<AppSettings['weather']> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    weather: {
      enabled: true,
      polish: false,
      locationName: '臺北市',
      latitude: 25,
      longitude: 121,
      locationSource: 'manual',
      realtimeQuery: { enabled: true, cwaApiKey: 'fake-key', forecastCounty: '臺北市' },
      // quietHours 關掉（start === end）：測試不該受「跑測試當下是幾點」影響。
      proactive: { enabled: true, shadowMode: false, earthquakeStaleWindowMs: 0, quietHours: { start: 0, end: 0 } } as never,
      ...overrides
    }
  }
}

function emptyCwaFetch(): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('E-A0016-001')) return new Response(JSON.stringify({ success: 'true', records: { Earthquake: [] } }), { status: 200 })
    if (url.includes('W-C0034-005')) return new Response(JSON.stringify({ success: 'true', records: { TropicalCyclones: { TropicalCyclone: [] } } }), { status: 200 })
    if (url.includes('F-C0032-001')) {
      return new Response(JSON.stringify({
        success: 'true',
        records: { location: [{
          locationName: '臺北市',
          weatherElement: [
            { elementName: 'Wx', time: [{ startTime: '', endTime: '', parameter: { parameterName: '多雲' } }, { startTime: '', endTime: '', parameter: { parameterName: '大雨特報' } }] },
            { elementName: 'PoP', time: [{ startTime: '', endTime: '', parameter: { parameterName: '10' } }, { startTime: '', endTime: '', parameter: { parameterName: '90' } }] },
            { elementName: 'MinT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '20' } }, { startTime: '', endTime: '', parameter: { parameterName: '20' } }] },
            { elementName: 'MaxT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '28' } }, { startTime: '', endTime: '', parameter: { parameterName: '28' } }] }
          ]
        }] }
      }), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof globalThis.fetch
}

describe('checkWeatherProactive', () => {
  it('skips when the master switch is off', async () => {
    const storage = createMemoryStorage()
    const result = await checkWeatherProactive({
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings({ proactive: { enabled: false } as never }),
      getActiveConversation: () => null,
      speak: async () => true
    })
    expect(result).toEqual({ skippedReason: 'disabled', spoke: false })
  })

  it('skips when there is no usable CWA API key', async () => {
    const storage = createMemoryStorage()
    const result = await checkWeatherProactive({
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings({ realtimeQuery: { enabled: true, cwaApiKey: '', forecastCounty: '臺北市' } } as never),
      getActiveConversation: () => null,
      speak: async () => true
    })
    expect(result).toEqual({ skippedReason: 'no_api_key', spoke: false })
  })

  it('speaks and persists the rain event, bumping the daily count', async () => {
    const storage = createMemoryStorage()
    let spoken: string[] = []
    const result = await checkWeatherProactive({
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings(),
      getActiveConversation: () => null,
      speak: async (text) => {
        spoken.push(text)
        return true
      }
    })
    expect(result.spoke).toBe(true)
    expect(spoken).toHaveLength(1)
    expect(spoken[0]).toContain('明日降雨')

    const snapshot = await storage.readJson<{ firedTodayCount: number; lastPolledAt: number }>(keys.WEATHER_WATCH_SNAPSHOT_KEY)
    expect(snapshot?.firedTodayCount).toBe(1)
    expect(snapshot?.lastPolledAt).toBeGreaterThan(0)
  })

  it('throttles a second call within the minimum poll interval', async () => {
    const storage = createMemoryStorage()
    const deps = {
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings(),
      getActiveConversation: () => null,
      speak: async () => true
    }
    const first = await checkWeatherProactive(deps)
    expect(first.spoke).toBe(true)

    const second = await checkWeatherProactive(deps)
    expect(second).toEqual({ skippedReason: 'throttled', spoke: false })
  })

  it('does not throttle once the minimum interval has elapsed (simulated via stale snapshot)', async () => {
    const storage = createMemoryStorage()
    await storage.writeJson(keys.WEATHER_WATCH_SNAPSHOT_KEY, {
      seenEarthquakeNos: [],
      activeTyphoonNames: [],
      rainNotifiedDates: [],
      tempSwingNotifiedDates: [],
      lastNiceDayAt: 0,
      recentDaySummaries: [],
      lastPolledAt: Date.now() - MIN_POLL_INTERVAL_MS - 1000,
      firedTodayDate: '',
      firedTodayCount: 0
    })
    const result = await checkWeatherProactive({
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings(),
      getActiveConversation: () => null,
      speak: async () => true
    })
    expect(result.spoke).toBe(true)
  })

  it('shadow mode writes a log entry but does not speak', async () => {
    const storage = createMemoryStorage()
    let spokeCalled = false
    const result = await checkWeatherProactive({
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings({ proactive: { enabled: true, shadowMode: true, quietHours: { start: 0, end: 0 } } as never }),
      getActiveConversation: () => null,
      speak: async () => {
        spokeCalled = true
        return true
      }
    })
    expect(result).toEqual({ skippedReason: 'shadow', spoke: false })
    expect(spokeCalled).toBe(false)
    const log = await storage.readJson<string[]>(keys.WEATHER_PROACTIVE_SHADOW_LOG_KEY)
    expect(log?.length).toBeGreaterThan(0)
  })

  it('does not bump the daily count when speak() fails', async () => {
    const storage = createMemoryStorage()
    const result = await checkWeatherProactive({
      adapters: { http: { fetch: emptyCwaFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings(),
      getActiveConversation: () => null,
      speak: async () => false
    })
    expect(result.spoke).toBe(false)
    const snapshot = await storage.readJson<{ firedTodayCount: number; firedTodayDate: string }>(keys.WEATHER_WATCH_SNAPSHOT_KEY)
    // 沒講成功：firedTodayDate/Count 維持透傳（diffWeatherEvents 不動它），不會被誤蓋成今天 1 則
    expect(snapshot?.firedTodayDate).toBe('')
    expect(snapshot?.firedTodayCount).toBe(0)
  })
})
