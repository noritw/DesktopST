import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession } from '../../src/mobile/runtime/session'
import { buildLocalManifest, fetchRemoteManifest } from '../../src/mobile/runtime/syncManifest'

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

describe('buildLocalManifest', () => {
  it('把本地角色／預設組／對話組成跟 /api/sync-manifest 一樣的輕量形狀', async () => {
    const session = await bootStandaloneSession(adapters(), { skipPackFetch: true })
    session.characters.push({
      id: 'c1',
      name: '星離宸',
      description: '',
      emotions: {},
      createdAt: 1,
      updatedAt: 123
    } as any)

    const manifest = await buildLocalManifest(session)

    const found = manifest.characters.find((c) => c.id === 'c1')
    expect(found).toMatchObject({ id: 'c1', name: '星離宸', updatedAt: 123 })
    // S2 M4：每筆多帶內容雜湊，手機才判得出「兩邊都有的這一筆內容一不一樣」
    expect(found?.contentHash).toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.settingsHash).toMatch(/^[0-9a-f]{40}$/)
  })

  it('相同的設定內容兩次計算出相同的 settingsHash（穩定序列化）', async () => {
    const session = await bootStandaloneSession(adapters(), { skipPackFetch: true })
    const a = await buildLocalManifest(session)
    const b = await buildLocalManifest(session)
    expect(a.settingsHash).toBe(b.settingsHash)
  })

  it('LLM 設定變動會讓 settingsHash 跟著變', async () => {
    const session = await bootStandaloneSession(adapters(), { skipPackFetch: true })
    const before = await buildLocalManifest(session)
    // `llm.model` 是早期單一供應商時代的棄用欄位，S2 M5 起雜湊子集改看
    // `llm.models[provider]`（`core/sync/settingsSnapshot.ts`）——那才是真正
    // 會被同步／顯示在比對畫面上的值。
    session.settings.llm.models = { ...session.settings.llm.models, [session.settings.llm.provider]: 'a-completely-different-model' }
    const after = await buildLocalManifest(session)
    expect(after.settingsHash).not.toBe(before.settingsHash)
  })
})

describe('fetchRemoteManifest', () => {
  it('打 /api/sync-manifest 並回傳解析後的 JSON', async () => {
    let calledUrl = ''
    const fetchImpl = (async (url: string) => {
      calledUrl = String(url)
      return new Response(
        JSON.stringify({
          characters: [{ id: 'rc1', name: '琉緋璃', updatedAt: 99 }],
          personas: [],
          worlds: [],
          scenes: [],
          lorebooks: [],
          conversations: [],
          settingsHash: 'abc'
        }),
        { status: 200 }
      )
    }) as typeof fetch

    const manifest = await fetchRemoteManifest(SRC, fetchImpl)

    expect(calledUrl).toBe('http://192.168.1.20:3721/api/sync-manifest')
    expect(manifest.characters).toEqual([{ id: 'rc1', name: '琉緋璃', updatedAt: 99 }])
    expect(manifest.settingsHash).toBe('abc')
  })
})
