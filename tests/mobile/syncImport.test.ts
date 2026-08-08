import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { PlatformAdapters } from '@core/adapters'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import {
  fetchSyncConversations,
  fetchSyncPreview,
  pullSettingsFromDesktop,
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

describe('S1 天氣設定', () => {
  const desktopWeather = {
    polish: true,
    realtimeQuery: { enabled: true, forecastCounty: '臺北市', cwaApiKey: 'CWA-FROM-PC' }
  }

  it('帶潤飾與 CWA 設定，但**不動手機的地點**', async () => {
    const session = await boot()
    session.settings.weather = {
      enabled: true,
      polish: false,
      locationName: '手機用 GPS 抓到的地方',
      latitude: 24.15,
      longitude: 120.67,
      locationSource: 'gps'
    }

    await runSyncImport(
      SRC, session, { onConflict: 'skip' },
      fakeFetch(bundle({ weather: desktopWeather }), (await makePacks(['星離宸'])).packs)
    )

    expect(session.settings.weather!.polish).toBe(true)
    expect(session.settings.weather!.realtimeQuery).toEqual(desktopWeather.realtimeQuery)
    // 手機會移動、而且有 GPS —— 帶電腦的座標過來只會讓它顯示家裡的天氣
    expect(session.settings.weather!.locationName).toBe('手機用 GPS 抓到的地方')
    expect(session.settings.weather!.latitude).toBe(24.15)
    expect(session.settings.weather!.locationSource).toBe('gps')
  })

  it('CWA 金鑰算一把，計進「帶回幾把金鑰」', async () => {
    const session = await boot()
    const r = await runSyncImport(
      SRC, session, { onConflict: 'skip' },
      fakeFetch(
        bundle({ weather: desktopWeather, llm: { apiKeys: { claude: '電腦來的' } } }),
        (await makePacks(['星離宸'])).packs
      )
    )
    expect(r.apiKeysImported).toBe(2)
  })

  it('中繼連線沒附 cwaApiKey 時，留住手機自己填的那把', async () => {
    const session = await boot()
    session.settings.weather = {
      enabled: true, polish: false, locationName: '臺北市',
      latitude: 25, longitude: 121, locationSource: 'manual',
      realtimeQuery: { enabled: true, cwaApiKey: '手機填的', forecastCounty: '' }
    }

    const r = await runSyncImport(
      SRC, session, { onConflict: 'skip' },
      fakeFetch(
        bundle({
          lanDirect: false,
          weather: { polish: true, realtimeQuery: { enabled: true, forecastCounty: '新北市' } }
        }),
        (await makePacks(['星離宸'])).packs
      )
    )

    expect(session.settings.weather!.realtimeQuery!.cwaApiKey).toBe('手機填的')
    expect(session.settings.weather!.realtimeQuery!.forecastCounty).toBe('新北市')
    expect(r.apiKeysImported).toBe(0)
  })

  it('電腦沒有天氣設定時完全不碰手機這邊', async () => {
    const session = await boot()
    session.settings.weather = {
      enabled: true, polish: true, locationName: '臺北市',
      latitude: 25, longitude: 121, locationSource: 'manual'
    }
    await runSyncImport(
      SRC, session, { onConflict: 'skip' },
      fakeFetch(bundle(), (await makePacks(['星離宸'])).packs)
    )
    expect(session.settings.weather!.polish).toBe(true)
  })
})

describe('從電腦重新拉設定（可重複執行）', () => {
  it('只套設定 —— 不新增角色、預設組與對話', async () => {
    const session = await boot()
    const charsBefore = session.characters.length
    const presetsBefore = session.personas.length
    const convsBefore = session.listConversations().length

    await pullSettingsFromDesktop(
      SRC,
      session,
      fakeFetch(bundle({ colorTheme: 'retro', memory: { keepRecentN: 7 } }), null)
    )

    expect(session.settings.ui.colorTheme).toBe('retro')
    expect(session.settings.memory.keepRecentN).toBe(7)
    // 這幾樣每次匯入都會新增一份，可重複執行的入口絕不能碰
    expect(session.characters).toHaveLength(charsBefore)
    expect(session.personas).toHaveLength(presetsBefore)
    expect(session.listConversations()).toHaveLength(convsBefore)
  })

  it('連按兩次不會累積出任何東西', async () => {
    const session = await boot()
    const f = fakeFetch(bundle(), null)
    await pullSettingsFromDesktop(SRC, session, f)
    const after = session.personas.length
    await pullSettingsFromDesktop(SRC, session, f)
    expect(session.personas).toHaveLength(after)
  })

  it('成功後記住同步主機，下次不必重掃', async () => {
    const session = await boot()
    expect(await session.getSyncHost()).toBeNull()
    await pullSettingsFromDesktop(SRC, session, fakeFetch(bundle(), null))
    expect((await session.getSyncHost())?.baseUrl).toBe(SRC.baseUrl)
  })

  it('權杖過期時拋 unauthorized，讓 UI 請使用者重掃', async () => {
    const session = await boot()
    await expect(
      pullSettingsFromDesktop(SRC, session, fakeFetch(bundle(), null, { status: 401 }))
    ).rejects.toMatchObject({ code: 'unauthorized' })
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

describe('S1 對話匯入', () => {
  /** 電腦端的兩則對話：一則有角色訊息（要重新對到手機的角色 id），一則只有純文字。 */
  const PC_CONVS = [
    {
      id: 'conv-a',
      title: '深夜聊天',
      participantIds: ['pc0'],
      messages: [
        { id: 'm1', role: 'user' as const, content: '在嗎', timestamp: 1 },
        { id: 'm2', role: 'character' as const, characterId: 'pc0', content: '在。', timestamp: 2 }
      ],
      summary: '',
      createdAt: 1,
      updatedAt: 200
    },
    {
      id: 'conv-b',
      title: '雜談',
      participantIds: [],
      messages: [{ id: 'm3', role: 'user' as const, content: '哈囉', timestamp: 3 }],
      summary: '',
      createdAt: 1,
      updatedAt: 100
    }
  ]

  function convFetch(
    packs: Map<string, Uint8Array>,
    characters: { id: string; name: string }[],
    opts: { missing?: string[]; noEndpoint?: boolean } = {}
  ) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sync-conversations')) {
        if (opts.noEndpoint) return new Response('nope', { status: 404 })
        return new Response(
          JSON.stringify({
            conversations: PC_CONVS.map((c) => ({
              id: c.id,
              title: c.title,
              updatedAt: c.updatedAt,
              messageCount: c.messages.length,
              characterNames: ['星離宸']
            }))
          }),
          { status: 200 }
        )
      }
      if (url.includes('/api/sync-conversation?')) {
        const id = new URL(url, 'http://x').searchParams.get('id') ?? ''
        if (opts.missing?.includes(id)) return new Response('gone', { status: 404 })
        const conv = PC_CONVS.find((c) => c.id === id)
        if (!conv) return new Response('gone', { status: 404 })
        return new Response(JSON.stringify({ conversation: conv }), { status: 200 })
      }
      return fakeFetch(bundle({ characters }), packs)(input)
    }) as typeof fetch
  }

  it('預設一則都不勾，沒勾就一則都不帶', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸'])
    const before = session.listConversations().length

    const result = await runSyncImport(
      SRC, session, { onConflict: 'skip' }, convFetch(packs, characters)
    )

    expect(result.conversationsImported).toBe(0)
    expect(session.listConversations()).toHaveLength(before)
  })

  /**
   * `.dstpack` 解包一律發新 id，電腦那邊的角色 id 在手機上根本不存在。
   * 沒重新對上的話，帶過來的對話會整串顯示成無名氏。
   */
  it('訊息裡的角色 id 會對到手機這邊的那隻', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸'])

    await runSyncImport(
      SRC, session, { onConflict: 'skip', conversationIds: ['conv-a'] }, convFetch(packs, characters)
    )

    const local = session.characters.find((c) => c.name === '星離宸')!
    expect(local.id).not.toBe('pc0')
    const imported = [...session.listConversations()].find((c) => c.title === '深夜聊天')!
    const conv = await loadedConversation(session, imported.id)
    expect(conv.messages[1]!.characterId).toBe(local.id)
    expect(conv.participantIds).toEqual([local.id])
  })

  it('帶過來的用新 id、記下來源，且不動手機原有的對話', async () => {
    const session = await boot()
    const original = session.activeConversation!.id
    const { packs, characters } = await makePacks(['星離宸'])

    const result = await runSyncImport(
      SRC,
      session,
      { onConflict: 'skip', conversationIds: ['conv-a', 'conv-b'] },
      convFetch(packs, characters)
    )

    expect(result.conversationsImported).toBe(2)
    const titles = session.listConversations().map((c) => c.title)
    expect(titles).toEqual(expect.arrayContaining(['深夜聊天', '雜談']))
    // 原有那則還在，而且仍是使用中的那則（匯入不該把使用者踢到別的對話）
    expect(session.activeConversation!.id).toBe(original)

    const imported = session.listConversations().find((c) => c.title === '雜談')!
    expect(imported.id).not.toBe('conv-b')
    const conv = await loadedConversation(session, imported.id)
    expect(conv.importedFrom).toMatchObject({ sourceId: 'conv-b', sourceUpdatedAt: 100 })
  })

  it('已經帶過來的不會再匯入一次', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸'])
    const fetchImpl = convFetch(packs, characters)

    await runSyncImport(SRC, session, { onConflict: 'skip', conversationIds: ['conv-a'] }, fetchImpl)
    const listed = await fetchSyncConversations(SRC, session, fetchImpl)
    expect(listed.find((c) => c.id === 'conv-a')!.alreadyImported).toBe(true)

    const again = await runSyncImport(
      SRC, session, { onConflict: 'skip', conversationIds: ['conv-a'] }, fetchImpl
    )
    expect(again.conversationsImported).toBe(0)
    expect(session.listConversations().filter((c) => c.title === '深夜聊天')).toHaveLength(1)
  })

  it('中間一則抓不到時，其餘照樣進來並回報失敗數', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸'])

    const result = await runSyncImport(
      SRC,
      session,
      { onConflict: 'skip', conversationIds: ['conv-a', 'conv-b'] },
      convFetch(packs, characters, { missing: ['conv-a'] })
    )

    expect(result.conversationsImported).toBe(1)
    expect(result.conversationsFailed).toBe(1)
  })

  /** 舊版電腦沒有這支端點。整個匯入不該因此失敗 —— 角色與設定照樣要能帶過來。 */
  it('電腦端沒有這支端點時，清單抓失敗但不影響其他匯入', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸'])
    const fetchImpl = convFetch(packs, characters, { noEndpoint: true })

    await expect(fetchSyncConversations(SRC, session, fetchImpl)).rejects.toBeInstanceOf(SyncError)
    const result = await runSyncImport(SRC, session, { onConflict: 'skip' }, fetchImpl)
    expect(result.charactersImported).toBe(1)
  })
})

