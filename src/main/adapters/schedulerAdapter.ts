import { powerMonitor } from 'electron'
import type { SchedulerAdapter } from '../../core/adapters'

/**
 * Electron 端的排程 adapter。
 *
 * 只包裝 `setTimeout` 與 `powerMonitor` 的 resume 事件，
 * **不含任何提醒語意**（daily / interval / once 的換算留在呼叫端）。
 *
 * ⚠️ `setTimeout` 的延遲上限是 2^31-1 ms（約 24.8 天），超過會立刻觸發。
 * 因此超長延遲切成多段接力，到期前才排最後一段。
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

export const electronScheduler: SchedulerAdapter = {
  schedule(id: string, atMs: number, fn: () => void): void {
    electronScheduler.cancel(id)
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
  },

  onResume(fn: () => void): void {
    powerMonitor.on('resume', fn)
  }
}
