import {
  defaultProactiveWeatherSettings,
  diffWeatherEvents,
  gateProactiveEvents,
  normalizeWeatherWatchSnapshot,
  observeWeather,
  thresholdsFromProactiveSettings,
  type WeatherEvent,
  type WeatherWatchSnapshot
} from '@core/weather'
import * as keys from '@core/store/keys'
import type { PlatformAdapters } from '@core/adapters'
import type { AppSettings, Conversation } from '@core/types'

/**
 * 天氣主動發話（獨立模式）。設計依據：`docs/weather-proactive-mobile-kickoff.md`。
 *
 * 判斷邏輯全部在 `core/weather/proactive.ts`（平台無關，跟桌面共用）；這裡只負責
 * 手機平台的事：讀設定、打 API、存快照、算今天已發幾則、影子模式寫 log、
 * 接上 `reminderSpeak.ts` 的 `speakWeatherEvent()`。
 *
 * 這一版只接 App resume 觸發（kickoff §8 第 3 步）；小工具 `onUpdate` 轉交
 * 原生前景服務是之後才做的第 7 步。
 */

/** 兩個觸發來源（小工具／resume）共用同一個最小間隔，見 kickoff §3.3。 */
export const MIN_POLL_INTERVAL_MS = 3 * 60 * 60 * 1000

const SHADOW_LOG_KEEP = 200

function taipeiDateString(now: number): string {
  return new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })
}

async function appendShadowLog(adapters: PlatformAdapters, events: WeatherEvent[]): Promise<void> {
  if (events.length === 0) return
  try {
    const existing = (await adapters.storage.readJson<string[]>(keys.WEATHER_PROACTIVE_SHADOW_LOG_KEY)) ?? []
    const lines = events.map(
      e => `[${new Date(e.occurredAt).toISOString()}] (shadow) ${e.kind}: ${e.injectionText.replace(/\n/g, ' / ')}`
    )
    const next = [...existing, ...lines].slice(-SHADOW_LOG_KEEP)
    await adapters.storage.writeJson(keys.WEATHER_PROACTIVE_SHADOW_LOG_KEY, next)
  } catch (e) {
    console.error('[weatherProactive] shadow log write failed:', e)
  }
}

export interface WeatherProactiveCheckDeps {
  adapters: PlatformAdapters
  settings: AppSettings
  getActiveConversation: () => Conversation | null
  /** 回傳是否真的講出來了（走底線失敗、模型回空訊息時應回 false）。 */
  speak: (injectionText: string) => Promise<boolean>
  /** debug 按鈕限定：略過 §3.3 的節流間隔，見 kickoff §9.2。 */
  ignoreThrottle?: boolean
}

export interface WeatherProactiveCheckResult {
  /** 沒跑或沒講出來的原因；`undefined` 代表真的講了 */
  skippedReason?: 'disabled' | 'no_api_key' | 'throttled' | 'no_event' | 'gated' | 'shadow'
  spoke: boolean
}

/**
 * 跑一次天氣主動發話檢查。呼叫端（`session.ts` 的 resume 處理）只需要
 * 提供最小相依，其餘全部在這支裡完成。
 */
export async function checkWeatherProactive(deps: WeatherProactiveCheckDeps): Promise<WeatherProactiveCheckResult> {
  const w = deps.settings.weather
  const proactive = { ...defaultProactiveWeatherSettings(), ...w?.proactive }
  if (!proactive.enabled) return { skippedReason: 'disabled', spoke: false }

  const rq = w?.realtimeQuery
  const apiKey = rq?.cwaApiKey && !rq.cwaApiKey.startsWith('enc:v1:') ? rq.cwaApiKey : ''
  const county = rq?.forecastCounty || w?.locationName || ''
  if (!apiKey) return { skippedReason: 'no_api_key', spoke: false }

  const now = Date.now()
  const rawSnapshot = await deps.adapters.storage.readJson<unknown>(keys.WEATHER_WATCH_SNAPSHOT_KEY)
  const snapshot = normalizeWeatherWatchSnapshot(rawSnapshot)

  // 節流：起 headless WebView 才是貴的部分（kickoff §3.1），不是每次 API 呼叫都要算。
  if (!deps.ignoreThrottle && snapshot.lastPolledAt > 0 && now - snapshot.lastPolledAt < MIN_POLL_INTERVAL_MS) {
    return { skippedReason: 'throttled', spoke: false }
  }

  const observed = await observeWeather({ http: deps.adapters.http }, apiKey, county, now)
  const thresholds = thresholdsFromProactiveSettings(proactive)
  const { events, next } = diffWeatherEvents(snapshot, observed, now, thresholds)

  // 每日計數是「呼叫端自己管理」的欄位，diffWeatherEvents 只是透傳；先落盤一次，
  // 就算後面發話失敗，「已經查過了」與「今天發過幾則」都不會遺失。
  await deps.adapters.storage.writeJson(keys.WEATHER_WATCH_SNAPSHOT_KEY, next)

  if (events.length === 0) return { skippedReason: 'no_event', spoke: false }

  const today = taipeiDateString(now)
  const firedTodayCount = next.firedTodayDate === today ? next.firedTodayCount : 0

  const conv = deps.getActiveConversation()
  const lastUserMessageAt = conv?.messages?.length
    ? [...conv.messages].reverse().find(m => m.role === 'user')?.timestamp ?? null
    : null

  const toSpeak = gateProactiveEvents(events, proactive, { now, firedTodayCount, lastUserMessageAt })
  if (toSpeak.length === 0) return { skippedReason: 'gated', spoke: false }

  if (proactive.shadowMode) {
    await appendShadowLog(deps.adapters, toSpeak)
    return { skippedReason: 'shadow', spoke: false }
  }

  let spokeCount = 0
  let bumpedCount = firedTodayCount
  for (const ev of toSpeak) {
    const ok = await deps.speak(ev.injectionText)
    if (ok) {
      spokeCount += 1
      // 好天氣邀約不佔每日額度（跟桌面 `bumpFiredCount()` 一致）。
      if (ev.kind !== 'nice_day') bumpedCount += 1
    }
  }

  if (spokeCount > 0) {
    const finalSnapshot: WeatherWatchSnapshot = { ...next, firedTodayDate: today, firedTodayCount: bumpedCount }
    await deps.adapters.storage.writeJson(keys.WEATHER_WATCH_SNAPSHOT_KEY, finalSnapshot)
  }

  return { spoke: spokeCount > 0 }
}
