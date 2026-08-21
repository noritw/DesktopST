import { LocalNotifications } from '@capacitor/local-notifications'
import type { Reminder, ReminderHistoryStatus } from '@core/types'
import {
  decideReminderFire,
  occurrenceAlreadyHandled,
  offlineFallbackAllowed,
  plainReminderNotice
} from '@core/reminder/gate'
import {
  cancelAllNativeAlarms,
  cancelNativeAlarm,
  scheduleNativeAlarm,
  takeDeferredNativeAlarms
} from '../adapters/nativeAlarms'
import {
  nextDailyMs,
  nextWeeklyMs,
  nextIntervalMs,
  validWeeklyDays,
  nextFireDelayMs,
  MIN_INTERVAL_MS
} from '@core/reminder/nextFire'

/**
 * 手機端提醒排程器（Capacitor LocalNotifications）。
 *
 * 提醒觸發時發送本機通知。排程計算邏輯與桌面版一致（共用 `core/reminder/nextFire.ts`）。
 */

/**
 * 觸發時要做的事：讓角色用自己的口吻把提醒講出來，
 * 回傳講出來的那句話當通知內容。回 `null` 代表沒有角色可發話（就不發通知）。
 */
type TriggerFn = (
  reminder: Reminder
) => Promise<{
  characterName: string
  text: string
  status?: 'success' | 'offline_fallback' | 'offline_plain'
  /** 樸素提醒的通知標題（`offline_plain` 才有；那不是角色在講話） */
  plainTitle?: string
  fallbackReason?: string
} | null>

/**
 * 排程器問外界「現在的狀態」用的鉤子（由 session 注入）。
 * 抽成注入是為了讓排程器本身仍可在瀏覽器煙測與 vitest 裡跑。
 */
export interface ReminderSchedulerHooks {
  /** 目前作用中的情境 id（給 `match_scene_only` 比對） */
  getActiveSceneId: () => string | null
  /**
   * 這則提醒的快取台詞（離開前景時生成的離線底線）。
   * 交給原生鬧鐘當「App 已經被劃掉時要發什麼」，沒有就回 null。
   */
  getCachedSpeech: (reminderId: string) => { title: string; body: string } | null
  /**
   * 這一次的觸發是不是已經被別條路徑做過了（背景原生鬧鐘）。
   * 要讀**磁碟上最新的** `lastTriggeredAt`，記憶體裡那份是舊的。
   */
  occurrenceHandled?: (reminderId: string, fireAtMs: number) => Promise<boolean>
  /** 最近一次發話失敗的原因（沒有就回 undefined），寫進歷史用 */
  lastFailureReason?: () => string | undefined
  /** 記一筆歷史（含被略過的） */
  recordHistory: (
    reminder: Reminder,
    draft: { status: ReminderHistoryStatus; text?: string; characterName?: string; errorMessage?: string }
  ) => void
}

/**
 * 提醒專用的通知頻道。
 *
 * ⚠️ **不要用 Capacitor 的預設頻道**（`default`，importance=3）。
 * importance 3 只會安靜地躺進通知欄，**不會有橫幅彈出**——
 * 手機又常常在震動模式，結果就是「時間到了什麼都沒發生」
 * （owner 2026-08-09 實機回報，dumpsys 證實通知有送出但沒人看見）。
 * 提醒的重點就是要被看到，所以固定用 importance 4（HIGH）＋震動。
 *
 * 頻道建立後 **importance 就改不動了**（Android 限制，除非重裝），
 * 所以 id 帶版號，日後要調整就換一個 id。
 */
const CHANNEL_ID = 'dest-reminders-v1'

