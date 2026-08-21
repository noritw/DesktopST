import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { SyncBaseline } from '@core/sync/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { readBaseline, writeBaseline } from '../../src/mobile/runtime/syncBaseline'

function adapters(): PlatformAdapters {
  return {
    storage: createMemoryStorage(),
    secrets: unavailableSecrets,
    http: { fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch, supportsStreaming: false },
    scheduler: { schedule: () => {}, cancel: () => {}, cancelAll: () => {} },
    notifier: { notify: () => Promise.resolve() }
  }
}

describe('readBaseline', () => {
  it('key 不存在時回傳 null', async () => {
    const storage = adapters().storage
    const result = await readBaseline(storage)
    expect(result).toBeNull()
  })

  it('讀出存過的基準', async () => {
    const storage = adapters().storage
    const baseline: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.20:3721',
      syncedAt: 1000,
      settingsHash: 'abc123',
      characters: { c1: { remoteId: 'c1', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

    await storage.writeJson(keys.SYNC_BASELINE_KEY, baseline)
    const read = await readBaseline(storage)

    expect(read).toEqual(baseline)
  })
})

describe('writeBaseline', () => {
  it('寫基準後可以讀回來', async () => {
    const storage = adapters().storage
    const baseline: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.20:3721',
      syncedAt: 2000,
      settingsHash: 'hash1',
      characters: { c1: { remoteId: 'c1', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: { p1: { remoteId: 'p1', localUpdatedAt: 150, remoteUpdatedAt: 250 } },
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

    await writeBaseline(storage, baseline)
    const read = await readBaseline(storage)

    expect(read).toEqual(baseline)
  })

  it('覆寫已存在的基準', async () => {
    const storage = adapters().storage
    const baseline1: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.20:3721',
      syncedAt: 2000,
      settingsHash: 'hash1',
      characters: { c1: { remoteId: 'c1', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

    await writeBaseline(storage, baseline1)
    const baseline2: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.20:3721',
      syncedAt: 3000,
      settingsHash: 'hash2',
      characters: { c1: { remoteId: 'c1', localUpdatedAt: 100, remoteUpdatedAt: 300 } },
      personas: { p1: { remoteId: 'p1', localUpdatedAt: 150, remoteUpdatedAt: 250 } },
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

    await writeBaseline(storage, baseline2)
    const read = await readBaseline(storage)

    expect(read).toEqual(baseline2)
  })

  it('hostBaseUrl 改變時基準生效', async () => {
    const storage = adapters().storage
    const baseline1: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.20:3721',
      syncedAt: 2000,
      settingsHash: 'hash1',
      characters: { c1: { remoteId: 'c1', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

    await writeBaseline(storage, baseline1)

    const baseline2: SyncBaseline = {
      hostBaseUrl: 'http://192.168.1.21:3721',
      syncedAt: 2000,
      settingsHash: 'hash1',
      characters: { c1: { remoteId: 'c1', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }

    await writeBaseline(storage, baseline2)
    const read = await readBaseline(storage)

    expect(read?.hostBaseUrl).toBe('http://192.168.1.21:3721')
  })
})
