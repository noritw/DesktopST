import type { WeatherDeps } from './providers'
import { cwaFetch } from './cwa'
import type { CwaForecastResponse } from './cwa'
import type { CwaEqResponse, CwaTyphoonResponse } from './realtimeQuery'

/**
 * 天氣主動發話：偵測「轉變」而不是「狀態」（設計依據見
 * `docs/weather-proactive-speech-kickoff.md` §2）。
 *
 * 核心是 `diffWeatherEvents()`：純函式，輸入上次快照與這次觀測，輸出「該講的
 * 事件」與「新快照」。呼叫端（`main/weatherWatcher.ts`）只負責打 API、存檔、
 * 排程——判斷邏輯全部在這裡，方便用 fixture 錄放測試，不必等真的地震。
 */

// ─── 快照與事件型別 ───────────────────────────────────────────

export interface WeatherWatchSnapshot {
  /** 已經講過的地震編號（CWA 的 EarthquakeNo），只留最近 20 筆 */
  seenEarthquakeNos: number[]
  /** 上次觀測到的颱風中文名清單；空陣列＝當時無颱風 */
  activeTyphoonNames: string[]
  /** 已經發過「明日降雨」的日期（YYYY-MM-DD，台北時區），只留最近 7 筆 */
  rainNotifiedDates: string[]
  /** 已經發過「變天」的日期，同上 */
  tempSwingNotifiedDates: string[]
  /** 上次發出好天氣邀約的時間戳；0＝從未 */
  lastNiceDayAt: number
  /** 過去幾天的天氣概況（判斷「久違的放晴」用），只留最近 5 天 */
  recentDaySummaries: Array<{ date: string; rainy: boolean }>
  /** 上次成功輪詢的時間戳 */
  lastPolledAt: number
}

/** 把磁碟讀回的未知資料正規化成合法快照；壞掉／缺欄位一律退回空快照的對應欄位。 */
export function normalizeWeatherWatchSnapshot(raw: unknown): WeatherWatchSnapshot {
  const empty = emptySnapshot()
  if (!raw || typeof raw !== 'object') return empty
  const r = raw as Partial<WeatherWatchSnapshot>
  return {
    seenEarthquakeNos: Array.isArray(r.seenEarthquakeNos) ? r.seenEarthquakeNos.filter(n => typeof n === 'number') : empty.seenEarthquakeNos,
    activeTyphoonNames: Array.isArray(r.activeTyphoonNames) ? r.activeTyphoonNames.filter(n => typeof n === 'string') : empty.activeTyphoonNames,
    rainNotifiedDates: Array.isArray(r.rainNotifiedDates) ? r.rainNotifiedDates.filter(n => typeof n === 'string') : empty.rainNotifiedDates,
    tempSwingNotifiedDates: Array.isArray(r.tempSwingNotifiedDates) ? r.tempSwingNotifiedDates.filter(n => typeof n === 'string') : empty.tempSwingNotifiedDates,
    lastNiceDayAt: typeof r.lastNiceDayAt === 'number' ? r.lastNiceDayAt : empty.lastNiceDayAt,
    recentDaySummaries: Array.isArray(r.recentDaySummaries)
      ? r.recentDaySummaries.filter((d): d is { date: string; rainy: boolean } =>
          !!d && typeof d.date === 'string' && typeof d.rainy === 'boolean')
      : empty.recentDaySummaries,
    lastPolledAt: typeof r.lastPolledAt === 'number' ? r.lastPolledAt : empty.lastPolledAt
  }
}

export function emptySnapshot(): WeatherWatchSnapshot {
  return {
    seenEarthquakeNos: [],
    activeTyphoonNames: [],
    rainNotifiedDates: [],
    tempSwingNotifiedDates: [],
    lastNiceDayAt: 0,
    recentDaySummaries: [],
    lastPolledAt: 0
  }
}

export type WeatherEventKind =
  | 'earthquake'
  | 'typhoon_appear'
  | 'typhoon_clear'
  | 'rain_tomorrow'
  | 'temp_swing'
  | 'nice_day'

export interface WeatherEvent {
  kind: WeatherEventKind
  /** 注入給 LLM 的事實描述，格式比照 `[即時查詢：...]` */
  injectionText: string
  /** 事件發生時間（地震＝發震時間；其餘＝觀測時間） */
  occurredAt: number
}

// ─── 觀測輸入（呼叫端從三支 CWA API 解析後傳進來） ──────────────