let triggerFn: TriggerFn | null = null
let hooks: ReminderSchedulerHooks | null = null
let reminders: Reminder[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let initialized = false

/**
 * `notify_on_unlock` 押後的提醒 id。
 *
 * 只留 id 不留內容：補發時要重新生成當下的台詞，
 * 押後那一刻生的話等使用者亮屏時已經過時了。
 */
const deferred = new Set<string>()

export async function initReminderScheduler(
  trigger: TriggerFn,
  schedulerHooks?: ReminderSchedulerHooks
): Promise<void> {
  triggerFn = trigger
  hooks = schedulerHooks ?? null
  initialized = true

  // 僅在 Web 環境請求通知權限
  if (typeof window !== 'undefined') {
    try {
      const status = await LocalNotifications.requestPermissions()
      if (status.display !== 'granted') {
        console.warn('[Reminder] 通知權限未授予，提醒不會跳出來')
      }
    } catch (e) {
      console.error('[Reminder] 請求通知權限失敗:', e)
    }

    // Android 專屬；其他平台會擲錯，忽略即可
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: '提醒',
        description: '排定的角色提醒',
        importance: 4,
        visibility: 1,
        vibration: true,
        lights: true
      })
      console.log('[Reminder] 通知頻道已就緒')
    } catch (e) {
      console.warn('[Reminder] 建立通知頻道失敗（非 Android 可忽略）:', e)
    }
  }
}

export function updateReminders(newReminders: Reminder[]): void {
  if (!initialized) {
    console.warn('[Reminder] updateReminders 被呼叫但排程器未初始化')
    return
  }
  console.log(`[Reminder] 更新 ${newReminders.length} 個提醒`)
  reminders = newReminders
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  /*
   * 原生鬧鐘整批清掉重排。逐一比對哪些變了不划算——
   * 提醒通常只有個位數，而漏刪一個已刪除的提醒會在使用者手機上
   * 憑空響一次，那是最難查的一種 bug。
   */
  void cancelAllNativeAlarms()
  scheduleAll()
}

function scheduleAll(): void {
  for (const r of reminders) {
    if (r.enabled && (r.notificationDevice === 'mobile' || r.notificationDevice === 'both')) {
      scheduleOne(r)
    }
  }
}

function scheduleOne(r: Reminder): void {
  clearTimerFor(r.id)

  // startup 是「程式啟動後幾秒」，屬於平台生命週期，nextFireDelayMs 刻意不處理它。
  // 桌面版在 src/main/reminderScheduler.ts 也是分開處理，這裡照同樣邏輯。
  if (r.schedule.type === 'startup') {
    console.log(`[Reminder] 排程 "${r.label}" - 啟動後 3 秒觸發`)
    const t = setTimeout(() => {
      timers.delete(r.id)
      console.log(`[Reminder] 觸發 "${r.label}"（startup）`)
      void fire(r, { fireAtMs: Date.now() })
      // startup 是重複型，觸發後不需要重新排程（下次啟動 scheduleAll 會再來一遍）
    }, 3000)
    timers.set(r.id, t)
    return
  }

  const delay = nextFireDelayMs(r.schedule, r.lastTriggeredAt)

  if (delay === null || delay <= 0) {
    console.log(`[Reminder] 跳過 "${r.label}"（延遲無效: ${delay}）`)
    return
  }

  console.log(`[Reminder] 排程 "${r.label}" - ${delay}ms 後 (${new Date(Date.now() + delay).toLocaleTimeString()})`)

  const fireAtMs = Date.now() + delay
  const t = setTimeout(() => {
    timers.delete(r.id)
    console.log(`[Reminder] 觸發 "${r.label}"`)
    void fire(r, { fireAtMs })

    if (r.schedule.type === 'once') {
      r.enabled = false
    } else if (r.enabled) {
      scheduleOne(r)
    }
  }, delay)

  timers.set(r.id, t)
  armNativeAlarm(r, fireAtMs)
}

/**
 * 原生鬧鐘比 JS 計時器晚 `NATIVE_ALARM_GRACE_MS` 觸發。
 *
 * 兩條路徑會在同一刻到期：App 活著時是 JS 生成當下的台詞，
 * App 被劃掉時只有原生鬧鐘還在。若兩者同時響，使用者會先看到快取的舊句子、
 * 幾秒後又被新句子蓋掉（同一個通知 id 重發還會再彈一次橫幅）。
 *
 * 所以讓原生慢一點，App 活著時 JS 來得及先發完並把它取消掉；
 * App 死著時就是晚這幾秒，換掉一次雙重通知很划算。
 *
 * ②b（headless 現場生成）接上之後這個偏移**仍然要留著**，而且更重要：
 * 沒有它的話，App 活著時 JS 與原生會各自生成一次，兩個 session
 * 同時寫同一個對話檔——後寫的把先寫的蓋掉。原計畫寫「②b 後拿掉偏移」，
 * 實作時發現不成立（2026-08-11）。
 */
const NATIVE_ALARM_GRACE_MS = 15_000

