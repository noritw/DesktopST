import { describe, expect, it } from 'vitest'
import type { HttpAdapter } from '@core/adapters'
import {
  DEFAULT_THRESHOLDS,
  diffWeatherEvents,
  emptySnapshot,
  findIntensityForCounty,
  normalizeCountyName,
  observeWeather,
  parseIntensity,
  type ObservedWeather
} from '@core/weather'

const NOW = new Date('2026-08-25T10:00:00+08:00').getTime()

function baseForecast(overrides: Partial<NonNullable<ObservedWeather['forecast']>> = {}) {
  return {
    todayMaxT: 28,
    tomorrowWx: '多雲時晴',
    tomorrowPoP: 10,
    tomorrowMaxT: 29,
    todayRainy: false,
    ...overrides
  }
}

function observed(overrides: Partial<ObservedWeather> = {}): ObservedWeather {
  return {
    todayDate: '2026-08-25',
    earthquakes: [],
    typhoons: [],
    forecast: baseForecast(),
    ...overrides
  }
}

describe('parseIntensity', () => {
  it('parses plain level', () => {
    expect(parseIntensity('3級')).toBe(3)
  })
  it('parses 弱／強 with correct ordering', () => {
    expect(parseIntensity('5弱')).toBe(4.5)
    expect(parseIntensity('5強')).toBe(5.5)
    expect(parseIntensity('6弱')).toBeLessThan(parseIntensity('6強'))
  })
  it('handles empty/undefined', () => {
    expect(parseIntensity(undefined)).toBe(0)
    expect(parseIntensity('')).toBe(0)
  })
})

describe('normalizeCountyName / findIntensityForCounty', () => {
  it('treats 臺/台 as equivalent', () => {
    expect(normalizeCountyName('臺北市')).toBe(normalizeCountyName('台北市'))
  })
  it('finds intensity for matching county regardless of 臺/台', () => {
    const areas = [
      { CountyName: '臺北市', AreaIntensity: '4級' },
      { CountyName: '新北市', AreaIntensity: '3級' }
    ]
    expect(findIntensityForCounty(areas, '台北市')).toEqual({ intensity: 4, areaName: '臺北市' })
  })
  it('returns zero intensity when county not found', () => {
    const areas = [{ CountyName: '高雄市', AreaIntensity: '2級' }]
    expect(findIntensityForCounty(areas, '台北市')).toEqual({ intensity: 0, areaName: '' })
  })
})

describe('diffWeatherEvents — earthquake', () => {
  it('fires on a new, in-threshold earthquake', () => {
    const prev = emptySnapshot()
    const { events, next } = diffWeatherEvents(prev, observed({
      earthquakes: [{
        no: 111,
        originTimeMs: NOW - 5 * 60 * 1000,
        magnitude: 5.2,
        location: '宜蘭外海',
        countyIntensity: 3,
        countyAreaName: '臺北市'
      }]
    }), NOW)
    expect(events.map(e => e.kind)).toEqual(['earthquake'])
    expect(next.seenEarthquakeNos).toContain(111)
  })

  it('does not re-fire for the same earthquake number on a later poll', () => {
    const first = diffWeatherEvents(emptySnapshot(), observed({
      earthquakes: [{ no: 111, originTimeMs: NOW - 5 * 60 * 1000, magnitude: 5.2, location: '宜蘭外海', countyIntensity: 3, countyAreaName: '臺北市' }]
    }), NOW)
    const second = diffWeatherEvents(first.next, observed({
      earthquakes: [{ no: 111, originTimeMs: NOW - 5 * 60 * 1000, magnitude: 5.2, location: '宜蘭外海', countyIntensity: 3, countyAreaName: '臺北市' }]
    }), NOW + 5 * 60 * 1000)
    expect(second.events).toHaveLength(0)
  })

  it('does not fire below intensity threshold', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      earthquakes: [{ no: 222, originTimeMs: NOW, magnitude: 3.1, location: '花蓮', countyIntensity: 2, countyAreaName: '臺北市' }]
    }), NOW)
    expect(events).toHaveLength(0)
  })

  it('downgrades to earthquake_stale when past max-age but within the stale window', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      earthquakes: [{ no: 333, originTimeMs: NOW - 60 * 60 * 1000, magnitude: 6, location: '台東', countyIntensity: 4, countyAreaName: '臺北市' }]
    }), NOW, DEFAULT_THRESHOLDS)
    expect(events.map(e => e.kind)).toEqual(['earthquake_stale'])
  })

  it('drops the earthquake entirely once past the stale window', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      earthquakes: [{ no: 444, originTimeMs: NOW - 7 * 60 * 60 * 1000, magnitude: 6, location: '台東', countyIntensity: 4, countyAreaName: '臺北市' }]
    }), NOW, DEFAULT_THRESHOLDS)
    expect(events).toHaveLength(0)
  })

  it('does not downgrade when the stale window is disabled (0)', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      earthquakes: [{ no: 555, originTimeMs: NOW - 60 * 60 * 1000, magnitude: 6, location: '台東', countyIntensity: 4, countyAreaName: '臺北市' }]
    }), NOW, { ...DEFAULT_THRESHOLDS, earthquakeStaleWindowMs: 0 })
    expect(events).toHaveLength(0)
  })

  it('orders earthquake_stale after other event kinds from the same poll', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      earthquakes: [{ no: 666, originTimeMs: NOW - 60 * 60 * 1000, magnitude: 6, location: '台東', countyIntensity: 4, countyAreaName: '臺北市' }],
      forecast: baseForecast({ tomorrowPoP: 70 })
    }), NOW, DEFAULT_THRESHOLDS)
    expect(events.map(e => e.kind)).toEqual(['rain_tomorrow', 'earthquake_stale'])
  })
})

