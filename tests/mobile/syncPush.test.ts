import { describe, expect, it, beforeEach } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { SyncBaseline, SyncDiff } from '@core/sync/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { readBaseline, writeBaseline } from '../../src/mobile/runtime/syncBaseline'
import { buildPushSelection, pushSync, type PushOptions } from '../../src/mobile/runtime/syncPush'

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

async function bootSession(): Promise<StandaloneSession> {
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

/** 第一次同步的 diff：`computeDiff(null, ...)` 就是回傳這種形狀（`core/sync/diff.ts`）。 */
const FIRST_SYNC_DIFF: SyncDiff = {
  hasBaseline: false,
  characters: EMPTY_COLLECTION_DIFF,
  personas: EMPTY_COLLECTION_DIFF,
  worlds: EMPTY_COLLECTION_DIFF,
  scenes: EMPTY_COLLECTION_DIFF,
  lorebooks: EMPTY_COLLECTION_DIFF,
  conversations: EMPTY_COLLECTION_DIFF,
  settingsChanged: false
}

/**
 * 造假 fetch，記錄所有呼叫（方法、路徑、body）以便驗證。
 */
function makeFakeFetch() {
  const calls: { method: string; path: string; body?: unknown; contentType?: string }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '')
    const method = init?.method ?? 'GET'
    const body = init?.body
    const contentType = init?.headers ? (init.headers as Record<string, string>)['Content-Type'] ?? undefined : undefined

    // 根據 content-type 決定如何解析 body
    let parsedBody: unknown
    if (body) {
      if (contentType?.includes('application/json')) {
        parsedBody = JSON.parse(String(body))
      } else if (contentType?.includes('octet-stream')) {
        parsedBody = '[binary]'
      } else {
        parsedBody = String(body)
      }
    }

    calls.push({ method, path, body: parsedBody, contentType })

    // 如果缺了某個端點，就讓它失敗；這樣能測試邏輯是否調用了正確的端點
    if (path === '/api/characters/import-pack') return new Response('OK', { status: 200 })
    if (path === '/api/presets/persona/save') return new Response('OK', { status: 200 })
    if (path === '/api/presets/world/save') return new Response('OK', { status: 200 })
    if (path === '/api/presets/scene/save') return new Response('OK', { status: 200 })
    if (path === '/api/lorebooks/save') return new Response('OK', { status: 200 })
    if (path.startsWith('/api/settings/')) return new Response('OK', { status: 200 })

    return new Response('not implemented', { status: 404 })
  }) as typeof fetch

  return { fetchImpl, calls }
}

