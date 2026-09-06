import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@core/types'
import type { AppSettings } from '@core/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import {
  resetMorningBriefingLaunchFlag,
  shouldTriggerMorningBriefingNow,
  triggerMorningBriefing
} from '../../src/mobile/runtime/morningBriefing'
import * as keys from '@core/store/keys'

/**
 * 今日初次問候（早安簡報）獨立模式版：手機沒有行事曆層，只有天氣→熱搜兩層
 * （kickoff §7.2），這裡測快速檢查旗標與講完後落盤「今天講過了」。
 */

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    morningBriefing: { enabled: true },
    weather: {
      enabled: true,
      polish: false,
      locationName: '臺北市',
      latitude: 25,
      longitude: 121,
      locationSource: 'manual',
      realtimeQuery: { enabled: false, cwaApiKey: '', forecastCounty: '' }
    },
    ...overrides
  }
}

function noWeatherFetch(): typeof globalThis.fetch {
  // Open-Meteo 也打不到：讓天氣層直接查無資料，逼下一層（熱搜，這裡也沒開）接手。
  return (async () => new Response('not found', { status: 404 })) as unknown as typeof globalThis.fetch
}

describe('shouldTriggerMorningBriefingNow', () => {
  it('false when the master switch is off', async () => {
    const storage = createMemoryStorage()
    const ok = await shouldTriggerMorningBriefingNow(
      { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      makeSettings({ morningBriefing: { enabled: false } })
    )
    expect(ok).toBe(false)
  })

  it('true when enabled and never greeted before', async () => {
    const storage = createMemoryStorage()
    const ok = await shouldTriggerMorningBriefingNow(
      { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      makeSettings()
    )
    expect(ok).toBe(true)
  })

  it('false once already greeted today', async () => {
    const storage = createMemoryStorage()
    const now = Date.now()
    const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
    await storage.writeJson(keys.MORNING_BRIEFING_KEY, { lastGreetedDate: today })
    const ok = await shouldTriggerMorningBriefingNow(
      { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      makeSettings(),
      now
    )
    expect(ok).toBe(false)
  })

  // 2026-09-06 owner 實機回報：切成「每次開啟都問候」後滑掉重開沒有問候——
  // 這支之前完全沒讀 `mode`／`dayBoundaryHour`，一律當 daily／0 點處理。
  it('every-launch mode: true even when already greeted today on disk', async () => {
    const storage = createMemoryStorage()
    const now = Date.now()
    const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
    await storage.writeJson(keys.MORNING_BRIEFING_KEY, { lastGreetedDate: today })
    const ok = await shouldTriggerMorningBriefingNow(
      { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      makeSettings({ morningBriefing: { enabled: true, mode: 'every-launch' } }),
      now
    )
    expect(ok).toBe(true)
  })

  it('daily mode with dayBoundaryHour: not yet the new day, still counts as greeted', async () => {
    const storage = createMemoryStorage()
    // 台北時間凌晨 2 點；boundary 4 點的話「新的一天」還沒開始，昨天算過就不該再觸發。
    const now = new Date('2026-09-06T02:00:00+08:00').getTime()
    const yesterday = new Date('2026-09-05T02:00:00+08:00')
    const yesterdayStr = yesterday.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
    await storage.writeJson(keys.MORNING_BRIEFING_KEY, { lastGreetedDate: yesterdayStr })
    const ok = await shouldTriggerMorningBriefingNow(
      { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      makeSettings({ morningBriefing: { enabled: true, mode: 'daily', dayBoundaryHour: 4 } }),
      now
    )
    expect(ok).toBe(false)
  })
})

describe('triggerMorningBriefing', () => {
  it('does not speak when the conversation is too recent', async () => {
    const storage = createMemoryStorage()
    let spoke = false
    const ok = await triggerMorningBriefing({
      adapters: { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings(),
      lastUserMessageAt: Date.now() - 30_000,
      speak: async () => {
        spoke = true
        return true
      }
    })
    expect(ok).toBe(false)
    expect(spoke).toBe(false)
  })

  it('does not speak (and does not persist) when no layer has content', async () => {
    const storage = createMemoryStorage()
    const ok = await triggerMorningBriefing({
      adapters: { http: { fetch: noWeatherFetch(), supportsStreaming: false }, storage } as never,
      settings: makeSettings(),
      lastUserMessageAt: null,
      speak: async () => true
    })
    expect(ok).toBe(false)
    expect(await storage.readJson(keys.MORNING_BRIEFING_KEY)).toBeNull()
  })

  it('persists lastGreetedDate only after a successful speak', async () => {
    const storage = createMemoryStorage()
    const settings = makeSettings({
      weather: {
        enabled: true,
        polish: false,
        locationName: '臺北市',
        latitude: 25,
        longitude: 121,
        locationSource: 'manual',
        realtimeQuery: { enabled: true, cwaApiKey: 'fake-key', forecastCounty: '臺北市' }
      }
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('F-C0032-001')) {
        return new Response(JSON.stringify({
          success: 'true',
          records: { location: [{
            locationName: '臺北市',
            weatherElement: [
              { elementName: 'Wx', time: [{ startTime: '', endTime: '', parameter: { parameterName: '晴天' } }] },
              { elementName: 'PoP', time: [{ startTime: '', endTime: '', parameter: { parameterName: '10' } }] },
              { elementName: 'MinT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '22' } }] },
              { elementName: 'MaxT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '28' } }] }
            ]
          }] }
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof globalThis.fetch

    const ok = await triggerMorningBriefing({
      adapters: { http: { fetch: fetchImpl, supportsStreaming: false }, storage } as never,
      settings,
      lastUserMessageAt: null,
      speak: async () => true
    })
    expect(ok).toBe(true)
    const snap = await storage.readJson<{ lastGreetedDate: string }>(keys.MORNING_BRIEFING_KEY)
    expect(snap?.lastGreetedDate).toBeTruthy()
  })

  /*
   * 2026-09-06 owner 實機回報：切成「每次開啟都問候」，第一次正常，之後滑掉
   * App 重開（甚至來回切設定）都不再問候。根因是 Android 滑掉工作清單不保證
   * 真的砍掉 WebView／process（尤其這次新增了 `WeatherForegroundService` 讓
   * process 更容易被系統留著），記憶體旗標 `hasGreetedThisLaunch` 因此從沒
   * 歸零過。修法是不要等 process 重開，改成離開前景那一刻主動呼叫
   * `resetMorningBriefingLaunchFlag()`（`session.onAppBackgrounded()` 掛的）。
   * 這裡直接測旗標本身的生命週期，不透過 session。
   */
  it('every-launch mode: fires again after resetMorningBriefingLaunchFlag(), without it stays silent', async () => {
    const storage = createMemoryStorage()
    const settings = makeSettings({
      morningBriefing: { enabled: true, mode: 'every-launch' },
      weather: {
        enabled: true,
        polish: false,
        locationName: '臺北市',
        latitude: 25,
        longitude: 121,
        locationSource: 'manual',
        realtimeQuery: { enabled: true, cwaApiKey: 'fake-key', forecastCounty: '臺北市' }
      }
    })
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('F-C0032-001')) {
        return new Response(JSON.stringify({
          success: 'true',
          records: { location: [{
            locationName: '臺北市',
            weatherElement: [
              { elementName: 'Wx', time: [{ startTime: '', endTime: '', parameter: { parameterName: '晴天' } }] },
              { elementName: 'PoP', time: [{ startTime: '', endTime: '', parameter: { parameterName: '10' } }] },
              { elementName: 'MinT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '22' } }] },
              { elementName: 'MaxT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '28' } }] }
            ]
          }] }
        }), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof globalThis.fetch
    const adapters = { http: { fetch: fetchImpl, supportsStreaming: false }, storage } as never

    // 第一次：正常問候一次。
    const first = await triggerMorningBriefing({ adapters, settings, lastUserMessageAt: null, speak: async () => true })
    expect(first).toBe(true)

    // 模擬「process 沒被砍掉，只是被滑掉又重開」：不呼叫 reset，理應保持安靜——
    // 這正是 owner 踩到的錯誤行為，寫成測試鎖住「這樣算 bug」的認知。
    expect(await shouldTriggerMorningBriefingNow(adapters, settings)).toBe(false)

    // 真正修好之後：離開前景時歸零，下一次回到前景就能再問候一次。
    resetMorningBriefingLaunchFlag()
    expect(await shouldTriggerMorningBriefingNow(adapters, settings)).toBe(true)
    const second = await triggerMorningBriefing({ adapters, settings, lastUserMessageAt: null, speak: async () => true })
    expect(second).toBe(true)
  })
})
