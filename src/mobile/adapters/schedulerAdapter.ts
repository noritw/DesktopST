import type { SchedulerAdapter } from '../../core/adapters'

/**
 * 排程 stub（階段 7／獨立聊天不依賴 B5 通知）。
 *
 * 行為對齊桌面的 `setTimeout` 切段邏輯，但沒有 `powerMonitor` resume。
 * 之後若要背景準點提醒，再換 AlarmManager／local-notifications。
 */
const MAX_DELAY = 2 ** 31 - 1
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function armTimer(id: string, atMs: number, fn: () => void): void {
  const delay = atMs - Date.now()
  if (delay <= 0) return
  if (delay > MAX_DELAY) {
    timers.set(id, setTimeout(() => armTimer(id, atMs, fn), MAX_DELAY))
    return
  }
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id)
      fn()
    }, delay)
  )
}

export const capacitorScheduler: SchedulerAdapter = {
  schedule(id: string, atMs: number, fn: () => void): void {
    capacitorScheduler.cancel(id)
    armTimer(id, atMs, fn)
  },

  cancel(id: string): void {
    const t = timers.get(id)
    if (t) {
      clearTimeout(t)
      timers.delete(id)
    }
  },

  cancelAll(): void {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
}
