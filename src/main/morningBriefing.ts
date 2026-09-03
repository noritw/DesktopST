/**
 * 早安簡報：三層內容抓取（天氣 → 行程 → 熱搜），逐層 try，第一個有內容的就回傳，
 * 都沒有就回 null。設計依據見 `docs/morning-briefing-kickoff.md` §3／§4。
 *
 * 三層都是既有邏輯的薄組合，不重寫：
 * - 天氣：`weatherService.getWeatherContextString()`（背景天氣，已處理啟用／位置檢查）
 * - 行程：`calendar.getCalendarContextString()`（已處理啟用／授權／`mentionWhenEmpty`）
 * - 熱搜：`fetchBreakoutItems()` + `filterAndPick()`（黑名單／來源排除全部沿用）
 */
import type { MorningBriefingContent } from '../core/greeting'
import { isConversationTooRecent, shouldGreetToday, taipeiDateString } from '../core/greeting'
import { filterAndPick } from '../core/news/filter'
import { NEWS_MODULE_ID } from '../core/news/moduleId'
import {
  getLastUserMessageAtDirect,
  getSettings,
  isModuleEffectivelyEnabled,
  speakMorningBriefingDirect
} from './ipcHandlers'
import { getWeatherContextString } from './weatherService'
import { getCalendarContextString } from './calendar'
import { fetchBreakoutItems } from './modules/news/sources'
import { loadNewsModuleSettings } from './modules/news/settings'
import { loadMorningBriefingSnapshot, saveMorningBriefingSnapshot } from './fileStore'

// 功能內部代號叫「早安簡報」，但實際觸發時機是「今天第一次理這個 App」，
// 不保證是早上（使用者半夜才開機也會觸發，見 kickoff §1／§2.3）。
// 所以這裡塞進 prompt 的文字絕對不能寫死「早安」，要讓角色自己依當下時間判斷
// 該用什麼問候語——2026-09-04 owner 半夜實測抓到「早安簡報」四個字被角色照唸出來。
const TIME_NEUTRAL_HINT = '現在不一定是早上，依當下實際時間用合適的語氣打招呼即可，不要預設或提到「早安」兩個字。'

async function fetchWeatherLayer(): Promise<MorningBriefingContent | null> {
  const text = await getWeatherContextString(getSettings())
  if (!text) return null
  return {
    source: 'weather',
    injectionText:
      `[今日初次互動：天氣]\n${text}\n這是使用者今天第一次跟你互動，用你的角色語氣打聲招呼，` +
      `自然帶到天氣就好，不要條列數據。${TIME_NEUTRAL_HINT}`
  }
}

async function fetchCalendarLayer(): Promise<MorningBriefingContent | null> {
  const text = await getCalendarContextString(getSettings())
  if (!text) return null
  return {
    source: 'calendar',
    injectionText:
      `[今日初次互動：行程]\n${text}\n這是使用者今天第一次跟你互動，打聲招呼，` +
      `可以自然提到今天行程比較滿／很空，不用整份唸出來。${TIME_NEUTRAL_HINT}`
  }
}

async function fetchTrendingLayer(): Promise<MorningBriefingContent | null> {
  const newsSettings = loadNewsModuleSettings()
  if (!isModuleEffectivelyEnabled(NEWS_MODULE_ID, newsSettings.enabled)) return null
  if (!newsSettings.breakout.enabled) return null
  try {
    const items = await fetchBreakoutItems(newsSettings.breakout.weight, {
      zhOnly: newsSettings.breakout.zhOnly !== false
    })
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

/** 依序嘗試天氣→行程→熱搜，撈到第一個有內容的就回傳；三層都沒有回 null。 */
export async function buildMorningBriefingContent(): Promise<MorningBriefingContent | null> {
  return (await fetchWeatherLayer()) ?? (await fetchCalendarLayer()) ?? (await fetchTrendingLayer())
}

// 同一個行程中避免併發觸發兩次：`browser-window-focus` 一天可能連續觸發好幾次，
// 旗標要等內容抓完＋講完才會落盤（§3.3：三層都空就不留旗標），這段等待期間
// 需要這個記憶體旗標擋住第二次觸發，磁碟旗標只負責跨行程（重開 App）那一層。
let inFlight = false

/**
 * 給呼叫端（桌面 `browser-window-focus`、手機 `onAppResumed`）用的同步、快速檢查：
 * 總開關有開，而且今天還沒講過，才值得丟 `triggerMorningBriefing()` 到背景。
 * 不做任何慢動作（不打 API、不等 LLM），符合 kickoff §2.1 對 focus handler 的要求。
 */
export function shouldTriggerMorningBriefingNow(now: number = Date.now()): boolean {
  if (!getSettings().morningBriefing?.enabled) return false
  return shouldGreetToday(loadMorningBriefingSnapshot(), taipeiDateString(now))
}

/**
 * 早安簡報主流程：對話進行中不插話 → 抓內容 → 講 → 講成功才蓋掉「今天講過了」旗標。
 * 呼叫端先用 `shouldTriggerMorningBriefingNow()` 快速檢查，通過後
 * `void triggerMorningBriefing()` 丟到背景，不要 await。
 */
export async function triggerMorningBriefing(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const now = Date.now()
    if (isConversationTooRecent(getLastUserMessageAtDirect(), now)) return

    const content = await buildMorningBriefingContent()
    if (!content) return

    await speakMorningBriefingDirect(content.injectionText)
    saveMorningBriefingSnapshot({ lastGreetedDate: taipeiDateString(now) })
  } catch (e) {
    console.error('[morningBriefing] triggerMorningBriefing failed:', e)
  } finally {
    inFlight = false
  }
}
