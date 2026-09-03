import * as fs from 'fs'
import * as path from 'path'
import {
  diffWeatherEvents,
  gateProactiveEvents,
  thresholdsFromProactiveSettings,
  type WeatherEvent,
  type WeatherWatchSnapshot
} from '../core/weather'
import { observeWeather } from './weatherService'
import { loadWeatherWatchSnapshot, saveWeatherWatchSnapshot } from './fileStore'
import { getDataDir } from './dataDir'
import { getWeatherWatcherContextDirect, speakWeatherEventDirect } from './ipcHandlers'

/**
 * 天氣主動發話排程器（桌面限定）。
 *
 * 設計依據：`docs/weather-proactive-speech-kickoff.md`。判斷邏輯全部在
 * `core/weather/proactive.ts`（`diffWeatherEvents()` 偵測轉變、
 * `gateProactiveEvents()` 套剎車）；這裡只負責平台的事：定時打 API、
 * 存快照、算今天已發幾則、影子模式寫 log、接上 `speakWeatherEventDirect()`。
 *
 * 三種輪詢間隔不同（地震要快、預報類慢），各自獨立計時器，理由見 kickoff §6.1。
 */

const EARTHQUAKE_POLL_MS = 5 * 60 * 1000
const TYPHOON_POLL_MS = 30 * 60 * 1000
const FORECAST_POLL_MS = 60 * 60 * 1000
const STARTUP_DELAY_MS = 30 * 1000

let snapshot: WeatherWatchSnapshot | null = null
let firedTodayDate = ''
let firedTodayCount = 0
let earthquakeTimer: ReturnType<typeof setInterval> | null = null
let typhoonTimer: ReturnType<typeof setInterval> | null = null
let forecastTimer: ReturnType<typeof setInterval> | null = null
let startupTimer: ReturnType<typeof setTimeout> | null = null
let running = false

export function initWeatherWatcher(): void {
  if (running) return
  running = true
  snapshot = loadWeatherWatchSnapshot()

  startupTimer = setTimeout(() => {
    startupTimer = null
    void pollEarthquake()
    void pollTyphoon()
    void pollForecast()
  }, STARTUP_DELAY_MS)

  earthquakeTimer = setInterval(() => { void pollEarthquake() }, EARTHQUAKE_POLL_MS)
  typhoonTimer = setInterval(() => { void pollTyphoon() }, TYPHOON_POLL_MS)
  forecastTimer = setInterval(() => { void pollForecast() }, FORECAST_POLL_MS)
}

export function stopWeatherWatcher(): void {
  running = false
  if (startupTimer) { clearTimeout(startupTimer); startupTimer = null }
  if (earthquakeTimer) { clearInterval(earthquakeTimer); earthquakeTimer = null }
  if (typhoonTimer) { clearInterval(typhoonTimer); typhoonTimer = null }
  if (forecastTimer) { clearInterval(forecastTimer); forecastTimer = null }
}

function todayDateString(now: number): string {
  return new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
}

function bumpFiredCount(kinds: WeatherEvent['kind'][], now: number): void {
  const today = todayDateString(now)
  if (firedTodayDate !== today) {
    firedTodayDate = today
    firedTodayCount = 0
  }
  // 好天氣邀約不佔每日額度（kickoff §7.6）
  firedTodayCount += kinds.filter(k => k !== 'nice_day').length
}

function currentFiredTodayCount(now: number): number {
  const today = todayDateString(now)
  return firedTodayDate === today ? firedTodayCount : 0
}

function appendShadowLog(events: WeatherEvent[]): void {
  if (events.length === 0) return
  try {
    const logPath = path.join(getDataDir(), 'weather-proactive-shadow.log')
    const lines = events
      .map(e => `[${new Date(e.occurredAt).toISOString()}] (shadow) ${e.kind}: ${e.injectionText.replace(/\n/g, ' / ')}`)
      .join('\n') + '\n'
    fs.appendFileSync(logPath, lines, 'utf8')
  } catch (e) {
    console.error('[weatherWatcher] shadow log write failed:', e)
  }
}

