import { bootStandaloneSession } from '../runtime/session'
import { getHeadlessBridge, headlessWeatherProactiveParams, hlog } from './bridge'
import { headlessAdapters } from './bridgeAdapters'

/**
 * 小工具 `onUpdate` 轉交的天氣主動發話／早安簡報 headless 檢查。
 * 設計依據：`docs/weather-proactive-mobile-kickoff.md` §3.4／§8 第 7 步。
 *
 * 跟提醒的 headless（`reminderHeadless.ts`）是同一套機制、同一個
 * `HeadlessBridge`／隱藏 WebView，只是原生端啟動它的觸發源不同
 * （這裡是 `DeSTWidgetProvider.onUpdate()` 判斷節流間隔到了，不是鬧鐘）。
 *
 * 流程：原生（`WeatherForegroundService`）→ 這裡 boot 一個 headless session
 * → `session.runProactiveGreetingsHeadless()` → 結果交回原生
 * → 原生視需要發通知＋直接呼叫 `DeSTWidgetProvider.updateAll()` → 服務結束。
 *
 * ⚠️ **無論如何都要呼叫 `complete()`**，理由同 `reminderHeadless.ts`。
 */

export interface WeatherHeadlessResult {
  notify: boolean
  title?: string
  body?: string
  avatarBase64?: string
  reason: string
}

export async function runHeadlessWeatherProactive(): Promise<void> {
  if (!headlessWeatherProactiveParams()) return
  const bridge = getHeadlessBridge()
  if (!bridge) return

  const done = (result: WeatherHeadlessResult): void => {
    hlog(`天氣主動發話 headless 結束：${result.reason}${result.notify ? '（發通知）' : '（不發通知）'}`)
    bridge.complete(JSON.stringify(result))
  }

  try {
    hlog('天氣主動發話 headless 啟動')
    const adapters = headlessAdapters()
    if (!adapters) {
      done({ notify: false, reason: 'no-adapters' })
      return
    }

    // `headless: true`：不啟動提醒排程器、不建立對話，只讀資料判斷要不要講一句。
    const session = await bootStandaloneSession(adapters, { headless: true, skipPackFetch: true })
    hlog(`資料載入完成：${session.characters.length} 個角色`)

    const outcome = await session.runProactiveGreetingsHeadless()
    done(outcome)
  } catch (e) {
    hlog(`失敗：${e instanceof Error ? e.message : String(e)}`)
    done({ notify: false, reason: 'error' })
  }
}
