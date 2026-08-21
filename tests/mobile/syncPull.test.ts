import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { PlatformAdapters } from '@core/adapters'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { pullFromDesktop } from '../../src/mobile/runtime/syncPull'
import type { SyncInitBundle } from '../../src/mobile/runtime/syncImport'

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

async function makePack(id: string, name: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify({ format: 'desktopst-pack', characterIds: [id] }))
  zip.file(`characters/${id}/card.json`, JSON.stringify({ id, name, description: `${name} 的設定`, emotions: {} }))
  zip.file(`characters/${id}/avatar.png`, new Uint8Array([1, 2, 3]))
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
}

function bundle(over: Partial<SyncInitBundle> = {}): SyncInitBundle {
  return {
    lanDirect: true,
    colorTheme: 'forest',
    characters: [{ id: 'pc0', name: '電腦上的角色' }],
    ...over
  }
}

/** 造假伺服器：記錄每一筆呼叫的 method／path，方便驗證「這次到底打了哪些端點」。 */
function fakeFetch(init: SyncInitBundle, packs: Map<string, Uint8Array>) {
  const calls: { method: string; path: string }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, reqInit?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '').split('?')[0]!
    calls.push({ method: reqInit?.method ?? 'GET', path })

    if (path === '/api/sync-init') return new Response(JSON.stringify(init), { status: 200 })
    if (path === '/api/sync-pack') {
      const id = new URL(url, 'http://x').searchParams.get('id') ?? ''
      const one = packs.get(id)
      if (!one) return new Response('none', { status: 404 })
      return new Response(one.slice().buffer as ArrayBuffer, { status: 200 })
    }
    // 這支只該打拉取端點——碰到推送端點（import-pack／presets／lorebooks/save）
    // 就是方向接錯了，讓它 404 讓測試能抓到。
    return new Response('not implemented', { status: 404 })
  }) as typeof fetch

  return { fetchImpl, calls }
}

describe('S2 M3 P1：syncPull（遙控 → 獨立，電腦資料拉回手機）', () => {
  it('只打拉取端點（/api/sync-init、/api/sync-pack），不打推送端點', async () => {
    const session = await boot()
    const pack = await makePack('pc0', '電腦上的角色')
    const { fetchImpl, calls } = fakeFetch(bundle(), new Map([['pc0', pack]]))

    await pullFromDesktop(SRC, session, fetchImpl)

    const paths = calls.map((c) => c.path)
    expect(paths).toContain('/api/sync-init')
    expect(paths).toContain('/api/sync-pack')
    expect(paths).not.toContain('/api/characters/import-pack')
    expect(paths).not.toContain('/api/presets/persona/save')
    expect(paths).not.toContain('/api/presets/world/save')
    expect(paths).not.toContain('/api/presets/scene/save')
    expect(paths).not.toContain('/api/lorebooks/save')
    // 全部都是 GET——沒有任何一筆是把手機資料 POST 回去
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('真的把電腦的角色寫進手機本地資料', async () => {
    const session = await boot()
    const pack = await makePack('pc0', '從電腦拉回來的角色')
    const { fetchImpl } = fakeFetch(bundle({ characters: [{ id: 'pc0', name: '從電腦拉回來的角色' }] }), new Map([['pc0', pack]]))

    const result = await pullFromDesktop(SRC, session, fetchImpl)

    expect(result.charactersImported).toBe(1)
    expect(session.characters.some((c) => c.name === '從電腦拉回來的角色')).toBe(true)
  })

  it('S2 同步不帶 API Key，就算電腦端附了金鑰也會被拔掉', async () => {
    const session = await boot()
    const { fetchImpl } = fakeFetch(
      bundle({
        llm: { provider: 'claude', apiKeys: { claude: 'sk-should-not-leak' } },
        weather: { realtimeQuery: { enabled: true, forecastCounty: '臺北市', cwaApiKey: 'cwa-should-not-leak' } }
      }),
      new Map([['pc0', await makePack('pc0', '電腦上的角色')]])
    )

    const result = await pullFromDesktop(SRC, session, fetchImpl)

    // applySettings() 的回傳值就是「帶進來的金鑰數」——被拔掉的話這裡應該是 0
    expect(result.apiKeysImported).toBe(0)
    expect(session.settings.llm.apiKeys?.claude).toBeFalsy()
    expect(session.settings.weather?.realtimeQuery?.cwaApiKey).toBeFalsy()
  })

  it('同名角色用 onConflict=overwrite（電腦是剛才在用的那份，蓋掉手機舊資料才對）', async () => {
    const session = await boot()
    // 手機上先有一隻同名角色（例如上次推送過去、現在電腦端改了名稱以外的東西）
    const existingId = session.characters[0]!.id
    session.characters[0]!.name = '重名角色'

    const pack = await makePack('pc-desktop', '重名角色')
    const { fetchImpl } = fakeFetch(bundle({ characters: [{ id: 'pc-desktop', name: '重名角色' }] }), new Map([['pc-desktop', pack]]))

    await pullFromDesktop(SRC, session, fetchImpl)

    // 舊的手機版本應該被蓋掉（同 id 不在了），只剩一隻叫這個名字的角色
    expect(session.characters.filter((c) => c.name === '重名角色')).toHaveLength(1)
    expect(session.characters.some((c) => c.id === existingId)).toBe(false)
  })
})