export interface WeatherPollResult {
  /** 沒跑：原因（總開關關閉／沒有 CWA 金鑰） */
  skippedReason?: 'disabled' | 'no_api_key'
  /** `diffWeatherEvents()` 算出的所有轉變事件（尚未套用剎車） */
  rawEvents: WeatherEvent[]
  /** 套過 `gateProactiveEvents()` 剎車後，真的會發話／寫影子 log 的事件 */
  gatedEvents: WeatherEvent[]
  shadowMode: boolean
  /** 影子模式或發話是否實際執行了（rawEvents 為空時兩者都是 false） */
  spoke: boolean
}

async function runPoll(): Promise<WeatherPollResult> {
  if (!snapshot) snapshot = loadWeatherWatchSnapshot()
  const ctx = getWeatherWatcherContextDirect()
  if (!ctx.proactive.enabled) return { skippedReason: 'disabled', rawEvents: [], gatedEvents: [], shadowMode: ctx.proactive.shadowMode, spoke: false }
  if (!ctx.cwaApiKey) return { skippedReason: 'no_api_key', rawEvents: [], gatedEvents: [], shadowMode: ctx.proactive.shadowMode, spoke: false }

  const observed = await observeWeather(ctx.cwaApiKey, ctx.county)
  const now = Date.now()
  const thresholds = thresholdsFromProactiveSettings(ctx.proactive)
  const { events, next } = diffWeatherEvents(snapshot, observed, now, thresholds)
  snapshot = next
  saveWeatherWatchSnapshot(next)

  if (events.length === 0) return { rawEvents: [], gatedEvents: [], shadowMode: ctx.proactive.shadowMode, spoke: false }

  const toSpeak = gateProactiveEvents(events, ctx.proactive, {
    now,
    firedTodayCount: currentFiredTodayCount(now),
    lastUserMessageAt: ctx.lastUserMessageAt
  })

  if (ctx.proactive.shadowMode) {
    appendShadowLog(toSpeak)
    return { rawEvents: events, gatedEvents: toSpeak, shadowMode: true, spoke: toSpeak.length > 0 }
  }

  for (const ev of toSpeak) {
    bumpFiredCount([ev.kind], now)
    try {
      await speakWeatherEventDirect(ev.injectionText)
    } catch (e) {
      console.error('[weatherWatcher] speak failed:', e)
    }
  }
  return { rawEvents: events, gatedEvents: toSpeak, shadowMode: false, spoke: toSpeak.length > 0 }
}

/**
 * debug 限定：設定頁的「立即輪詢一次」按鈕用，不必等 5–60 分鐘的排程間隔。
 * 邏輯跟排程輪詢完全相同（同一支 `runPoll()`），只是手動觸發、並把結果回傳給畫面看。
 */
const MANUAL_POLL_TIMEOUT_MS = 15 * 1000

/**
 * debug 按鈕的保險絲：`observeWeather()` 內部三支 CWA API 各自有 5 秒逾時，
 * 理論上不會卡住，但畫面卡死一次代價很大（整個設定視窗連關都關不掉）——
 * 這裡再包一層絕對上限，逾時就回傳明確的錯誤而不是讓 `await` 永遠不 resolve。
 */
export async function triggerManualPoll(): Promise<WeatherPollResult> {
  try {
    return await Promise.race([
      runPoll(),
      new Promise<WeatherPollResult>((_, reject) => {
        setTimeout(() => reject(new Error('逾時（15 秒內未完成，可能是網路連線卡住）')), MANUAL_POLL_TIMEOUT_MS)
      })
    ])
  } catch (e) {
    console.error('[weatherWatcher] manual poll failed:', e)
    const stack = e instanceof Error ? e.stack : undefined
    throw new Error(stack ? `${e instanceof Error ? e.message : String(e)}\n${stack}` : String(e))
  }
}

/**
 * 地震輪詢額外扛著「休眠喚醒補跑」的責任——它的間隔最短，最先發現
 * 「距上次輪詢已經超過 2 小時」（電腦休眠喚醒／APP 剛啟動很久沒跑）。
 * 補跑就是這次 `runPoll()` 本身，不必再跑第二次
 * （地震事件仍受 30 分鐘時效限制，不會補講過期的那些）。
 */
async function pollEarthquake(): Promise<void> {
  await runPoll()
}

async function pollTyphoon(): Promise<void> {
  await runPoll()
}

async function pollForecast(): Promise<void> {
  await runPoll()
}
