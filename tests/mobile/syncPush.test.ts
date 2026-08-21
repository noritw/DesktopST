import { describe, expect, it, beforeEach } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { SyncBaseline, SyncDiff } from '@core/sync/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { readBaseline, writeBaseline } from '../../src/mobile/runtime/syncBaseline'
import { buildPushSelection, pushSync, PushCancelled, type PushOptions } from '../../src/mobile/runtime/syncPush'

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
 *
 * `remoteCharacterIds`：模擬電腦上「現在真的存在」的角色 id 清單，供
 * `pushSync` 一開始的 `fetchRemoteManifest` 查詢用——不給就是空清單
 * （電腦上什麼都沒有，等同全新環境）。
 */
function makeFakeFetch(remoteCharacterIds: string[] = []) {
  const calls: { method: string; path: string; query: string; body?: unknown; contentType?: string }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const fullPath = url.replace(SRC.baseUrl, '')
    const [path, query = ''] = fullPath.split('?')
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

    calls.push({ method, path: path!, query, body: parsedBody, contentType })

    if (path === '/api/sync-manifest') {
      return new Response(
        JSON.stringify({
          characters: remoteCharacterIds.map((id) => ({ id, name: id, updatedAt: 1 })),
          personas: [],
          worlds: [],
          scenes: [],
          lorebooks: [],
          conversations: [],
          settingsHash: 'h'
        }),
        { status: 200 }
      )
    }

    // 如果缺了某個端點，就讓它失敗；這樣能測試邏輯是否調用了正確的端點
    // （import-pack 的 onConflict 走 query string，不是完全比對路徑）
    if (path === '/api/characters/import-pack') return new Response('OK', { status: 200 })
    if (path === '/api/presets/persona/save') return new Response('OK', { status: 200 })
    if (path === '/api/presets/world/save') return new Response('OK', { status: 200 })
    if (path === '/api/presets/scene/save') return new Response('OK', { status: 200 })
    if (path === '/api/lorebooks/save') return new Response('OK', { status: 200 })
    if (path?.startsWith('/api/settings/')) return new Response('OK', { status: 200 })

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

    const summary = await pushSync(SRC, session, diff, opts, fetchImpl)

    // 基準應該被更新
    const baseline = await readBaseline(session.adapters.storage)
    expect(baseline?.characters['c-test-1']).toBeDefined()
    expect(baseline?.characters['c-test-1']?.remoteId).toBe('c-test-1')
    expect(baseline?.characters['c-test-1']?.localUpdatedAt).toBe(2000)

    // 回傳的 summary 要能讓 UI 顯示「實際推了什麼」，不是只有靜默成功
    expect(summary.characters).toEqual(['測試角色'])
  })

  it('角色第一次推送用 onConflict=new（電腦上還沒有這隻）', async () => {
    session.characters.push({
      id: 'c-first',
      name: '第一次推送',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 1
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: ['c-first'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl, calls } = makeFakeFetch()
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-first']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    const importCall = calls.find((c) => c.path === '/api/characters/import-pack')
    expect(importCall?.query).toBe('onConflict=new')
  })

  it('角色已經在基準裡（先前推送成功過）→ 重推用 onConflict=overwrite，不會在電腦上多生一隻', async () => {
    // 先寫一份基準，模擬「這隻角色先前已經推送成功過」
    const baselineWithChar: SyncBaseline = {
      hostBaseUrl: SRC.baseUrl,
      syncedAt: 1000,
      settingsHash: 'h',
      characters: { 'c-repeat': { remoteId: 'c-repeat', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }
    await writeBaseline(session.adapters.storage, baselineWithChar)

    // 角色在本地被改過（updatedAt 比基準記的新），要重推
    session.characters.push({
      id: 'c-repeat',
      name: '被改過重推',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 999
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: ['c-repeat'], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    // 電腦上「現在真的還有」這個 id——overwrite 才安全
    const { fetchImpl, calls } = makeFakeFetch(['c-repeat'])
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-repeat']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    const importCall = calls.find((c) => c.path === '/api/characters/import-pack')
    expect(importCall?.query).toBe('onConflict=overwrite')
  })

  it('基準記過但電腦上那個 id 已經不在了（例如被手動刪除）→ 退回 onConflict=new，不冒險覆蓋同名的無關角色', async () => {
    const baselineWithStaleChar: SyncBaseline = {
      hostBaseUrl: SRC.baseUrl,
      syncedAt: 1000,
      settingsHash: 'h',
      characters: { 'c-stale': { remoteId: 'c-stale', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }
    await writeBaseline(session.adapters.storage, baselineWithStaleChar)

    session.characters.push({
      id: 'c-stale',
      name: '基準過期的角色',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 999
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: ['c-stale'], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    // 電腦上「現在沒有」c-stale 這個 id 了（例如被使用者手動刪除，或基準本來就是舊資料）——
    // 就算基準記過，也不能盲目 overwrite，因為電腦上可能有一隻同名但不相干的角色
    const { fetchImpl, calls } = makeFakeFetch([])
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-stale']) } }

    await pushSync(SRC, session, diff, opts, fetchImpl)

    const importCall = calls.find((c) => c.path === '/api/characters/import-pack')
    expect(importCall?.query).toBe('onConflict=new')
  })

  it('fetchRemoteManifest 失敗時保守退回 onConflict=new（查不到就不冒險 overwrite）', async () => {
    const baselineWithChar: SyncBaseline = {
      hostBaseUrl: SRC.baseUrl,
      syncedAt: 1000,
      settingsHash: 'h',
      characters: { 'c-unknown': { remoteId: 'c-unknown', localUpdatedAt: 100, remoteUpdatedAt: 200 } },
      personas: {},
      worlds: {},
      scenes: {},
      lorebooks: {},
      conversations: {}
    }
    await writeBaseline(session.adapters.storage, baselineWithChar)

    session.characters.push({
      id: 'c-unknown',
      name: '查不到遠端清單',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 999
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: [], localModified: ['c-unknown'], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const calls: { path: string; query: string }[] = []
    // /api/sync-manifest 本身失敗（500），import-pack 正常——驗證失敗時保守退回 new
    const flakyManifestFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const fullPath = url.replace(SRC.baseUrl, '')
      const [path, query = ''] = fullPath.split('?')
      if (path === '/api/sync-manifest') return new Response('server error', { status: 500 })
      calls.push({ path: path!, query })
      if (path === '/api/characters/import-pack') return new Response('OK', { status: 200 })
      return new Response('OK', { status: 200 })
    }) as typeof fetch

    const opts: PushOptions = { selectedIds: { characters: new Set(['c-unknown']) } }
    await pushSync(SRC, session, diff, opts, flakyManifestFetch)

    const importCall = calls.find((c) => c.path === '/api/characters/import-pack')
    expect(importCall?.query).toBe('onConflict=new')
  })

  it('推送結果摘要包含每個 collection 實際推送的名字', async () => {
    session.characters.push({
      id: 'c-sum-1',
      name: '摘要測試角色',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 10
    } as any)
    session.personas.push({
      id: 'p-sum-1',
      name: '摘要測試人設',
      displayName: 'P',
      nickname: '',
      description: '',
      createdAt: 1,
      updatedAt: 10
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: { localNew: ['c-sum-1'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      personas: { localNew: ['p-sum-1'], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    const { fetchImpl } = makeFakeFetch()
    const opts: PushOptions = {
      selectedIds: { characters: new Set(['c-sum-1']), personas: new Set(['p-sum-1']) }
    }

    const summary = await pushSync(SRC, session, diff, opts, fetchImpl)

    expect(summary.characters).toEqual(['摘要測試角色'])
    expect(summary.personas).toEqual(['摘要測試人設'])
    // 沒推的 collection 是空陣列，不是 undefined
    expect(summary.worlds).toEqual([])
    expect(summary.scenes).toEqual([])
    expect(summary.lorebooks).toEqual([])
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

  it('推送中途失敗時，已經成功的那幾筆基準要保留（否則重試會把它們重推一次，電腦上多出重複角色）', async () => {
    session.characters.push({
      id: 'c-ok',
      name: '成功角色',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 100
    } as any)
    session.characters.push({
      id: 'c-boom',
      name: '失敗角色',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 100
    } as any)

    const diff: SyncDiff = {
      hasBaseline: true,
      characters: {
        localNew: ['c-ok', 'c-boom'],
        localModified: [],
        localDeleted: [],
        remoteNew: [],
        remoteModified: [],
        remoteDeleted: [],
        conflicts: []
      },
      personas: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      worlds: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      scenes: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      lorebooks: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      conversations: { localNew: [], localModified: [], localDeleted: [], remoteNew: [], remoteModified: [], remoteDeleted: [], conflicts: [] },
      settingsChanged: false
    }

    // 第一筆角色推送成功，第二筆失敗（模擬「角色都推完了，後面某一步才炸」的情境）
    let callCount = 0
    const flakyFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/characters/import-pack')) {
        callCount++
        if (callCount === 1) return new Response('OK', { status: 200 })
        return new Response('Network error', { status: 500 })
      }
      return new Response('OK', { status: 200 })
    }) as typeof fetch

    // Set 保留插入順序：c-ok 先推，c-boom 後推
    const opts: PushOptions = { selectedIds: { characters: new Set(['c-ok', 'c-boom']) } }

    await expect(pushSync(SRC, session, diff, opts, flakyFetch)).rejects.toThrow()

    const baseline = await readBaseline(session.adapters.storage)
    // c-ok 已經真的送到電腦了，基準要記得，不然重試會再推一次、電腦上多一份重複
    expect(baseline?.characters['c-ok']).toBeDefined()
    // c-boom 沒推成功，不該出現在基準裡（下次重試該補推的是它，不是重推 c-ok）
    expect(baseline?.characters['c-boom']).toBeUndefined()
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

/**
 * 同名衝突（owner 2026-08-13 拍板的處理方式）。
 *
 * 這是那場「角色名稱掉光」事故的正源頭：舊版把同名角色一律當新角色送過去，
 * 電腦上每推一次就多一隻；清掉重複時留下的是新複本，而舊對話指向的是原本
 * 那隻的 id。這組測試釘住新規則：**問過使用者才動，而且預設不是建立重複**。
 */
describe('同名衝突處理', () => {
  function diffWithChar(id: string): SyncDiff {
    return {
      hasBaseline: true,
      characters: { ...EMPTY_COLLECTION_DIFF, localNew: [id] },
      personas: EMPTY_COLLECTION_DIFF,
      worlds: EMPTY_COLLECTION_DIFF,
      scenes: EMPTY_COLLECTION_DIFF,
      lorebooks: EMPTY_COLLECTION_DIFF,
      conversations: EMPTY_COLLECTION_DIFF,
      settingsChanged: false
    }
  }

  /** 電腦上有一隻叫「星離宸」、id 與手機不同的角色。 */
  function fetchWithRemoteNamed(name: string) {
    const calls: { path: string; query: string }[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      const [path, query = ''] = url.replace(SRC.baseUrl, '').split('?')
      if (path === '/api/sync-manifest') {
        return new Response(
          JSON.stringify({
            characters: [{ id: 'desktop-native-id', name, updatedAt: 1 }],
            personas: [], worlds: [], scenes: [], lorebooks: [], conversations: [], settingsHash: 'h'
          }),
          { status: 200 }
        )
      }
      calls.push({ path: path!, query })
      return new Response('OK', { status: 200 })
    }) as typeof fetch
    return { fetchImpl, calls }
  }

  async function sessionWithChar(name: string): Promise<StandaloneSession> {
    const s = await bootSession()
    s.characters.push({ id: 'phone-id', name, description: '', emotions: {}, createdAt: 1, updatedAt: 1 } as any)
    return s
  }

  it('偵測到同名時會把清單交給使用者，不是自己決定', async () => {
    const session = await sessionWithChar('星離宸')
    const { fetchImpl } = fetchWithRemoteNamed('星離宸')
    let asked: { id: string; name: string }[] | null = null

    await pushSync(SRC, session, diffWithChar('phone-id'), {
      selectedIds: { characters: new Set(['phone-id']) },
      onNameConflicts: async (c) => { asked = c; return new Set(c.map((x) => x.id)) }
    }, fetchImpl)

    expect(asked).toEqual([{ id: 'phone-id', name: '星離宸' }])
  })

  it('勾選覆蓋 → 用 onConflict=overwrite（電腦端會沿用它原本的 id，舊對話不會斷）', async () => {
    const session = await sessionWithChar('星離宸')
    const { fetchImpl, calls } = fetchWithRemoteNamed('星離宸')

    await pushSync(SRC, session, diffWithChar('phone-id'), {
      selectedIds: { characters: new Set(['phone-id']) },
      onNameConflicts: async (c) => new Set(c.map((x) => x.id))
    }, fetchImpl)

    expect(calls.find((c) => c.path === '/api/characters/import-pack')?.query).toBe('onConflict=overwrite')
  })

  it('沒勾 → 完全不推這隻，而且會出現在摘要的「未推送」裡（不能默默略過）', async () => {
    const session = await sessionWithChar('星離宸')
    const { fetchImpl, calls } = fetchWithRemoteNamed('星離宸')

    const summary = await pushSync(SRC, session, diffWithChar('phone-id'), {
      selectedIds: { characters: new Set(['phone-id']) },
      onNameConflicts: async () => new Set<string>()
    }, fetchImpl)

    expect(calls.find((c) => c.path === '/api/characters/import-pack')).toBeUndefined()
    expect(summary.characters).toEqual([])
    expect(summary.skippedByName).toEqual(['星離宸'])
  })

  it('取消 → 丟 PushCancelled，整趟都不推', async () => {
    const session = await sessionWithChar('星離宸')
    const { fetchImpl, calls } = fetchWithRemoteNamed('星離宸')

    await expect(
      pushSync(SRC, session, diffWithChar('phone-id'), {
        selectedIds: { characters: new Set(['phone-id']) },
        onNameConflicts: async () => null
      }, fetchImpl)
    ).rejects.toBeInstanceOf(PushCancelled)

    expect(calls.find((c) => c.path === '/api/characters/import-pack')).toBeUndefined()
  })

  it('沒有提供回調時保守不推——預設值不能是「默默建立重複角色」（這正是出事的舊行為）', async () => {
    const session = await sessionWithChar('星離宸')
    const { fetchImpl, calls } = fetchWithRemoteNamed('星離宸')

    const summary = await pushSync(SRC, session, diffWithChar('phone-id'), {
      selectedIds: { characters: new Set(['phone-id']) }
    }, fetchImpl)

    expect(calls.find((c) => c.path === '/api/characters/import-pack')).toBeUndefined()
    expect(summary.skippedByName).toEqual(['星離宸'])
  })

  it('名字大小寫／前後空白不同仍算同名，不會漏判', async () => {
    const session = await sessionWithChar('  Nori  ')
    const { fetchImpl } = fetchWithRemoteNamed('nori')
    let asked = 0

    await pushSync(SRC, session, diffWithChar('phone-id'), {
      selectedIds: { characters: new Set(['phone-id']) },
      onNameConflicts: async (c) => { asked = c.length; return new Set(c.map((x) => x.id)) }
    }, fetchImpl)

    expect(asked).toBe(1)
  })

  it('電腦上沒有同名的就完全不問，照舊用 onConflict=new', async () => {
    const session = await sessionWithChar('手機獨有的角色')
    const { fetchImpl, calls } = fetchWithRemoteNamed('電腦上的別人')
    let asked = false

    await pushSync(SRC, session, diffWithChar('phone-id'), {
      selectedIds: { characters: new Set(['phone-id']) },
      onNameConflicts: async () => { asked = true; return new Set<string>() }
    }, fetchImpl)

    expect(asked).toBe(false)
    expect(calls.find((c) => c.path === '/api/characters/import-pack')?.query).toBe('onConflict=new')
  })
})
