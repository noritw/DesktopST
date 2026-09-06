import {
  isConversationTooRecent,
  normalizeMorningBriefingSnapshot,
  shouldGreetToday,
  taipeiDateString,
  type MorningBriefingContent
} from '@core/greeting'
import { filterAndPick } from '@core/news/filter'
import { fetchBreakoutItems } from '@core/news/sources'
import { loadNewsModuleSettings } from '@core/news/settings'
import { getWeatherContextString } from '@core/weather'
import * as keys from '@core/store/keys'
import type { PlatformAdapters } from '@core/adapters'
import type { AppSettings } from '@core/types'
import { domRssParser } from '../adapters/rssParseAdapter'

/**
 * 今日初次問候（早安簡報）獨立模式版。設計依據：
 * `docs/weather-proactive-mobile-kickoff.md` §7。
 *
 * 桌面是天氣 → 行程 → 熱搜三選一（`main/morningBriefing.ts`）；手機獨立版
 * 沒接 Google 日曆（授權仍只在桌面），所以只有天氣 → 熱搜兩層，
 * `fetchCalendarLayer()` 對應那層直接省略，不是 bug（kickoff §7.2）。
 *
 * 功能內部代號叫「早安簡報」，但實際觸發時機是「今天第一次理這個 App」，
 * 不保證是早上——塞進 prompt 的文字絕對不能寫死「早安」，見 `TIME_NEUTRAL_HINT`。
 */
const TIME_NEUTRAL_HINT = '現在不一定是早上，依當下實際時間用合適的語氣打招呼即可，不要預設或提到「早安」兩個字。'

async function fetchWeatherLayer(adapters: PlatformAdapters, settings: AppSettings): Promise<MorningBriefingContent | null> {
  const text = await getWeatherContextString(settings, { http: adapters.http })
  if (!text) return null
  return {
    source: 'weather',
    injectionText:
      `[今日初次互動：天氣]\n${text}\n這是使用者今天第一次跟你互動，用你的角色語氣打聲招呼，` +
      `自然帶到天氣就好，不要條列數據。${TIME_NEUTRAL_HINT}`
  }
}

async function fetchTrendingLayer(adapters: PlatformAdapters, settings: AppSettings): Promise<MorningBriefingContent | null> {
  const newsSettings = await loadNewsModuleSettings(adapters.storage)
  if (!newsSettings.enabled) return null
  if (!newsSettings.breakout.enabled) return null
  try {
    const items = await fetchBreakoutItems(
      { http: adapters.http, rss: domRssParser },
      newsSettings.breakout.weight,
      { zhOnly: newsSettings.breakout.zhOnly !== false }
    )
    const result = filterAndPick(items, newsSettings)
    if (!result.picked) return null
    return {
      source: 'trending',
      injectionText:
        `[今日初次互動：熱搜]\n今天台灣熱搜第一名是「${result.picked.title}」。` +
        `這是使用者今天第一次跟你互動，打聲招呼之餘可以隨口提一下這個話題，` +
        `但不用假裝很懂，也可以直接問使用者有沒有在關注。${TIME_NEUTRAL_HINT}`
    }
  } catch (e) {
    console.error('[morningBriefing] fetchTrendingLayer failed:', e)
    return null
  }
}

/** 依序嘗試天氣→熱搜，撈到第一個有內容的就回傳；兩層都沒有回 null。 */
export async function buildMorningBriefingContent(
  adapters: PlatformAdapters,
  settings: AppSettings
): Promise<MorningBriefingContent | null> {
  return (await fetchWeatherLayer(adapters, settings)) ?? (await fetchTrendingLayer(adapters, settings))
}

/**
 * 快速檢查：總開關有開，而且今天還沒講過，才值得往下抓內容。
 * 不做任何慢動作（不打 API、不等 LLM），呼叫端可以在 resume 當下同步判斷。
 */
export async function shouldTriggerMorningBriefingNow(
  adapters: PlatformAdapters,
  settings: AppSettings,
  now: number = Date.now()
): Promise<boolean> {
  if (!settings.morningBriefing?.enabled) return false
  const raw = await adapters.storage.readJson<unknown>(keys.MORNING_BRIEFING_KEY)
  return shouldGreetToday(normalizeMorningBriefingSnapshot(raw), taipeiDateString(now))
}

export interface MorningBriefingCheckDeps {
  adapters: PlatformAdapters
  settings: AppSettings
  lastUserMessageAt: number | null
  /** 回傳是否真的講出來了。 */
  speak: (injectionText: string) => Promise<boolean>
}

/**
 * 早安簡報主流程：對話進行中不插話 → 抓內容 → 講 → 講成功才蓋掉「今天講過了」旗標。
 * 呼叫端先用 `shouldTriggerMorningBriefingNow()` 快速檢查，通過後才呼叫這支。
 *
 * headless 與前景是不同程序，記憶體旗標擋不到跨程序併發——這支本身沒有記憶體旗標，
 * 靠磁碟旗標（寫入前再讀一次 `shouldTriggerMorningBriefingNow()`）擋，
 * 呼叫端負責在「決定要跑」與「真的寫入」之間不要留太久的空窗。
 */
export async function triggerMorningBriefing(deps: MorningBriefingCheckDeps): Promise<boolean> {
  const now = Date.now()
  if (isConversationTooRecent(deps.lastUserMessageAt, now)) return false

  const content = await buildMorningBriefingContent(deps.adapters, deps.settings)
  if (!content) return false

  const spoke = await deps.speak(content.injectionText)
  if (!spoke) return false

  await deps.adapters.storage.writeJson(keys.MORNING_BRIEFING_KEY, { lastGreetedDate: taipeiDateString(now) })
  return true
}
