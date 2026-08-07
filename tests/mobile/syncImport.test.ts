import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { PlatformAdapters } from '@core/adapters'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import {
  fetchSyncPreview,
  runSyncImport,
  SyncError,
  type SyncInitBundle
} from '../../src/mobile/runtime/syncImport'

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

/**
 * 造出「一隻角色一包」的假產物：回傳 id → pack，以及對應的角色清單。
 * 電腦端就是這樣分開送的（整庫一包在真機上會爆，見 syncImport 的註解）。
 */
async function makePacks(names: string[]): Promise<{
  packs: Map<string, Uint8Array>
  characters: { id: string; name: string }[]
}> {
  const packs = new Map<string, Uint8Array>()
  const characters: { id: string; name: string }[] = []
  for (let i = 0; i < names.length; i++) {
    const id = `pc${i}`
    const name = names[i]!
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ format: 'desktopst-pack', characterIds: [id] }))
    zip.file(`characters/${id}/card.json`, JSON.stringify({ id, name, description: `${name} 的設定`, emotions: {} }))
    zip.file(`characters/${id}/avatar.png`, new Uint8Array([1, 2, 3]))
    packs.set(id, new Uint8Array(await zip.generateAsync({ type: 'uint8array' })))
    characters.push({ id, name })
  }
  return { packs, characters }
}

function bundle(over: Partial<SyncInitBundle> = {}): SyncInitBundle {
  return {
    lanDirect: true,
    colorTheme: 'forest',
    llm: { provider: 'claude', models: { claude: 'claude-haiku-4-5' } },
    memory: { keepRecentN: 42 },
    personas: [
      { id: 'p1', name: '電腦上的我', displayName: 'Nori', nickname: '主人', description: '', createdAt: 1, updatedAt: 1 }
    ],
    worlds: [],
    scenes: [],
    activePersonaId: 'p1',
    characters: [{ id: 'pc0', name: '星離宸' }],
    ...over
  }
}

