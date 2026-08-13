import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import type { SyncDiff } from '@core/sync/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { pullRemoteToLocal, pushLocalToRemote } from '../../src/mobile/runtime/modeSwitchSync'

/**
 * 這份專門驗證 P1 修正本身：`docs/mobile-sync-m3-kickoff.md` §0.1 記錄的錯置是
 * 「遙控 → 獨立」被接去跑推送（手機 → 電腦），而不是拉取（電腦 → 手機）。
 * `syncPush.test.ts` 只測 `pushSync()` 內部邏輯，不管它是被哪個方向呼叫——
 * 這份直接測 `ModeSwitcher.tsx` 實際會呼叫的兩支路由函式，確認呼叫哪一支
 * 就只打哪個方向的端點，兩者不會混。
 */

const SRC = { baseUrl: 'http://192.168.1.20:3721', token: 'tok' }

function adapters(): PlatformAdapters {
  return {
    storage: createMemoryStorage(),
    secrets: unavailableSecrets,
    http: { fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch, supportsStreaming: false },
    scheduler: { schedule: () => {}, cancel: () => {}, cancelAll: () => {} },
    notifier: { notify: () => Promise.resolve() }
  }
}

async function boot(): Promise<StandaloneSession> {
  return bootStandaloneSession(adapters(), { skipPackFetch: true })
}

const EMPTY_COLLECTION_DIFF = {
  localNew: [],
  localModified: [],
  localDeleted: [],
  remoteNew: [],
  remoteModified: [],
  remoteDeleted: [],
  conflicts: []
}

function makeTrackingFetch(handlers: Record<string, () => Response>) {
  const calls: { method: string; path: string }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '').split('?')[0]!
    calls.push({ method: init?.method ?? 'GET', path })
    const handler = handlers[path]
    if (handler) return handler()
    return new Response('not implemented', { status: 404 })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('P1 修正：模式切換方向要對應正確的資料流', () => {
  it('獨立 → 遙控（pushLocalToRemote）只打推送端點，不打 /api/sync-init 拉取端點', async () => {
    const session = await boot()
    session.characters.push({
      id: 'c-push-1',
      name: '要推去電腦的角色',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 1
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { ...EMPTY_COLLECTION_DIFF, localNew: ['c-push-1'] },
      personas: EMPTY_COLLECTION_DIFF,
      worlds: EMPTY_COLLECTION_DIFF,
      scenes: EMPTY_COLLECTION_DIFF,
      lorebooks: EMPTY_COLLECTION_DIFF,
      conversations: EMPTY_COLLECTION_DIFF,
      settingsChanged: false
    }

    const { fetchImpl, calls } = makeTrackingFetch({
      '/api/sync-manifest': () =>
        new Response(
          JSON.stringify({ characters: [], personas: [], worlds: [], scenes: [], lorebooks: [], conversations: [], settingsHash: 'h' }),
          { status: 200 }
        ),
      '/api/characters/import-pack': () => new Response('OK', { status: 200 })
    })

    // 第 5 個參數是同名衝突回調（這個案例電腦上沒有同名角色，用不到）
    const summary = await pushLocalToRemote(SRC, session, diff, () => {}, undefined, fetchImpl)

    expect(summary.characters).toEqual(['要推去電腦的角色'])
    const paths = calls.map((c) => c.path)
    expect(paths).toContain('/api/characters/import-pack')
    // 方向接錯的症狀就是這裡會出現 /api/sync-init——那是拉取用的端點
    expect(paths).not.toContain('/api/sync-init')
  })

  it('遙控 → 獨立（pullRemoteToLocal）只打拉取端點，不打 /api/characters/import-pack 推送端點', async () => {
    const session = await boot()

    const { fetchImpl, calls } = makeTrackingFetch({
      '/api/sync-init': () =>
        new Response(JSON.stringify({ lanDirect: true, characters: [] } satisfies Record<string, unknown>), { status: 200 })
    })

    const result = await pullRemoteToLocal(SRC, session, fetchImpl)

    expect(result.charactersImported).toBe(0)
    const paths = calls.map((c) => c.path)
    expect(paths).toContain('/api/sync-init')
    // 方向接錯的症狀就是這裡會出現手機 → 電腦的推送呼叫
    expect(paths).not.toContain('/api/characters/import-pack')
    expect(paths).not.toContain('/api/presets/persona/save')
    expect(paths).not.toContain('/api/presets/world/save')
    expect(paths).not.toContain('/api/presets/scene/save')
    expect(paths).not.toContain('/api/lorebooks/save')
    // 拉取全程不該有任何一筆把資料 POST 出去
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })
})