function armNativeAlarm(r: Reminder, fireAtMs: number): void {
  const cached = hooks?.getCachedSpeech(r.id)
  /*
   * 原生鬧鐘身上這份是「headless 整個跑不起來時」的最後底線，分三層：
   *   有快取                → 先前生成的角色台詞
   *   沒快取但允許離線提醒  → 樸素提醒事項（老實說角色講不了話）
   *   沒快取且關掉離線提醒  → 空字串，原生看到空的就不發（沉浸模式）
   *
   * 中間那層是 2026-08-11 補的：原本沒快取一律送空字串，於是離線時整則
   * 提醒被吞掉——而「連不上網時仍要提醒」的開關明明是開著的。
   */
  const plain = offlineFallbackAllowed(r) ? plainReminderNotice(r) : null
  void scheduleNativeAlarm({
    id: r.id,
    triggerAtMs: fireAtMs + NATIVE_ALARM_GRACE_MS,
    occurrenceAtMs: fireAtMs,
    title: cached?.title ?? plain?.title ?? '提醒',
    body: cached?.body ?? plain?.body ?? '',
    wakeMode: r.wakeMode ?? 'always',
    inactiveBehavior: r.inactiveBehavior ?? 'skip'
  })
}

/**
 * 重新註冊所有原生鬧鐘（快取台詞刷新後呼叫）。
 * 原生那邊存的是「App 死掉時要發的話」，刷了快取沒同步過去就等於沒刷。
 */
export function rearmNativeAlarms(): void {
  for (const r of reminders) {
    if (!r.enabled) continue
    if (r.notificationDevice === 'desktop') continue
    if (r.schedule.type === 'startup') continue
    const delay = nextFireDelayMs(r.schedule, r.lastTriggeredAt)
    if (delay === null || delay <= 0) continue
    armNativeAlarm(r, Date.now() + delay)
  }
}

function clearTimerFor(id: string): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
}

/**
 * 螢幕是否亮著。
 *
 * 純 JS 排程器只能看 `document.visibilityState`——App 在前景就代表螢幕亮著。
 * 反過來不成立（App 在背景不等於螢幕暗），所以背景時**保守回報 true**，
 * 寧可多響也不要該響的沒響。真正精準的判定要等原生層的
 * `PowerManager.isInteractive()`（計畫書 §5.2 的 `ReminderAlarmReceiver`）。
 */
function screenLikelyOn(): boolean {
  // 目前一律回 true（見上方註解）。原生層接上後改成問 PowerManager。
  return true
}

/**
 * 亮屏／回到前景時補發押後的提醒（`inactiveBehavior: 'notify_on_unlock'`）。
 * 由 session 在 `appStateChange → active` 時呼叫。
 */
export function flushDeferredReminders(): void {
  // 原生層押後的（螢幕暗著時鬧鐘響過）也在這裡一起撈回來補發
  void takeDeferredNativeAlarms().then((nativeIds) => {
    for (const id of nativeIds) {
      const r = reminders.find((x) => x.id === id)
      if (r?.enabled) {
        console.log(`[Reminder] 補發原生押後的提醒 "${r.label}"`)
        void fire(r, { skipGate: true })
      }
    }
  })

  if (deferred.size === 0) return
  const ids = [...deferred]
  deferred.clear()
  for (const id of ids) {
    const r = reminders.find((x) => x.id === id)
    if (r?.enabled) {
      console.log(`[Reminder] 補發押後的提醒 "${r.label}"`)
      void fire(r, { skipGate: true })
    }
  }
}

