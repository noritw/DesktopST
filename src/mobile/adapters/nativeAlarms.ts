import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 原生鬧鐘（`ReminderPlugin.java`）的 JS 介面。
 *
 * 為什麼提醒不能只靠 `setTimeout`：JS 計時器活在 WebView 裡，
 * App 被劃掉或系統進 Doze 就整個消失——而「App 劃掉之後還要響」
 * 正是獨立版提醒的整個重點（owner 切獨立版的主因）。
 *
 * ⚠️ **外掛一律動態載入／能力偵測**。瀏覽器煙測與 vitest 沒有原生層，
 * 這裡的每一支都要在非原生環境安靜地什麼都不做，不能在載入時就炸
 * （CLAUDE.md 有這條坑）。
 */

export interface NativeAlarmSpec {
  id: string
  triggerAtMs: number
  /**
   * 這一次**原本預定**的觸發時刻（不含刻意延後的 15 秒）。
   *
   * headless 用它比對「這次是不是已經被前景那條做掉了」。
   * 不能拿 `triggerAtMs` 當基準——那是延後過的，比對會差 15 秒而漏判。
   */
  occurrenceAtMs: number
  /** 通知標題，通常是角色名字 */
  title: string
  /**
   * 通知內文＝**離開前景時生成的快取台詞**（離線底線，計畫書 §2.1）。
   * 空字串代表沒有可用台詞，原生層會選擇不發通知而不是硬擠一則出來。
   */
  body: string
  wakeMode?: 'always' | 'screen_on_only'
  inactiveBehavior?: 'skip' | 'notify_on_unlock'
}

/** {@link notifyNative} 送給原生外掛的參數。 */
export interface NativeNotifySpec {
  /** 提醒 id；原生用它算出通知 id，同一則提醒重複觸發時覆蓋自己而不是疊成一排。 */
  id: string
  title: string
  body: string
  summaryText?: string
  /** 頭像圖檔的 base64（不含 `data:` 前綴）；沒有就不設大圖示。 */
  avatarBase64?: string
}

interface DestRemindersPlugin {
  schedule(spec: NativeAlarmSpec): Promise<void>
  cancel(opts: { id: string }): Promise<void>
  cancelAll(): Promise<void>
  takeDeferred(): Promise<{ ids: string[] }>
  canScheduleExact(): Promise<{ granted: boolean; applicable: boolean }>
  openExactAlarmSettings(): Promise<void>
  notify(spec: NativeNotifySpec): Promise<void>
}

const plugin = registerPlugin<DestRemindersPlugin>('DestReminders')

/** 只有 Android 原生殼裡才有這個外掛。 */
export function nativeAlarmsAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export async function scheduleNativeAlarm(spec: NativeAlarmSpec): Promise<void> {
  if (!nativeAlarmsAvailable()) return
  try {
    await plugin.schedule(spec)
  } catch (e) {
    console.warn('[Reminder] 註冊原生鬧鐘失敗:', e)
  }
}

export async function cancelNativeAlarm(id: string): Promise<void> {
  if (!nativeAlarmsAvailable()) return
  try {
    await plugin.cancel({ id })
  } catch (e) {
    console.warn('[Reminder] 取消原生鬧鐘失敗:', e)
  }
}

export async function cancelAllNativeAlarms(): Promise<void> {
  if (!nativeAlarmsAvailable()) return
  try {
    await plugin.cancelAll()
  } catch (e) {
    console.warn('[Reminder] 清除原生鬧鐘失敗:', e)
  }
}

/**
 * 取回「已到期但因螢幕暗著而押後」的提醒 id。
 * 拿到之後要**重新生成當下的台詞**再發——押後那一刻生的話已經過時了。
 */
export async function takeDeferredNativeAlarms(): Promise<string[]> {
  if (!nativeAlarmsAvailable()) return []
  try {
    const { ids } = await plugin.takeDeferred()
    return Array.isArray(ids) ? ids : []
  } catch (e) {
    console.warn('[Reminder] 取回押後提醒失敗:', e)
    return []
  }
}

/**
 * 精準鬧鐘授權狀態。
 *
 * `applicable: false` 代表這台裝置的 Android 版本沒有這個開關（11 以下），
 * UI 就不必顯示引導。`granted: false` 時鬧鐘會退回不精準模式（誤差可能數分鐘），
 * **要讓使用者知道**，不能靜默失敗。
 */
export async function exactAlarmPermission(): Promise<{ granted: boolean; applicable: boolean }> {
  if (!nativeAlarmsAvailable()) return { granted: true, applicable: false }
  try {
    return await plugin.canScheduleExact()
  } catch {
    return { granted: true, applicable: false }
  }
}

/**
 * App 活著時發提醒通知，走原生外掛而非 `LocalNotifications`——
 * 只有這樣才能塞角色頭像當大圖示（見 `reminderScheduler.ts` 呼叫端的說明）。
 * 回 `false` 代表沒發成功（不在原生殼裡，或外掛呼叫失敗），呼叫端要自己退回
 * `LocalNotifications`。
 */
export async function notifyNative(spec: NativeNotifySpec): Promise<boolean> {
  if (!nativeAlarmsAvailable()) return false
  try {
    await plugin.notify(spec)
    return true
  } catch (e) {
    console.warn('[Reminder] 原生通知失敗:', e)
    return false
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!nativeAlarmsAvailable()) return
  try {
    await plugin.openExactAlarmSettings()
  } catch (e) {
    console.warn('[Reminder] 開啟系統設定失敗:', e)
  }
}