/** 匯入的對話不會成為使用中那則，要自己 load 一次才拿得到完整內容。 */
async function loadedConversation(session: StandaloneSession, id: string) {
  await session.loadConversation(id)
  return session.activeConversation!
}

/**
 * 情境內部引用的重新對應。
 *
 * owner 2026-08-08 回報：APK 上切情境「星號一直亮，而且角色和對話也沒跟著套用」。
 * 原因是匯入時只換了情境自己的 id，裡面指的 persona／世界觀／在場角色／對話
 * 全都還是電腦端的 id —— 在這台手機上通通不存在。
 */
describe('S1 情境內部引用重新對應', () => {
  const PC_SCENE = {
    id: 'sc-pc',
    name: '深夜',
    activePersonaId: 'p1',
    activeWorldId: 'w1',
    desktopCharacters: [
      {
        characterId: 'pc0',
        position: { x: 10, y: 20 },
        size: 1,
        flipped: false,
        muted: false,
        zIndex: 1
      },
      {
        characterId: 'pc1',
        position: { x: 30, y: 40 },
        size: 1,
        flipped: false,
        muted: false,
        zIndex: 2
      }
    ],
    lastActiveConversationId: 'conv-a',
    createdAt: 1,
    updatedAt: 1
  }

  const PC_CONV = {
    id: 'conv-a',
    title: '深夜聊天',
    participantIds: ['pc0'],
    messages: [{ id: 'm1', role: 'user' as const, content: '在嗎', timestamp: 1 }],
    summary: '',
    createdAt: 1,
    updatedAt: 200
  }

  function sceneFetch(packs: Map<string, Uint8Array>, characters: { id: string; name: string }[]) {
    const init = bundle({
      characters,
      scenes: [PC_SCENE],
      worlds: [
        { id: 'w1', name: '電腦上的世界', worldSetting: '', interactionExample: '', createdAt: 1, updatedAt: 1 }
      ]
    })
    return (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/sync-conversations')) {
        return new Response(
          JSON.stringify({
            conversations: [
              { id: PC_CONV.id, title: PC_CONV.title, updatedAt: PC_CONV.updatedAt, messageCount: 1, characterNames: [] }
            ]
          }),
          { status: 200 }
        )
      }
      if (url.includes('/api/sync-conversation?')) {
        return new Response(JSON.stringify({ conversation: PC_CONV }), { status: 200 })
      }
      return fakeFetch(init, packs)(input)
    }) as typeof fetch
  }

  it('在場角色、persona、世界觀都換成手機這邊的 id', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸', '琉緋璃'])

    await runSyncImport(SRC, session, { onConflict: 'skip' }, sceneFetch(packs, characters))

    const scene = session.scenes.find((s) => s.name === '深夜')!
    const local = (name: string) => session.characters.find((c) => c.name === name)!.id

    expect(scene.desktopCharacters.map((d) => d.characterId)).toEqual([local('星離宸'), local('琉緋璃')])
    // 座標之類的其他欄位不能在轉換過程中掉了
    expect(scene.desktopCharacters[0]!.position.x).toBe(10)
    expect(scene.activePersonaId).toBe(session.personas.find((p) => p.name === '電腦上的我')!.id)
    expect(scene.activeWorldId).toBe(session.worlds.find((w) => w.name === '電腦上的世界')!.id)
  })

  it('對不到的角色直接刪掉，不留電腦端的 id', async () => {
    const session = await boot()
    // 只給一隻，情境裡的 pc1 在這台手機上永遠不會存在
    const { packs, characters } = await makePacks(['星離宸'])

    await runSyncImport(SRC, session, { onConflict: 'skip' }, sceneFetch(packs, characters))

    const scene = session.scenes.find((s) => s.name === '深夜')!
    expect(scene.desktopCharacters.map((d) => d.characterId)).toEqual([
      session.characters.find((c) => c.name === '星離宸')!.id
    ])
  })

  it('有勾選匯入的對話會對到新 id', async () => {
    const withConv = await boot()
    const a = await makePacks(['星離宸', '琉緋璃'])
    await runSyncImport(
      SRC, withConv, { onConflict: 'skip', conversationIds: ['conv-a'] }, sceneFetch(a.packs, a.characters)
    )
    const imported = withConv.listConversations().find((c) => c.title === '深夜聊天')!
    expect(imported.id).not.toBe('conv-a')
    expect(withConv.scenes.find((s) => s.name === '深夜')!.lastActiveConversationId).toBe(imported.id)
  })

  it('就算沒勾對話，情境綁定的那則仍會自動帶過來', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸', '琉緋璃'])
    await runSyncImport(SRC, session, { onConflict: 'skip' }, sceneFetch(packs, characters))

    const imported = session.listConversations().find((c) => c.title === '深夜聊天')
    expect(imported).toBeDefined()
    expect(session.scenes.find((s) => s.name === '深夜')!.lastActiveConversationId).toBe(imported!.id)
  })

  it('同名情境再拉一次會用電腦的在場角色覆寫', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸', '琉緋璃'])
    await runSyncImport(SRC, session, { onConflict: 'skip' }, sceneFetch(packs, characters))

    const scene = session.scenes.find((s) => s.name === '深夜')!
    // 模擬「手機上被改壞／套用失敗後存成空的」
    scene.desktopCharacters = []
    scene.lastActiveConversationId = undefined
    await session.saveScene(scene)

    await runSyncImport(SRC, session, { onConflict: 'skip' }, sceneFetch(packs, characters))
    const fixed = session.scenes.find((s) => s.name === '深夜')!
    expect(fixed.desktopCharacters.length).toBe(2)
    expect(fixed.lastActiveConversationId).toBeTruthy()
  })

  /** owner 回報的那兩個症狀，一次驗完。 */
  it('套用匯入的情境：真的換在場角色，而且星號不再亮著', async () => {
    const session = await boot()
    const { packs, characters } = await makePacks(['星離宸', '琉緋璃'])
    await runSyncImport(
      SRC, session, { onConflict: 'skip', conversationIds: ['conv-a'] }, sceneFetch(packs, characters)
    )

    const scene = session.scenes.find((s) => s.name === '深夜')!
    await session.applyScene(scene.id)

    const names = session
      .getState()
      .presentCharacters.map((c) => c.name)
      .sort()
    expect(names).toEqual(['星離宸', '琉緋璃'].sort())
    expect(session.getState().activeSceneDirty).toBe(false)
  })
})