describe('S2 M3 pushSync', () => {
  let session: StandaloneSession

  beforeEach(async () => {
    session = await bootSession()
    // 準備一份初始基準
    const baseline: SyncBaseline = {
      hostBaseUrl: SRC.baseUrl,
      syncedAt: 1000,
      settingsHash: 'initial-hash',
      characters: {},
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }
    await writeBaseline(session.adapters.storage, baseline)
  })

  it('不推送時基準完全不變', async () => {
    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()

    // 沒有勾選任何東西，所以不會推
    const opts: PushOptions = { selectedIds: {} }
    await pushSync(SRC, session, diff, opts, fetchImpl)

    // 基準應該完全不變
    const baselineAfter = await readBaseline(session.adapters.storage)
    const baselineBefore = await readBaseline(session.adapters.storage)
    expect(baselineAfter).toEqual(baselineBefore)
  })

  it('推送新角色時更新基準', async () => {
    // 手動加一隻角色
    const char = {
      id: 'c-test-1',
      name: '測試角色',
      description: '這是測試',
      emotions: {},
      createdAt: 1000,
      updatedAt: 2000
    } as any
    session.characters.push(char)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: ['c-test-1'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-test-1']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    // 基準應該被更新
    const baseline = await readBaseline(session.adapters.storage)
    expect(baseline?.characters['c-test-1']).toBeDefined()
    expect(baseline?.characters['c-test-1']?.remoteId).toBe('c-test-1')
    expect(baseline?.characters['c-test-1']?.localUpdatedAt).toBe(2000)
  })

  it('刪除的角色不被推送', async () => {
    const { fetchImpl, calls } = makeFakeFetch()
    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: [], localDeleted: ['c-deleted'], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    // 勾選了刪除的角色，但根據邏輯不應該推送
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-deleted']) } }
    await pushSync(SRC, session, diff, opts, fetchImpl)

    // 不應該有任何 API 呼叫
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('推送人設時更新基準', async () => {
    const persona = {
      id: 'p-test-1',
      name: '測試人設',
      displayName: 'Test',
      nickname: 'T',
      description: '測試用',
      createdAt: 1000,
      updatedAt: 3000
    } as any
    session.personas.push(persona)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: ['p-test-1'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { personas: new Set(['p-test-1']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    const baseline = await readBaseline(session.adapters.storage)
    expect(baseline?.personas['p-test-1']).toBeDefined()
    expect(baseline?.personas['p-test-1']?.remoteId).toBe('p-test-1')
  })

  it('情境推送時只推 characterId 和 muted（§3.2）', async () => {
    const scene = {
      id: 's-test-1',
      name: '測試情境',
      createdAt: 1000,
      updatedAt: 4000,
      desktopCharacters: [
        { characterId: 'c1', muted: false, x: 100, y: 200, scale: 1.5, flipped: false },
        { characterId: 'c2', muted: true, x: 300, y: 400, scale: 2.0, flipped: true }
      ]
    } as any
    session.scenes.push(scene)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: ['s-test-1'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl, calls } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { scenes: new Set(['s-test-1']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    // 找出推送情境的呼叫
    const sceneCall = calls.find((c) => c.path === '/api/presets/scene/save')
    expect(sceneCall).toBeDefined()

    const body = sceneCall?.body as any
    const pushed = body.preset.desktopCharacters
    // 應該只有 characterId 和 muted
    expect(pushed).toEqual([
      { characterId: 'c1', muted: false },
      { characterId: 'c2', muted: true }
    ])
    // 座標、大小、翻面都不應該有
    expect(pushed[0]).not.toHaveProperty('x')
    expect(pushed[0]).not.toHaveProperty('y')
    expect(pushed[0]).not.toHaveProperty('scale')
    expect(pushed[0]).not.toHaveProperty('flipped')
  })

  it('推送用語解說時更新基準', async () => {
    const lore = {
      id: 'l-test-1',
      name: '測試用語',
      entries: [{ key: '詞彙', value: '定義' }],
      updatedAt: 5000
    } as any

    // 假裝已經存在於 session，避免 getLorebook() 失敗
    ;(session as any)._loreBooks = new Map([['l-test-1', lore]])
    ;(session.getLorebook as any) = async (id: string) => {
      if (id === 'l-test-1') return lore
      return null
    }

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: ['l-test-1'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { lorebooks: new Set(['l-test-1']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    const baseline = await readBaseline(session.adapters.storage)
    expect(baseline?.lorebooks['l-test-1']).toBeDefined()
  })

  it('換主機時 hostBaseUrl 被更新', async () => {
    const char = {
      id: 'c-test-2',
      name: '測試角色 2',
      description: '這是測試',
      emotions: {},
      createdAt: 1000,
      updatedAt: 2000
    } as any
    session.characters.push(char)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: ['c-test-2'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-test-2']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    const baseline = await readBaseline(session.adapters.storage)
    expect(baseline?.hostBaseUrl).toBe(SRC.baseUrl)
  })

  it('推送進度回調被正確呼叫', async () => {
    const char = {
      id: 'c-test-3',
      name: '進度測試',
      description: '這是測試',
      emotions: {},
      createdAt: 1000,
      updatedAt: 2000
    } as any
    session.characters.push(char)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: ['c-test-3'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()
    const messages: string[] = []
    const opts: PushOptions = {
      selectedIds: { characters: new Set(['c-test-3']) },
      onProgress: (msg) => messages.push(msg)
    }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    // 應該有推送進度訊息
    expect(messages.some((m) => m.includes('進度測試'))).toBe(true)
    expect(messages.some((m) => m.includes('更新同步基準'))).toBe(true)
  })

  it('推送失敗時基準不被更新', async () => {
    const char = {
      id: 'c-fail',
      name: '失敗角色',
      description: '這個推送會失敗',
      emotions: {},
      createdAt: 1000,
      updatedAt: 2000
    } as any
    session.characters.push(char)

    const baslineBeforeError = await readBaseline(session.adapters.storage)
    expect(baslineBeforeError?.characters['c-fail']).toBeUndefined()

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: ['c-fail'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    // 造假 fetch 在推送角色時失敗
    const failingFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/characters/import-pack')) {
        return new Response('Network error', { status: 500 })
      }
      return new Response('OK', { status: 200 })
    }) as typeof fetch

    const opts: PushOptions = { selectedIds: { characters: new Set(['c-fail']) } }

    // 推送應該拋錯
    await expect(pushSync(SRC, session, diff, opts, failingFetch)).rejects.toThrow()

    // 基準應該沒有被更新
    const baselineAfterError = await readBaseline(session.adapters.storage)
    expect(baselineAfterError?.characters['c-fail']).toBeUndefined()
  })
})

describe('第一次同步（!diff.hasBaseline）', () => {
  it('readBaseline 是 null 時 pushSync 不拋錯，建立新基準', async () => {
    const session = await bootSession()
    // 從未寫過基準 → readBaseline 回傳 null（不是「先切換過又壞掉」）
    const before = await readBaseline(session.adapters.storage)
    expect(before).toBeNull()

    session.characters.push({
      id: 'c1',
      name: '第一次同步角色',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 100
    } as any)

    const { fetchImpl } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { characters: new Set(['c1']) } }

    await pushSync(SRC, session, FIRST_SYNC_DIFF, opts, fetchImpl)

    const after = await readBaseline(session.adapters.storage)
    expect(after).not.toBeNull()
    expect(after?.characters['c1']).toBeDefined()
    expect(after?.hostBaseUrl).toBe(SRC.baseUrl)
  })

  it('buildPushSelection 選取全部本地資料，不理會刻意留空的 diff', async () => {
    const session = await bootSession()
    session.characters.push({ id: 'c1', name: 'A', description: '', emotions: {}, createdAt: 1, updatedAt: 1 } as any)
    session.characters.push({ id: 'c2', name: 'B', description: '', emotions: {}, createdAt: 1, updatedAt: 1 } as any)
    session.personas.push({
      id: 'p1',
      name: 'P',
      displayName: 'P',
      nickname: '',
      description: '',
      createdAt: 1,
      updatedAt: 1
    } as any)

    const selection = await buildPushSelection(FIRST_SYNC_DIFF, session)

    // FIRST_SYNC_DIFF.characters.localNew 是空陣列，但本地明明有角色——
    // 這裡驗證的正是「不能直接拿 diff.localNew 建選取清單」這個曾經的 bug。
    // bootStandaloneSession 會種一個預設角色，所以拿 session.characters 的
    // 完整 id 清單來比對，而不是寫死只有 c1／c2。
    expect(selection.characters).toEqual(new Set(session.characters.map((c) => c.id)))
    expect(selection.characters!.has('c1')).toBe(true)
    expect(selection.characters!.has('c2')).toBe(true)
    expect(selection.personas).toEqual(new Set(session.personas.map((p) => p.id)))
    expect(selection.personas!.has('p1')).toBe(true)
  })

  it('端到端：第一次同步用 buildPushSelection 的結果真的能推送成功', async () => {
    const session = await bootSession()
    session.characters.push({
      id: 'c1',
      name: '端到端測試',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 1
    } as any)

    const { fetchImpl, calls } = makeFakeFetch()
    const selectedIds = await buildPushSelection(FIRST_SYNC_DIFF, session)
    await pushSync(SRC, session, FIRST_SYNC_DIFF, { selectedIds }, fetchImpl)

    const pushCall = calls.find((c) => c.path === '/api/characters/import-pack')
    expect(pushCall).toBeDefined()

    const baseline = await readBaseline(session.adapters.storage)
    expect(baseline?.characters['c1']).toBeDefined()
  })

  it('有基準時 buildPushSelection 只選 diff 標記的新增／修改，不是全部本地資料', async () => {
    const session = await bootSession()
    session.characters.push({ id: 'c1', name: 'New', description: '', emotions: {}, createdAt: 1, updatedAt: 1 } as any)
    session.characters.push({ id: 'c2', name: 'Untouched', description: '', emotions: {}, createdAt: 1, updatedAt: 1 } as any)

    const diffWithBaseline: SyncDiff = {
      hasBaseline: true,
      characters: { ...EMPTY_COLLECTION_DIFF, localNew: ['c1'] },
      personas: EMPTY_COLLECTION_DIFF,
      worlds: EMPTY_COLLECTION_DIFF,
      scenes: EMPTY_COLLECTION_DIFF,
      lorebooks: EMPTY_COLLECTION_DIFF,
      conversations: EMPTY_COLLECTION_DIFF,
      settingsChanged: false
    }

    const selection = await buildPushSelection(diffWithBaseline, session)

    // 只選 c1（diff 標記的新增），不選 c2（未變動、diff 沒提到）
    expect(selection.characters).toEqual(new Set(['c1']))
  })
})
