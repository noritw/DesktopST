import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { readBaseline } from '../../src/mobile/runtime/syncBaseline'
import * as keys from '@core/store/keys'
import type { SyncBaseline } from '@core/sync/types'

describe('readBaseline', () => {
  it('key 不存在時回傳 null（例如第一次切換，還沒有基準）', async () => {
    const storage = createMemoryStorage()
    expect(await readBaseline(storage)).toBeNull()
  })

  it('能讀回已經寫入的基準（M2 本身不寫，但要能讀 M3 之後寫的東西）', async () => {
    const storage = createMemoryStorage()
    const baseline: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.5:5175',
      syncedAt: 1000,
      characters: { c1: { remoteId: 'rc1', localUpdatedAt: 1, remoteUpdatedAt: 1 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {},
      settingsHash: 'h0'
    }
    await storage.writeJson(keys.SYNC_BASELINE_KEY, baseline)

    expect(await readBaseline(storage)).toEqual(baseline)
  })
})
