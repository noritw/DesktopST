import { bootStandaloneSession } from '../runtime/session'
import { getHeadlessBridge, headlessReminderParams, hlog } from './bridge'
import { headlessAdapters } from './bridgeAdapters'

/**
 * 提醒到點時，在背景生成當下的台詞。
 *
 * 這支跑在 `ReminderForegroundService` 起的隱藏 WebView 裡，
 * 載的就是**一般的手機版 HTML**（帶 `?headless=reminder`），
 * 所以 `reminderSpeak.ts`／`chat.ts` 一行都不用改（計畫書 §2.1）。
 *
 * 流程：
 *   原生 → 這裡 boot 一個 headless session → session.runReminderHeadless()
 *   → 結果交回原生 → 原生發通知 → 服務結束
 *
 * ⚠️ **無論如何都要呼叫 `complete()`**。沒回報的話原生會一直等到 45 秒逾時，
 * 白白讓前景服務跟通知欄那則「正在準備提醒⋯⋯」多掛半分鐘。
 */

export interface HeadlessResult {
  notify: boolean
  title?: string
  body?: string
  /** 給 logcat 看的：success／offline_fallback／skipped_scene_mismatch… */
  reason: string
  /**
   * 要不要讓原生改用「註冊鬧鐘時存下的快取台詞」。
   *
   * 只有在 **TS 這條路整個壞掉**（adapters 拿不到、例外）時才是 true。
   * 「情境不符」「使用者關掉離線降級」那些是**判定結果**，
   * TS 側已經考慮過快取了（`reminderSpeakDeps` 有帶 `cachedText`），
   * 原生不可以再自作主張補一則——那會讓「安靜略過」失效。
   */
  useCache?: boolean
}

export async function runHeadlessReminder(): Promise<void> {
  const params = headlessReminderParams()
  const bridge = getHeadlessBridge()
  if (!params || !bridge) return

  const done = (result: HeadlessResult): void => {
    hlog(`結束：${result.reason}${result.notify ? `（發通知）` : '（不發通知）'}`)
    bridge.complete(JSON.stringify(result))
  }

  try {
    hlog(`啟動，提醒 ${params.reminderId}，螢幕${params.screenOn ? '亮著' : '暗著'}`)
    const adapters = headlessAdapters()
    if (!adapters) {
      done({ notify: false, reason: 'no-adapters', useCache: true })
      return
    }

    /*
     * `headless: true`：不啟動提醒排程器、不建立對話。
     * 這一趟只讀資料生一句話，不該在背景默默改動使用者的東西。
     */
    const session = await bootStandaloneSession(adapters, { headless: true, skipPackFetch: true })
    hlog(`資料載入完成：${session.characters.length} 個角色、${session.reminders.length} 則提醒`)

    const outcome = await session.runReminderHeadless(
      params.reminderId,
      params.screenOn,
      params.occurrenceAtMs
    )
    done(outcome)
  } catch (e) {
    /*
     * 這裡吞掉例外是刻意的：headless 崩掉不該讓提醒完全沒下文。
     * 回報 notify:false，原生會改用註冊鬧鐘時存的快取台詞當底線。
     */
    hlog(`失敗：${e instanceof Error ? e.message : String(e)}`)
    done({ notify: false, reason: 'error', useCache: true })
  }
}
