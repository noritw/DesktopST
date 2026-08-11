import type { Reminder, ReminderHistoryStatus } from '../types'

/**
 * 「這則提醒現在該不該響」的判定（純邏輯）。
 *
 * 抽出來的原因：這個判斷有三個來源（手機 JS 排程器、Android 原生喚醒後的
 * headless 執行、以及桌面），措辭一旦各寫一套就會出現「同一則提醒在不同
 * 路徑上響或不響」的鬼問題。判定只在這裡，呼叫端只負責提供當下狀態。
 *
 * ⚠️ 原生層**不做**這個判定（見 `docs/mobile-standalone-reminder-plan.md` §2.1）——
 * Java 那側只負責喚醒與發通知，`sceneConstraint` 比對走這支。
 */

export type ReminderGateDecision =
  /** 照常觸發 */
  | { action: 'fire' }
  /** 不觸發，且不補發；`status` 直接寫進歷史紀錄 */
  | { action: 'skip'; status: ReminderHistoryStatus }
  /** 這次先不發，等下次螢幕亮起時補發 */
  | { action: 'defer' }

export interface ReminderGateContext {
  /** 目前作用中的情境 id；沒有情境時為 null */
  activeSceneId: string | null
  /**
   * 觸發當下螢幕是否亮著。
   * 無法判定的平台（桌面、瀏覽器煙測）傳 `true`，等於不啟用 screen_on_only 的限制。
   */
  screenOn: boolean
}

export function decideReminderFire(reminder: Reminder, ctx: ReminderGateContext): ReminderGateDecision {
  /*
   * 情境比對排在螢幕判定前面：情境不符是「這則提醒根本不該在現在這個世界觀裡出現」，
   * 跟螢幕亮不亮無關，也不該被 notify_on_unlock 補發。
   * （日常提醒在 TRPG 跑團中途跳出來會直接破壞沉浸感——這正是這個欄位存在的理由。）
   */
  if (reminder.sceneId && reminder.sceneConstraint === 'match_scene_only') {
    if (ctx.activeSceneId !== reminder.sceneId) {
      return { action: 'skip', status: 'skipped_scene_mismatch' }
    }
  }

  if (reminder.wakeMode === 'screen_on_only' && !ctx.screenOn) {
    return reminder.inactiveBehavior === 'notify_on_unlock'
      ? { action: 'defer' }
      : { action: 'skip', status: 'skipped_idle' }
  }

  return { action: 'fire' }
}

/**
 * 現場生成失敗時該怎麼辦。
 *
 * `allowOfflineFallback` 未設定時視為 `true`——舊資料沒有這個欄位，
 * 而「該響的沒響」比「響得平淡」嚴重得多，預設要響。
 */
export function offlineFallbackAllowed(reminder: Reminder): boolean {
  return reminder.allowOfflineFallback !== false
}

/**
 * 同一次觸發被兩條路徑各做一遍的防重複。
 *
 * ⚠️ 這是實機打出來的：JS `setTimeout` 在 App 被凍結時不會觸發，
 * **回到前景時會補跑**。原生鬧鐘早就在背景把那次提醒做完了
 * （owner 2026-08-11：22:41 響過一次，22:47 解鎖時又生成了一次，
 * 對話多一則、提醒紀錄多一筆）。
 *
 * 取消原生鬧鐘擋不住這個方向——要反過來讓 JS 這條先問
 * 「這一次的觸發是不是已經有人做過了」。判斷依據是**磁碟上最新的**
 * `lastTriggeredAt`：背景那條跑完就會寫進去，前景記憶體裡的是舊的。
 */
export const FIRE_DEDUPE_SLACK_MS = 5_000

/**
 * `fireAtMs` 是這個計時器**原本預定**的觸發時刻（不是現在）。
 * 只要已經有人在那個時刻前後觸發過，就代表這一次已經被消化掉了。
 */
export function occurrenceAlreadyHandled(
  lastTriggeredAt: number | undefined,
  fireAtMs: number,
  slackMs: number = FIRE_DEDUPE_SLACK_MS
): boolean {
  if (!lastTriggeredAt) return false
  return lastTriggeredAt >= fireAtMs - slackMs
}