/** 假伺服器：sync-init 給 JSON、sync-pack 給 zip。 */
function fakeFetch(init: SyncInitBundle, pack: Map<string, Uint8Array> | null, opts: { status?: number } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (opts.status) return new Response('nope', { status: opts.status })
    if (url.endsWith('/api/sync-init')) {
      return new Response(JSON.stringify(init), { status: 200 })
    }
    if (url.includes('/api/sync-pack')) {
      if (!pack) return new Response('none', { status: 404 })
      // 一隻角色一包：依 ?id= 回對應的那一份（與電腦端同形）
      const id = new URL(url, 'http://x').searchParams.get('id') ?? ''
      const one = pack.get(id)
      if (!one) return new Response('none', { status: 404 })
      // 複製一份 ArrayBuffer：Response 只吃 BodyInit，Uint8Array 的型別在 DOM lib 下不通過
      return new Response(one.slice().buffer as ArrayBuffer, { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch
}

async function boot(): Promise<StandaloneSession> {
  return bootStandaloneSession(adapters(), { skipPackFetch: true })
}

describe('S1 初始化匯入', () => {
  it('預覽不寫入任何東西，並回報同名角色', async () => {
    const session = await boot()
    const before = session.characters.map((c) => c.name)
    // 手機上那張空白卡叫「新角色」，讓電腦端也有一隻同名的來製造衝突
    const preview = await fetchSyncPreview(
      SRC,
      session,
      fakeFetch(bundle({ characters: [{ id: 'pc0', name: '新角色' }, { id: 'pc1', name: '琉緋璃' }] }), null)
    )

    expect(preview.characterCount).toBe(2)
    expect(preview.conflictNames).toEqual(['新角色'])
    expect(preview.apiKeysIncluded).toBe(false)
    // 預覽階段不得動到任何資料
    expect(session.characters.map((c) => c.name)).toEqual(before)
    expect(session.settings.ui.colorTheme).not.toBe('forest')
  })

  it('匯入設定、預設組與角色；不刪手機原有的東西', async () => {
    const session = await boot()
    const conv = session.activeConversation!
    await session.sendMessage({ content: '手機上原本的訊息', skipLlm: true })

    const { packs, characters } = await makePacks(['星離宸', '琉緋璃'])
    const result = await runSyncImport(
      SRC, session, { onConflict: 'skip' }, fakeFetch(bundle({ characters }), packs)
    )

    expect(result.charactersImported).toBe(2)
    expect(result.presetsImported).toBe(1)
    expect(session.settings.ui.colorTheme).toBe('forest')
    expect(session.settings.memory.keepRecentN).toBe(42)
    expect(session.settings.llm.provider).toBe('claude')
    expect(session.characters.map((c) => c.name)).toContain('星離宸')

    // 原有角色與對話都還在
    expect(session.characters.map((c) => c.name)).toContain('新角色')
    expect(session.activeConversation!.id).toBe(conv.id)
    expect(session.activeConversation!.messages.some((m) => m.content === '手機上原本的訊息')).toBe(true)

    // 匯入的 Persona 用新 id，且 active 指向新的那份
    const persona = session.personas.find((p) => p.name === '電腦上的我')
    expect(persona).toBeDefined()
    expect(persona!.id).not.toBe('p1')
    expect(session.settings.activePersonaId).toBe(persona!.id)
  })

  it('同名角色：skip 不留下解壓出來的殘骸', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['新角色'])
    const result = await runSyncImport(
      SRC, session, { onConflict: 'skip' }, fakeFetch(bundle({ characters }), packs)
    )

    expect(result.charactersSkipped).toBe(1)
    expect(result.charactersImported).toBe(0)
    expect(session.characters.filter((c) => c.name === '新角色')).toHaveLength(1)
  })

  it('同名角色：overwrite 換成電腦那份，且在場清單跟著換過去', async () => {
    const session = await boot()
    const oldId = session.characters[0]!.id
    const { packs, characters } = await makePacks(['新角色'])
    await runSyncImport(
      SRC, session, { onConflict: 'overwrite' }, fakeFetch(bundle({ characters }), packs)
    )

    const survivors = session.characters.filter((c) => c.name === '新角色')
    expect(survivors).toHaveLength(1)
    expect(survivors[0]!.id).not.toBe(oldId)
    expect(session.settings.ui.desktopCharacters[0]!.characterId).toBe(survivors[0]!.id)
  })

  it('只覆蓋電腦上有值的金鑰，手機自己填的其他家保留', async () => {
    const session = await boot()
    session.settings.llm.apiKeys = { openai: '手機填的', claude: '', gemini: '', grok: '' }

    const result = await runSyncImport(
      SRC,
      session,
      { onConflict: 'skip' },
      fakeFetch(bundle({ llm: { apiKeys: { claude: '電腦來的' } } }), (await makePacks(['星離宸'])).packs)
    )

    expect(result.apiKeysImported).toBe(1)
    expect(session.settings.llm.apiKeys.claude).toBe('電腦來的')
    expect(session.settings.llm.apiKeys.openai).toBe('手機填的')
  })

  it('中繼連線沒有 apiKeys 欄位時，不動手機既有金鑰', async () => {
    const session = await boot()
    session.settings.llm.apiKeys = { openai: '手機填的', claude: '', gemini: '', grok: '' }

    const relayBundle = bundle({ lanDirect: false, llm: { provider: 'claude' } })
    const preview = await fetchSyncPreview(SRC, session, fakeFetch(relayBundle, null))
    expect(preview.apiKeysIncluded).toBe(false)

    await runSyncImport(SRC, session, { onConflict: 'skip' }, fakeFetch(relayBundle, (await makePacks(['星離宸'])).packs))
    expect(session.settings.llm.apiKeys.openai).toBe('手機填的')
  })

  it('權杖錯誤回 unauthorized，連不上回 unreachable', async () => {
    const session = await boot()
    await expect(
      fetchSyncPreview(SRC, session, fakeFetch(bundle(), null, { status: 401 }))
    ).rejects.toMatchObject({ code: 'unauthorized' })

    const dead = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch
    await expect(fetchSyncPreview(SRC, session, dead)).rejects.toBeInstanceOf(SyncError)
  })
})

describe('S1 relay → 區網自動升級', () => {
  /** relay 那條回 lanDirect:false ＋ lanUrl；區網那條回 lanDirect:true ＋ 金鑰。 */
  function twoHostFetch(opts: { lanReachable: boolean; lanUrl?: string }) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input)
      const isLan = url.startsWith('http://192.168.1.20:3721')
      if (isLan && !opts.lanReachable) throw new Error('ETIMEDOUT')
      if (url.endsWith('/api/sync-init')) {
        const body = isLan
          ? bundle({ lanDirect: true, llm: { apiKeys: { claude: '只有直連才給' } } })
          : bundle({ lanDirect: false, lanUrl: opts.lanUrl ?? 'http://192.168.1.20:3721', llm: {} })
        return new Response(JSON.stringify(body), { status: 200 })
      }
      return new Response('x', { status: 404 })
    }) as typeof fetch
  }

  it('relay 掃進來時自動改走區網，金鑰就拿得到了', async () => {
    const session = await boot()
    const preview = await fetchSyncPreview(
      { baseUrl: 'https://relay.nori.tw/abc', token: 'tok' },
      session,
      twoHostFetch({ lanReachable: true })
    )

    expect(preview.upgradedToLan).toBe(true)
    expect(preview.src.baseUrl).toBe('http://192.168.1.20:3721')
    expect(preview.apiKeysIncluded).toBe(true)
  })

  it('人在外面（區網連不上）就安靜沿用 relay，不報錯', async () => {
    const session = await boot()
    const preview = await fetchSyncPreview(
      { baseUrl: 'https://relay.nori.tw/abc', token: 'tok' },
      session,
      twoHostFetch({ lanReachable: false })
    )

    expect(preview.upgradedToLan).toBe(false)
    expect(preview.src.baseUrl).toBe('https://relay.nori.tw/abc')
    expect(preview.apiKeysIncluded).toBe(false)
  })

  it('lanUrl 是公網位址時不跟過去', async () => {
    const session = await boot()
    const preview = await fetchSyncPreview(
      { baseUrl: 'https://relay.nori.tw/abc', token: 'tok' },
      session,
      twoHostFetch({ lanReachable: true, lanUrl: 'http://203.0.113.9:3721' })
    )

    expect(preview.upgradedToLan).toBe(false)
    expect(preview.apiKeysIncluded).toBe(false)
  })
})

describe('S1 一隻一包的韌性', () => {
  it('中間一隻抓不到時，其餘照樣匯入並回報失敗數', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['甲', '乙', '丙'])
    packs.delete('pc1') // 假設第二隻下載失敗

    const seen: number[] = []
    const result = await runSyncImport(
      SRC,
      session,
      { onConflict: 'skip', onProgress: (done) => seen.push(done) },
      fakeFetch(bundle({ characters }), packs)
    )

    expect(result.charactersImported).toBe(2)
    expect(result.charactersFailed).toBe(1)
    expect(session.characters.map((c) => c.name)).toEqual(expect.arrayContaining(['甲', '丙']))
    // 進度有回報到最後一格
    expect(seen[seen.length - 1]).toBe(3)
  })

  it('同名而且選 skip 時不會浪費流量去下載', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['新角色'])
    let packRequests = 0
    const counting = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sync-pack')) packRequests++
      return fakeFetch(bundle({ characters }), packs)(input)
    }) as typeof fetch

    const result = await runSyncImport(SRC, session, { onConflict: 'skip' }, counting)
    expect(result.charactersSkipped).toBe(1)
    expect(packRequests).toBe(0)
  })
})