async function fire(
  reminder: Reminder,
  opts?: { skipGate?: boolean; fireAtMs?: number }
): Promise<void> {
  /*
   * 這一次是不是已經有人做過了？
   *
   * JS 計時器在 App 被凍結時不會觸發，**回到前景時會補跑**——
   * 而那時原生鬧鐘早就在背景把這次提醒做完了。少了這道檢查，
   * 使用者會在解鎖後看到同一則提醒又生成一次（owner 2026-08-11 實機回報）。
   */
  if (opts?.fireAtMs != null && hooks?.occurrenceHandled) {
    const handled = await hooks.occurrenceHandled(reminder.id, opts.fireAtMs)
    if (handled) {
      console.log(`[Reminder] "${reminder.label}" 這次已由背景處理過，略過補跑`)
      return
    }
  }

  /*
   * 該不該響的判定集中在 `core/reminder/gate.ts`——
   * 手機 JS 排程器、原生喚醒後的 headless 執行、桌面三條路徑共用同一份判斷，
   * 否則同一則提醒會在不同路徑上得到不同結果。
   */
  if (!opts?.skipGate) {
    const decision = decideReminderFire(reminder, {
      activeSceneId: hooks?.getActiveSceneId() ?? null,
      screenOn: screenLikelyOn()
    })
    if (decision.action === 'skip') {
      console.log(`[Reminder] 略過 "${reminder.label}"（${decision.status}）`)
      hooks?.recordHistory(reminder, { status: decision.status })
      return
    }
    if (decision.action === 'defer') {
      console.log(`[Reminder] 押後 "${reminder.label}"，等亮屏時補發`)
      deferred.add(reminder.id)
      return
    }
  }

  /*
   * **在開始生成之前**就把原生鬧鐘取消掉。
   *
   * 不能等發完通知才取消：生成慢（網路差）超過 15 秒的話，原生鬧鐘會醒來
   * 另起一個 headless WebView，變成同一則提醒**兩次 LLM 呼叫**，
   * 而且兩個 session 會同時寫同一個對話檔——後寫的把先寫的蓋掉。
   *
   * 代價是 App 剛好在生成途中被殺掉時這次就沒了；下次回到前景會重排。
   * 比起雙重生成與掉訊息，這個代價小得多。
   */
  void cancelNativeAlarm(reminder.id)

  try {
    /*
     * 先讓角色說話，再拿它講的內容當通知。
     *
     * ⚠️ **通知內容不可以是 `reminder.prompt`**——那是「給角色的指令」
     * （例：「提醒我喝水」），不是要給使用者看的文案。直接照搬的話
     * 這功能就跟一般行事曆沒兩樣，而提醒的賣點正是角色用自己的口吻講。
     * 桌面版一直都是走 LLM，手機得一致（owner 2026-08-09）。
     *
     * 這裡會等 LLM 回來（數秒），通知因此比排定時間晚一點點跳，
     * 這是刻意的取捨：寧可晚幾秒也要是角色的話。
     */
    const spoken = triggerFn ? await triggerFn(reminder) : null
    if (!spoken) {
      /*
       * 兩種情況會走到這：沒有可發話的角色，或者現場生成失敗又沒有可用的
       * 快取／使用者關掉了離線降級。後者是**刻意安靜**（維持沉浸感），
       * 但仍要留一筆歷史，否則使用者只會覺得「它就是沒響」而查不出原因。
       */
      console.log(`[Reminder] "${reminder.label}" 無台詞可發，不發通知`)
      hooks?.recordHistory(reminder, {
        status: 'skipped_offline',
        errorMessage: hooks.lastFailureReason?.()
      })
      return
    }

    // 僅在 Web 環境發送本機通知
    if (typeof window !== 'undefined') {
      const notifId = hashStringToNumber(reminder.id)
      console.log(`[Reminder] 發送通知: ${spoken.characterName}「${spoken.text.slice(0, 30)}…」`)
      await LocalNotifications.schedule({
        notifications: [
          {
            title: spoken.plainTitle ?? spoken.characterName,
            body: spoken.text,
            largeBody: spoken.text,
            summaryText: reminder.label || '提醒',
            id: notifId,
            channelId: CHANNEL_ID,
            smallIcon: 'ic_launcher_foreground',
            autoCancel: true
          }
        ]
      })
      console.log(`[Reminder] 通知已發送`)
      hooks?.recordHistory(reminder, {
        status: spoken.status ?? 'success',
        text: spoken.text,
        characterName: spoken.characterName,
        errorMessage: spoken.fallbackReason
      })
    } else {
      console.log(`[Reminder] 跳過通知（非 Web 環境）`)
    }
  } catch (e) {
    console.error('[Reminder] 觸發失敗:', e)
    hooks?.recordHistory(reminder, {
      status: 'skipped_offline',
      errorMessage: e instanceof Error ? e.message : String(e)
    })
  }
}

function hashStringToNumber(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  const absHash = Math.abs(hash)
  return (absHash % 2147483647) + 1
}

export function stopReminderScheduler(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  initialized = false
}