export interface ObservedEarthquake {
  no: number
  originTimeMs: number
  magnitude: number
  location: string
  /** 使用者所在縣市的震度數值（已用 `parseIntensity` 轉過），查不到給 0 */
  countyIntensity: number
  countyAreaName: string
}

export interface ObservedTyphoon {
  name: string
  engName: string
  windSpeed: number
  movingDesc: string
}

export interface ObservedForecast {
  /** 今日最高溫（觀測當下這一天） */
  todayMaxT: number | null
  /** 明日天氣描述（Wx） */
  tomorrowWx: string
  /** 明日降雨機率（白天，0–100） */
  tomorrowPoP: number | null
  /** 明日最高溫 */
  tomorrowMaxT: number | null
  /** 今天是否下雨（供好天氣邀約的「過去 3 天內至少 1 天下過雨」判斷用） */
  todayRainy: boolean
}

export interface ObservedWeather {
  /** 台北時區的日期字串 YYYY-MM-DD，觀測當下的「今天」 */
  todayDate: string
  earthquakes: ObservedEarthquake[]
  typhoons: ObservedTyphoon[]
  forecast: ObservedForecast | null
}

// ─── 門檻設定 ─────────────────────────────────────────────────

export interface ProactiveThresholds {
  earthquakeMinIntensity: number
  earthquakeMaxAgeMs: number
  rainThreshold: number
  tempSwingThreshold: number
  niceDayMinIntervalDays: number
  niceDayMinTemp: number
  niceDayMaxTemp: number
  niceDayMaxPoP: number
}

export const DEFAULT_THRESHOLDS: ProactiveThresholds = {
  earthquakeMinIntensity: 3,
  earthquakeMaxAgeMs: 30 * 60 * 1000,
  rainThreshold: 60,
  tempSwingThreshold: 5,
  niceDayMinIntervalDays: 7,
  niceDayMinTemp: 20,
  niceDayMaxTemp: 29,
  niceDayMaxPoP: 20
}

// ─── 核心：偵測轉變 ───────────────────────────────────────────

const RECENT_DAYS_KEEP = 5
const NOTIFIED_DATES_KEEP = 7
const EARTHQUAKE_NOS_KEEP = 20

