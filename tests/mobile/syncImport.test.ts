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

/** 造一個最小可用的 .dstpack（與桌面匯出同形）。 */
async function makePack(names: string[]): Promise<Uint8Array> {
  const zip = new JSZip()
  const ids = names.map((_, i) => `pc${i}`)
  zip.file('manifest.json', JSON.stringify({ format: 'desktopst-pack', characterIds: ids }))
  names.forEach((name, i) => {
    zip.file(
      `characters/${ids[i]}/card.json`,
      JSON.stringify({ id: ids[i], name, description: `${name} 的設定`, emotions: {} })
    )
    zip.file(`characters/${ids[i]}/avatar.png`, new Uint8Array([1, 2, 3]))
  })
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))
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
function fakeFetch(init: SyncInitBundle, pack: Uint8Array | null, opts: { status?: number } = {}) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (opts.status) return new Response('nope', { status: opts.status })
    if (url.endsWith('/api/sync-init')) {
      return new Response(JSON.stringify(init), { status: 200 })
    }
    if (url.endsWith('/api/sync-pack')) {
      if (!pack) return new Response('none', { status: 404 })
      // 複製一份 ArrayBuffer：Response 只吃 BodyInit，Uint8Array 的型別在 DOM lib 下不通過
      return new Response(pack.slice().buffer as ArrayBuffer, { status: 200 })
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

    const pack = await makePack(['星離宸', '琉緋璃'])
    const result = await runSyncImport(SRC, session, { onConflict: 'skip' }, fakeFetch(bundle(), pack))

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
    const pack = await makePack(['新角色'])
    const result = await runSyncImport(SRC, session, { onConflict: 'skip' }, fakeFetch(bundle(), pack))

    expect(result.charactersSkipped).toBe(1)
    expect(result.charactersImported).toBe(0)
    expect(session.characters.filter((c) => c.name === '新角色')).toHaveLength(1)
  })

  it('同名角色：overwrite 換成電腦那份，且在場清單跟著換過去', async () => {
    const session = await boot()
    const oldId = session.characters[0]!.id
    const pack = await makePack(['新角色'])
    await runSyncImport(SRC, session, { onConflict: 'overwrite' }, fakeFetch(bundle(), pack))

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
      fakeFetch(bundle({ llm: { apiKeys: { claude: '電腦來的' } } }), await makePack(['星離宸']))
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

    await runSyncImport(SRC, session, { onConflict: 'skip' }, fakeFetch(relayBundle, await makePack(['星離宸'])))
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
