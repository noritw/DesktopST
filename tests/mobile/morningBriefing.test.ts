import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@core/types'
import type { AppSettings } from '@core/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { shouldTriggerMorningBriefingNow, triggerMorningBriefing } from '../../src/mobile/runtime/morningBriefing'
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
})