export function diffWeatherEvents(
  prev: WeatherWatchSnapshot,
  observed: ObservedWeather,
  now: number,
  thresholds: ProactiveThresholds = DEFAULT_THRESHOLDS
): { events: WeatherEvent[]; next: WeatherWatchSnapshot } {
  const events: WeatherEvent[] = []
  const next: WeatherWatchSnapshot = {
    seenEarthquakeNos: [...prev.seenEarthquakeNos],
    activeTyphoonNames: [...prev.activeTyphoonNames],
    rainNotifiedDates: [...prev.rainNotifiedDates],
    tempSwingNotifiedDates: [...prev.tempSwingNotifiedDates],
    lastNiceDayAt: prev.lastNiceDayAt,
    recentDaySummaries: [...prev.recentDaySummaries],
    lastPolledAt: now
  }

  // ── 地震：新編號 + 在時效內 + 震度達標 ──
  for (const eq of observed.earthquakes) {
    if (next.seenEarthquakeNos.includes(eq.no)) continue
    next.seenEarthquakeNos.push(eq.no)
    const ageMs = now - eq.originTimeMs
    if (ageMs >= 0 && ageMs <= thresholds.earthquakeMaxAgeMs && eq.countyIntensity >= thresholds.earthquakeMinIntensity) {
      events.push({
        kind: 'earthquake',
        occurredAt: eq.originTimeMs,
        injectionText:
          `[天氣事件：地震]\n` +
          `剛剛發生地震，規模 M${eq.magnitude}，震央：${eq.location}，` +
          `${eq.countyAreaName}震度 ${eq.countyIntensity} 級。`
      })
    }
  }
  if (next.seenEarthquakeNos.length > EARTHQUAKE_NOS_KEEP) {
    next.seenEarthquakeNos = next.seenEarthquakeNos.slice(-EARTHQUAKE_NOS_KEEP)
  }

  // ── 颱風：有無的轉變 ──
  const prevNames = new Set(prev.activeTyphoonNames)
  const observedNames = new Set(observed.typhoons.map(t => t.name))
  for (const t of observed.typhoons) {
    if (!prevNames.has(t.name)) {
      events.push({
        kind: 'typhoon_appear',
        occurredAt: now,
        injectionText:
          `[天氣事件：颱風發布]\n` +
          `中央氣象署發布颱風「${t.name}」${t.engName ? `（${t.engName}）` : ''}消息，` +
          `${t.movingDesc || '動態尚待觀察'}，近中心最大風速每秒 ${t.windSpeed} 公尺。`
      })
    }
  }
  for (const name of prevNames) {
    if (!observedNames.has(name)) {
      events.push({
        kind: 'typhoon_clear',
        occurredAt: now,
        injectionText: `[天氣事件：颱風解除]\n颱風「${name}」的警報已經解除。`
      })
    }
  }
  next.activeTyphoonNames = [...observedNames]

  // ── 預報類：明日降雨 / 變天 / 好天氣邀約 ──
  const f = observed.forecast
  if (f) {
    const today = observed.todayDate

    if (
      f.tomorrowPoP !== null &&
      f.tomorrowPoP >= thresholds.rainThreshold &&
      !next.rainNotifiedDates.includes(today)
    ) {
      next.rainNotifiedDates.push(today)
      events.push({
        kind: 'rain_tomorrow',
        occurredAt: now,
        injectionText:
          `[天氣事件：明日降雨]\n明天白天降雨機率 ${f.tomorrowPoP}%，天氣描述：${f.tomorrowWx}。`
      })
    }
    if (next.rainNotifiedDates.length > NOTIFIED_DATES_KEEP) {
      next.rainNotifiedDates = next.rainNotifiedDates.slice(-NOTIFIED_DATES_KEEP)
    }

    if (
      f.todayMaxT !== null &&
      f.tomorrowMaxT !== null &&
      Math.abs(f.tomorrowMaxT - f.todayMaxT) >= thresholds.tempSwingThreshold &&
      !next.tempSwingNotifiedDates.includes(today)
    ) {
      next.tempSwingNotifiedDates.push(today)
      const delta = f.tomorrowMaxT - f.todayMaxT
      events.push({
        kind: 'temp_swing',
        occurredAt: now,
        injectionText:
          `[天氣事件：明日變天]\n明天最高溫 ${f.tomorrowMaxT}°C，比今天${delta > 0 ? '高' : '低'} ${Math.abs(delta)}°C。`
      })
    }
    if (next.tempSwingNotifiedDates.length > NOTIFIED_DATES_KEEP) {
      next.tempSwingNotifiedDates = next.tempSwingNotifiedDates.slice(-NOTIFIED_DATES_KEEP)
    }

    // recentDaySummaries：先推今天的觀測，再判斷好天氣邀約（用推入後的視窗）
    if (!next.recentDaySummaries.some(d => d.date === today)) {
      next.recentDaySummaries.push({ date: today, rainy: f.todayRainy })
      if (next.recentDaySummaries.length > RECENT_DAYS_KEEP) {
        next.recentDaySummaries = next.recentDaySummaries.slice(-RECENT_DAYS_KEEP)
      }
    }

    const isNiceForecast =
      /晴|多雲/.test(f.tomorrowWx) &&
      !/雨|雪/.test(f.tomorrowWx) &&
      f.tomorrowPoP !== null && f.tomorrowPoP <= thresholds.niceDayMaxPoP &&
      f.tomorrowMaxT !== null &&
      f.tomorrowMaxT >= thresholds.niceDayMinTemp &&
      f.tomorrowMaxT <= thresholds.niceDayMaxTemp

    const rainyRecently = next.recentDaySummaries.slice(-3).some(d => d.rainy)
    const intervalOk = now - prev.lastNiceDayAt >= thresholds.niceDayMinIntervalDays * 24 * 60 * 60 * 1000

    if (isNiceForecast && rainyRecently && intervalOk) {
      next.lastNiceDayAt = now
      events.push({
        kind: 'nice_day',
        occurredAt: now,
        injectionText:
          `[天氣事件：好天氣邀約]\n最近下過雨，明天終於轉為${f.tomorrowWx}，` +
          `最高溫 ${f.tomorrowMaxT}°C，降雨機率只有 ${f.tomorrowPoP}%，是難得適合出門的好天氣。`
      })
    }
  }

  return { events, next }
}

// ─── 震度字串解析 ─────────────────────────────────────────────

