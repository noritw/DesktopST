import * as fileStore from './fileStore'
import type { Reminder } from './types'

type TriggerFn = (reminder: Reminder) => Promise<void>

let triggerFn: TriggerFn | null = null
let reminders: Reminder[] = []
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let initialized = false

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
    const days = Array.isArray(s.days) ? s.days.filter(d => d >= 0 && d <= 6) : []
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
    const intervalMs = Math.max(60_000, s.intervalMs)
    const elapsed = r.lastTriggeredAt ? Date.now() - r.lastTriggeredAt : intervalMs
    const firstDelay = Math.max(60_000, intervalMs - elapsed)
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

function nextDailyMs(hour: number, minute: number): number {
  const now = new Date()
  const target = new Date(now)
  target.setHours(hour, minute, 0, 0)
  if (target <= now) target.setDate(target.getDate() + 1)
  return target.getTime() - now.getTime()
}

function nextWeeklyMs(days: number[], hour: number, minute: number): number {
  const daySet = new Set(days)
  const now = new Date()
  for (let add = 0; add < 8; add++) {
    const target = new Date(now)
    target.setDate(now.getDate() + add)
    target.setHours(hour, minute, 0, 0)
    if (daySet.has(target.getDay()) && target > now) {
      return target.getTime() - now.getTime()
    }
  }
  return 7 * 24 * 60 * 60 * 1000
}
