import type { StorageAdapter } from '@core/adapters'
import { advanceJourney, normalizeJourney, stayAt, visitJourney, type Journey } from '@core/walk/journey'
import { walkJourneyKey } from './walkKeys'

/** 今日旅途的位置，獨立存檔，不跟步數、物品、過招互蓋。 */

let queue: Promise<unknown> = Promise.resolve()

function update(
  storage: StorageAdapter,
  fn: (j: Journey | null) => Journey | null
): Promise<{ before: Journey | null; after: Journey | null }> {
  const run = queue.then(async () => {
    const before = normalizeJourney(await storage.readJson<unknown>(walkJourneyKey))
    const after = fn(before)
    if (after !== before) await storage.writeJson(walkJourneyKey, after)
    return { before, after }
  })
  queue = run.catch(() => {})
  return run
}

/** 回傳出發相位與更新後的位置；換日或換地圖時從 0 出發。 */
export async function openJourney(
  storage: StorageAdapter,
  now: Parameters<typeof visitJourney>[1]
): Promise<{ from: number; journey: Journey }> {
  const { before, after } = await update(storage, (j) => visitJourney(j, now))
  const same = before && before.day === now.day && before.map === now.map
  return { from: same ? before.phase : 0, journey: after! }
}

export async function stayInJourney(storage: StorageAdapter, at: number, leadId: string): Promise<Journey | null> {
  return (await update(storage, (j) => j && stayAt(j, at, leadId))).after
}

/** 測試版用：只推進畫面位置，不動步數。 */
export async function simulateJourney(
  storage: StorageAdapter,
  steps: number
): Promise<{ from: number; journey: Journey } | null> {
  const { before, after } = await update(storage, (j) => j && advanceJourney(j, steps))
  return before && after ? { from: before.phase, journey: after } : null
}

export async function clearJourney(storage: StorageAdapter): Promise<void> {
  await update(storage, () => null)
}