describe('diffWeatherEvents — typhoon', () => {
  it('fires typhoon_appear on first sighting', () => {
    const { events, next } = diffWeatherEvents(emptySnapshot(), observed({
      typhoons: [{ name: '天兔', engName: 'Tapah', windSpeed: 25, movingDesc: '向北移動' }]
    }), NOW)
    expect(events.map(e => e.kind)).toEqual(['typhoon_appear'])
    expect(next.activeTyphoonNames).toEqual(['天兔'])
  })

  it('does not re-fire while the same typhoon persists', () => {
    const first = diffWeatherEvents(emptySnapshot(), observed({
      typhoons: [{ name: '天兔', engName: 'Tapah', windSpeed: 25, movingDesc: '向北移動' }]
    }), NOW)
    const second = diffWeatherEvents(first.next, observed({
      typhoons: [{ name: '天兔', engName: 'Tapah', windSpeed: 30, movingDesc: '持續北上' }]
    }), NOW + 60 * 60 * 1000)
    expect(second.events).toHaveLength(0)
  })

  it('fires typhoon_clear when it disappears from observation', () => {
    const first = diffWeatherEvents(emptySnapshot(), observed({
      typhoons: [{ name: '天兔', engName: 'Tapah', windSpeed: 25, movingDesc: '向北移動' }]
    }), NOW)
    const second = diffWeatherEvents(first.next, observed({ typhoons: [] }), NOW + 3 * 60 * 60 * 1000)
    expect(second.events.map(e => e.kind)).toEqual(['typhoon_clear'])
    expect(second.next.activeTyphoonNames).toEqual([])
  })
})

describe('diffWeatherEvents — rain_tomorrow', () => {
  it('fires when PoP crosses the threshold', () => {
    const { events, next } = diffWeatherEvents(emptySnapshot(), observed({
      forecast: baseForecast({ tomorrowPoP: 70 })
    }), NOW)
    expect(events.map(e => e.kind)).toEqual(['rain_tomorrow'])
    expect(next.rainNotifiedDates).toContain('2026-08-25')
  })

  it('does not re-fire the same day', () => {
    const first = diffWeatherEvents(emptySnapshot(), observed({ forecast: baseForecast({ tomorrowPoP: 70 }) }), NOW)
    const second = diffWeatherEvents(first.next, observed({ forecast: baseForecast({ tomorrowPoP: 80 }) }), NOW + 60 * 1000)
    expect(second.events).toHaveLength(0)
  })

  it('does not fire below threshold', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({ forecast: baseForecast({ tomorrowPoP: 40 }) }), NOW)
    expect(events).toHaveLength(0)
  })
})