/**
 * CWA 的震度是字串（如 `"3級"`、`"5弱"`、`"5強"`），不能直接 `parseInt` 排序——
 * `"6強"` 會被讀成 6，跟 `"6弱"` 混同。弱／強各偏移 ±0.5。
 */
export function parseIntensity(s: string | undefined | null): number {
  if (!s) return 0
  const m = s.match(/(\d+)\s*(弱|強|級)?/)
  if (!m) return 0
  const base = Number(m[1])
  if (m[2] === '弱') return base - 0.5
  if (m[2] === '強') return base + 0.5
  return base
}

/** 「臺北市」「台北市」視為同一個縣市；比對前先正規化。 */
export function normalizeCountyName(name: string): string {
  return name.replace(/臺/g, '台').trim()
}

export function findIntensityForCounty(
  areas: Array<{ areaName: string; areaIntensity: string }>,
  county: string
): { intensity: number; areaName: string } {
  const target = normalizeCountyName(county)
  const hit = areas.find(a => normalizeCountyName(a.areaName).includes(target) || target.includes(normalizeCountyName(a.areaName)))
  if (!hit) return { intensity: 0, areaName: '' }
  return { intensity: parseIntensity(hit.areaIntensity), areaName: hit.areaName }
}

// ─── 觀測：打三支 CWA API，組成 ObservedWeather ────────────────

function taipeiDateString(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }) // sv-SE 給 YYYY-MM-DD
}

export async function observeWeather(
  deps: WeatherDeps,
  apiKey: string,
  county: string,
  now: number = Date.now()
): Promise<ObservedWeather> {
  const [eqResult, typhoonResult, forecastResult] = await Promise.allSettled([
    cwaFetch(deps, 'E-A0016-001', { limit: '5' }, apiKey) as Promise<CwaEqResponse>,
    cwaFetch(deps, 'W-C0034-005', {}, apiKey) as Promise<CwaTyphoonResponse>,
    cwaFetch(deps, 'F-C0032-001', { elementName: 'Wx,PoP,MinT,MaxT', locationName: county }, apiKey) as Promise<CwaForecastResponse>
  ])

  const earthquakes: ObservedEarthquake[] = []
  if (eqResult.status === 'fulfilled' && eqResult.value.success === 'true') {
    for (const eq of eqResult.value.records?.Earthquake ?? []) {
      const areas = eq.Intensity?.ShakingArea ?? []
      const { intensity, areaName } = findIntensityForCounty(areas, county)
      earthquakes.push({
        no: eq.EarthquakeNo,
        originTimeMs: new Date(eq.OriginTime).getTime(),
        magnitude: eq.EarthquakeMagnitude?.MagnitudeValue ?? 0,
        location: eq.EpicenterLocation ?? '未知',
        countyIntensity: intensity,
        countyAreaName: areaName || county
      })
    }
  }

  const typhoons: ObservedTyphoon[] = []
  if (typhoonResult.status === 'fulfilled' && typhoonResult.value.success === 'true') {
    const cyclones = typhoonResult.value.records?.TropicalCyclones?.TropicalCyclone ?? []
    for (const tc of cyclones) {
      const name = tc.CwaTyphoonName ?? tc.TyphoonName ?? '未命名'
      const fixes = tc.AnalysisData?.Fix
      const latest = fixes && fixes.length > 0 ? fixes[fixes.length - 1] : null
      typhoons.push({
        name,
        engName: tc.TyphoonName ?? '',
        windSpeed: latest ? parseFloat(latest.MaxWindSpeed) || 0 : 0,
        movingDesc: latest?.MovingPrediction?.find(p => p.lang === 'zh-hant')?.value ?? ''
      })
    }
  }

  let forecast: ObservedForecast | null = null
  if (forecastResult.status === 'fulfilled' && forecastResult.value.success === 'true') {
    const loc = forecastResult.value.records?.location?.[0]
    if (loc) {
      const getEl = (name: string) => loc.weatherElement.find(e => e.elementName === name)
      const wx = getEl('Wx')
      const pop = getEl('PoP')
      const minT = getEl('MinT')
      const maxT = getEl('MaxT')

      const wxToday = wx?.time[0]?.parameter.parameterName ?? ''
      const wxTomorrow = wx?.time[1]?.parameter.parameterName ?? wxToday
      const popTomorrow = pop?.time[1]?.parameter.parameterName
      const maxTToday = maxT?.time[0]?.parameter.parameterName
      const maxTTomorrow = maxT?.time[1]?.parameter.parameterName ?? maxT?.time[0]?.parameter.parameterName

      forecast = {
        todayMaxT: maxTToday !== undefined ? Number(maxTToday) : null,
        tomorrowWx: wxTomorrow,
        tomorrowPoP: popTomorrow !== undefined ? Number(popTomorrow) : null,
        tomorrowMaxT: maxTTomorrow !== undefined ? Number(maxTTomorrow) : null,
        todayRainy: /雨/.test(wxToday)
      }
    }
  }

  return {
    todayDate: taipeiDateString(new Date(now)),
    earthquakes,
    typhoons,
    forecast
  }
}

