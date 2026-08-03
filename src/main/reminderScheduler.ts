import { powerMonitor } from 'electron'
import * as fileStore from './fileStore'
import { nextDailyMs, nextWeeklyMs, nextIntervalMs, validWeeklyDays, MIN_INTERVAL_MS } from '../core/reminder/nextFire'
import type { Reminder } from './types'

/**
 * 提醒排程器（桌面端）。
 *
 * 「下一次是幾毫秒後」的計算已搬到 `core/reminder/nextFire.ts`——手機端的
 * AlarmManager 需要同一套算式，算錯不會報錯、只會在錯的時間跳提醒。
 * 這裡留下的是平台專屬的部分：setTimeout 排程、存檔、powerMonitor 閒置判斷。
 */

type TriggerFn = (reminder: Reminder) => Promise<void>

let triggerFn: TriggerFn | null = null
let reminders: Reminder[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let initialized = false
let idleSkipMinutes = 0

export function setIdleSkipMinutes(minutes: number): void {
  idleSkipMinutes = Math.max(0, minutes)
}

export function initReminderScheduler(trigger: TriggerFn): void {
  triggerFn = trigger
  reminders = fileStore.loadReminders()
  initialized = true
  scheduleAll()
}

export function reloadReminders(): void {
  if (!initialized) return
  reminders = fileStore.loadReminders()
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  scheduleAll()
}

function scheduleAll(): void {
  for (const r of reminders) {
    if (r.enabled) scheduleOne(r)
  }
}

function scheduleOne(r: Reminder): void {
  clearTimerFor(r.id)
  const s = r.schedule

  if (s.type === 'startup') {
    const t = setTimeout(() => { timers.delete(r.id); void fire(r) }, 3000)
    timers.set(r.id, t)
    return
  }

  if (s.type === 'once') {
    const delay = s.at - Date.now()
    if (delay <= 0) return
    const t = setTimeout(() => {
      timers.delete(r.id)
      void fire(r)
      // Disable after firing
      const idx = reminders.findIndex(x => x.id === r.id)
      if (idx >= 0) { reminders[idx].enabled = false; fileStore.saveReminders(reminders) }
    }, delay)
    timers.set(r.id, t)
    return
  }

  if (s.type === 'daily') {
    const scheduleNextDaily = () => {
      const delay = nextDailyMs(s.hour, s.minute)
      const t = setTimeout(() => {
        timers.delete(r.id)
        void fire(r)
        if (r.enabled) scheduleNextDaily()
      }, delay)
      timers.set(r.id, t)
    }
    scheduleNextDaily()
    return
  }

  if (s.type === 'weekly') {
    const days = validWeeklyDays(s.days)
    if (days.length === 0) return
    const scheduleNextWeekly = () => {
      const delay = nextWeeklyMs(days, s.hour, s.minute)
      if (!Number.isFinite(delay) || delay <= 0) return
      const t = setTimeout(() => {
        timers.delete(r.id)
        void fire(r)
        if (r.enabled) scheduleNextWeekly()
      }, delay)
      timers.set(r.id, t)
    }
    scheduleNextWeekly()
    return
  }

  if (s.type === 'interval') {
    const intervalMs = Math.max(MIN_INTERVAL_MS, s.intervalMs)
    const firstDelay = nextIntervalMs(s.intervalMs, r.lastTriggeredAt)
    const scheduleNextInterval = (delay: number) => {
      const t = setTimeout(() => {
        timers.delete(r.id)
        void fire(r)
        if (r.enabled) scheduleNextInterval(intervalMs)
      }, delay)
      timers.set(r.id, t)
    }
    scheduleNextInterval(firstDelay)
  }
}

function clearTimerFor(id: string): void {
  const t = timers.get(id)
  if (t !== undefined) { clearTimeout(t); timers.delete(id) }
}

async function fire(r: Reminder): Promise<void> {
  if (!triggerFn) return
  if (idleSkipMinutes > 0) {
    const idleSecs = powerMonitor.getSystemIdleTime()
    if (idleSecs >= idleSkipMinutes * 60) {
      console.log(`[reminderScheduler] Skipped "${r.label}" — idle ${Math.round(idleSecs / 60)}min`)
      return
    }
  }
  r.lastTriggeredAt = Date.now()
  const idx = reminders.findIndex(x => x.id === r.id)
  if (idx >= 0) reminders[idx] = r
  fileStore.saveReminders(reminders)
  try {
    await triggerFn(r)
  } catch (e) {
    console.error('[reminderScheduler] fire failed:', e)
  }
}