describe('diffWeatherEvents — temp_swing', () => {
  it('fires when the delta crosses the threshold either direction', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      forecast: baseForecast({ todayMaxT: 30, tomorrowMaxT: 24 })
    }), NOW)
    expect(events.map(e => e.kind)).toEqual(['temp_swing'])
  })

  it('does not fire under threshold', () => {
    const { events } = diffWeatherEvents(emptySnapshot(), observed({
      forecast: baseForecast({ todayMaxT: 30, tomorrowMaxT: 27 })
    }), NOW)
    expect(events).toHaveLength(0)
  })

  it('does not re-fire the same day', () => {
    const first = diffWeatherEvents(emptySnapshot(), observed({ forecast: baseForecast({ todayMaxT: 30, tomorrowMaxT: 24 }) }), NOW)
    const second = diffWeatherEvents(first.next, observed({ forecast: baseForecast({ todayMaxT: 30, tomorrowMaxT: 23 }) }), NOW + 60 * 1000)
    expect(second.events).toHaveLength(0)
  })
})

describe('diffWeatherEvents — nice_day', () => {
  function withRecentRain(): ReturnType<typeof emptySnapshot> {
    const snap = emptySnapshot()
    snap.recentDaySummaries = [
      { date: '2026-08-23', rainy: true },
      { date: '2026-08-24', rainy: false }
    ]
    return snap
  }

  it('fires when forecast is nice, it rained recently, and interval has passed', () => {
    const { events } = diffWeatherEvents(withRecentRain(), observed({
      forecast: baseForecast({ tomorrowWx: '晴時多雲', tomorrowPoP: 10, tomorrowMaxT: 25 })
    }), NOW)
    expect(events.map(e => e.kind)).toEqual(['nice_day'])
  })

  it('does not fire without recent rain (not "久違的放晴")', () => {
    const snap = emptySnapshot()
    snap.recentDaySummaries = [
      { date: '2026-08-23', rainy: false },
      { date: '2026-08-24', rainy: false }
    ]
    const { events } = diffWeatherEvents(snap, observed({
      forecast: baseForecast({ tomorrowWx: '晴天', tomorrowPoP: 5, tomorrowMaxT: 25 })
    }), NOW)
    expect(events).toHaveLength(0)
  })

  it('does not fire before the minimum interval has elapsed', () => {
    const snap = withRecentRain()
    snap.lastNiceDayAt = NOW - 2 * 24 * 60 * 60 * 1000
    const { events } = diffWeatherEvents(snap, observed({
      forecast: baseForecast({ tomorrowWx: '晴時多雲', tomorrowPoP: 10, tomorrowMaxT: 25 })
    }), NOW)
    expect(events).toHaveLength(0)
  })

  it('does not fire when temperature is outside the comfort range', () => {
    const { events } = diffWeatherEvents(withRecentRain(), observed({
      forecast: baseForecast({ todayMaxT: 30, tomorrowWx: '晴天', tomorrowPoP: 5, tomorrowMaxT: 33 })
    }), NOW)
    expect(events.map(e => e.kind)).not.toContain('nice_day')
  })

  it('does not fire when the forecast mentions rain despite otherwise matching', () => {
    const { events } = diffWeatherEvents(withRecentRain(), observed({
      forecast: baseForecast({ tomorrowWx: '晴時陣雨', tomorrowPoP: 15, tomorrowMaxT: 25 })
    }), NOW)
    expect(events).toHaveLength(0)
  })
})

// ─── observeWeather：三支 API 的解析層 ──────────────────────────