// ─── 設定 ↔ 判斷邏輯的橋接 ─────────────────────────────────────

export function defaultProactiveWeatherSettings(): import('../types').WeatherProactiveSettings {
  return {
    enabled: false,
    earthquake: true,
    earthquakeMinIntensity: DEFAULT_THRESHOLDS.earthquakeMinIntensity,
    typhoon: true,
    rainTomorrow: true,
    rainThreshold: DEFAULT_THRESHOLDS.rainThreshold,
    tempSwing: false,
    tempSwingThreshold: DEFAULT_THRESHOLDS.tempSwingThreshold,
    niceDay: false,
    niceDayMinIntervalDays: DEFAULT_THRESHOLDS.niceDayMinIntervalDays,
    dailyLimit: 3,
    quietHours: { start: 23, end: 8 },
    shadowMode: true
  }
}

/** 把使用者可調的設定欄位換成 `diffWeatherEvents()` 要的門檻物件。 */
export function thresholdsFromProactiveSettings(
  s: import('../types').WeatherProactiveSettings
): ProactiveThresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    earthquakeMinIntensity: s.earthquakeMinIntensity,
    rainThreshold: s.rainThreshold,
    tempSwingThreshold: s.tempSwingThreshold,
    niceDayMinIntervalDays: s.niceDayMinIntervalDays
  }
}

const KIND_TO_TOGGLE: Record<WeatherEventKind, keyof import('../types').WeatherProactiveSettings | null> = {
  earthquake: 'earthquake',
  typhoon_appear: 'typhoon',
  typhoon_clear: 'typhoon',
  rain_tomorrow: 'rainTomorrow',
  temp_swing: 'tempSwing',
  nice_day: 'niceDay'
}

/** 是否在台北時區的靜音時段內；`start > end` 代表跨午夜（如 23→8）。 */
function isWithinQuietHours(now: number, quietHours: { start: number; end: number }): boolean {
  const hour = Number(new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }))
  const { start, end } = quietHours
  if (start === end) return false
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end
}

export interface ProactiveGateContext {
  now: number
  /** 今天已經發過幾則（不含好天氣邀約，見 kickoff §7.6） */
  firedTodayCount: number
  /** 最後一則使用者訊息時間；null 代表沒有對話或不受限 */
  lastUserMessageAt: number | null
}

/**
 * 把 `diffWeatherEvents()` 算出的事件，過濾成「真的該講」的清單（kickoff §7 的剎車）。
 *
 * 規則優先序：逐事件開關 → 對話進行中不插話 → 地震不受靜音時段限制、
 * 其餘事件受限 → 好天氣邀約另有自己的時段限制且不佔每日額度 → 每日總量上限。
 */
export function gateProactiveEvents(
  events: WeatherEvent[],
  settings: import('../types').WeatherProactiveSettings,
  ctx: ProactiveGateContext
): WeatherEvent[] {
  if (!settings.enabled) return []

  const conversationBusy = ctx.lastUserMessageAt !== null && (ctx.now - ctx.lastUserMessageAt) < 2 * 60 * 1000
  if (conversationBusy) return []

  const result: WeatherEvent[] = []
  let dailyCount = ctx.firedTodayCount

  for (const ev of events) {
    const toggle = KIND_TO_TOGGLE[ev.kind]
    if (toggle && !settings[toggle]) continue

    if (ev.kind === 'nice_day') {
      const hour = Number(new Date(ctx.now).toLocaleString('en-US', { timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false }))
      if (hour < 9 || hour >= 18) continue
      result.push(ev)
      continue
    }

    if (ev.kind !== 'earthquake' && isWithinQuietHours(ctx.now, settings.quietHours)) continue
    if (dailyCount >= settings.dailyLimit) continue

    dailyCount += 1
    result.push(ev)
  }

  return result
}