function http(routes: Record<string, unknown>): HttpAdapter {
  return {
    supportsStreaming: false,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input)
      for (const [needle, body] of Object.entries(routes)) {
        if (url.includes(needle)) return new Response(JSON.stringify(body), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
  }
}

describe('observeWeather', () => {
  it('parses earthquake, typhoon, and forecast responses into ObservedWeather', async () => {
    const deps = {
      http: http({
        'E-A0016-001': {
          success: 'true',
          records: {
            Earthquake: [{
              EarthquakeNo: 999,
              OriginTime: '2026-08-25T09:50:00+08:00',
              EpicenterLocation: '花蓮縣近海',
              EarthquakeMagnitude: { MagnitudeValue: 5.5 },
              FocalDepth: 10,
              Intensity: { ShakingArea: [{ AreaDesc: '臺北市', CountyName: '臺北市', AreaIntensity: '3級' }] }
            }]
          }
        },
        'W-C0034-005': {
          success: 'true',
          records: { TropicalCyclones: { TropicalCyclone: [{
            CwaTyphoonName: '天兔',
            TyphoonName: 'Tapah',
            AnalysisData: { Fix: [{
              DateTime: '2026-08-25T08:00:00+08:00',
              CoordinateLongitude: '125.0', CoordinateLatitude: '20.0',
              MaxWindSpeed: '30', MaxGustSpeed: '40', Pressure: '970',
              MovingSpeed: '15', MovingDirection: 'N',
              MovingPrediction: [{ value: '向北移動', lang: 'zh-hant' }]
            }] }
          }] } }
        },
        'F-C0032-001': {
          success: 'true',
          records: { location: [{
            locationName: '臺北市',
            weatherElement: [
              { elementName: 'Wx', time: [{ startTime: '', endTime: '', parameter: { parameterName: '多雲' } }, { startTime: '', endTime: '', parameter: { parameterName: '晴時多雲' } }] },
              { elementName: 'PoP', time: [{ startTime: '', endTime: '', parameter: { parameterName: '20' } }, { startTime: '', endTime: '', parameter: { parameterName: '10' } }] },
              { elementName: 'MinT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '24' } }, { startTime: '', endTime: '', parameter: { parameterName: '23' } }] },
              { elementName: 'MaxT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '30' } }, { startTime: '', endTime: '', parameter: { parameterName: '29' } }] }
            ]
          }] }
        }
      })
    }

    const result = await observeWeather(deps, 'fake-key', '臺北市', NOW)
    expect(result.earthquakes).toHaveLength(1)
    expect(result.earthquakes[0].no).toBe(999)
    expect(result.earthquakes[0].countyIntensity).toBe(3)
    expect(result.typhoons).toHaveLength(1)
    expect(result.typhoons[0].name).toBe('天兔')
    expect(result.forecast?.tomorrowWx).toBe('晴時多雲')
    expect(result.forecast?.tomorrowPoP).toBe(10)
    expect(result.forecast?.tomorrowMaxT).toBe(29)
    expect(result.forecast?.todayMaxT).toBe(30)
  })

  it('degrades gracefully when one API call fails', async () => {
    const deps = {
      http: http({
        'F-C0032-001': {
          success: 'true',
          records: { location: [{
            locationName: '臺北市',
            weatherElement: [
              { elementName: 'Wx', time: [{ startTime: '', endTime: '', parameter: { parameterName: '晴天' } }] },
              { elementName: 'PoP', time: [{ startTime: '', endTime: '', parameter: { parameterName: '5' } }] },
              { elementName: 'MinT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '22' } }] },
              { elementName: 'MaxT', time: [{ startTime: '', endTime: '', parameter: { parameterName: '28' } }] }
            ]
          }] }
        }
        // E-A0016-001 and W-C0034-005 intentionally missing → 404
      })
    }
    const result = await observeWeather(deps, 'fake-key', '臺北市', NOW)
    expect(result.earthquakes).toEqual([])
    expect(result.typhoons).toEqual([])
    expect(result.forecast?.tomorrowWx).toBe('晴天')
  })
})

// ─── gateProactiveEvents / normalizeWeatherWatchSnapshot ────────

import {
  defaultProactiveWeatherSettings,
  gateProactiveEvents,
  normalizeWeatherWatchSnapshot
} from '@core/weather'

describe('gateProactiveEvents', () => {
  it('drops everything when the master switch is off', () => {
    const settings = defaultProactiveWeatherSettings()
    const events = [{ kind: 'earthquake' as const, occurredAt: NOW, injectionText: 'x' }]
    expect(gateProactiveEvents(events, settings, { now: NOW, firedTodayCount: 0, lastUserMessageAt: null })).toHaveLength(0)
  })

  it('drops per-kind when its own toggle is off', () => {
    const settings = { ...defaultProactiveWeatherSettings(), enabled: true, tempSwing: false }
    const events = [{ kind: 'temp_swing' as const, occurredAt: NOW, injectionText: 'x' }]
    expect(gateProactiveEvents(events, settings, { now: NOW, firedTodayCount: 0, lastUserMessageAt: null })).toHaveLength(0)
  })

  it('does not speak while the user is mid-conversation', () => {
    const settings = { ...defaultProactiveWeatherSettings(), enabled: true }
    const events = [{ kind: 'earthquake' as const, occurredAt: NOW, injectionText: 'x' }]
    const result = gateProactiveEvents(events, settings, { now: NOW, firedTodayCount: 0, lastUserMessageAt: NOW - 60_000 })
    expect(result).toHaveLength(0)
  })

  it('earthquake is exempt from quiet hours, others are not', () => {
    const settings = { ...defaultProactiveWeatherSettings(), enabled: true, quietHours: { start: 0, end: 24 } }
    const events = [
      { kind: 'earthquake' as const, occurredAt: NOW, injectionText: 'eq' },
      { kind: 'rain_tomorrow' as const, occurredAt: NOW, injectionText: 'rain' }
    ]
    const result = gateProactiveEvents(events, settings, { now: NOW, firedTodayCount: 0, lastUserMessageAt: null })
    expect(result.map(e => e.kind)).toEqual(['earthquake'])
  })

  it('earthquake_stale is NOT exempt from quiet hours (unlike fresh earthquake)', () => {
    const settings = { ...defaultProactiveWeatherSettings(), enabled: true, quietHours: { start: 0, end: 24 } }
    const events = [
      { kind: 'earthquake' as const, occurredAt: NOW, injectionText: 'eq' },
      { kind: 'earthquake_stale' as const, occurredAt: NOW, injectionText: 'stale-eq' }
    ]
    const result = gateProactiveEvents(events, settings, { now: NOW, firedTodayCount: 0, lastUserMessageAt: null })
    expect(result.map(e => e.kind)).toEqual(['earthquake'])
  })

  it('enforces the daily limit but nice_day does not consume it', () => {
    const settings = { ...defaultProactiveWeatherSettings(), enabled: true, niceDay: true, dailyLimit: 1 }
    const events = [
      { kind: 'earthquake' as const, occurredAt: NOW, injectionText: 'eq1' },
      { kind: 'rain_tomorrow' as const, occurredAt: NOW, injectionText: 'rain' },
      { kind: 'nice_day' as const, occurredAt: NOW, injectionText: 'nice' }
    ]
    // NOW is 10:00 Taipei time, within nice_day's 09-18 window
    const result = gateProactiveEvents(events, settings, { now: NOW, firedTodayCount: 0, lastUserMessageAt: null })
    expect(result.map(e => e.kind)).toEqual(['earthquake', 'nice_day'])
  })

  it('nice_day is restricted to daytime hours', () => {
    const nightTime = new Date('2026-08-25T22:00:00+08:00').getTime()
    const settings = { ...defaultProactiveWeatherSettings(), enabled: true, niceDay: true, quietHours: { start: 23, end: 8 } }
    const events = [{ kind: 'nice_day' as const, occurredAt: nightTime, injectionText: 'nice' }]
    const result = gateProactiveEvents(events, settings, { now: nightTime, firedTodayCount: 0, lastUserMessageAt: null })
    expect(result).toHaveLength(0)
  })
})

describe('normalizeWeatherWatchSnapshot', () => {
  it('returns an empty snapshot for garbage input', () => {
    expect(normalizeWeatherWatchSnapshot(null)).toEqual(emptySnapshot())
    expect(normalizeWeatherWatchSnapshot('nonsense')).toEqual(emptySnapshot())
    expect(normalizeWeatherWatchSnapshot({})).toEqual(emptySnapshot())
  })

  it('round-trips a well-formed snapshot', () => {
    const snap = {
      ...emptySnapshot(),
      seenEarthquakeNos: [1, 2, 3],
      activeTyphoonNames: ['天兔'],
      lastNiceDayAt: 12345
    }
    expect(normalizeWeatherWatchSnapshot(snap)).toEqual(snap)
  })

  it('drops malformed array entries instead of throwing', () => {
    const raw = { ...emptySnapshot(), seenEarthquakeNos: [1, 'bad', 2] }
    expect(normalizeWeatherWatchSnapshot(raw).seenEarthquakeNos).toEqual([1, 2])
  })
})
