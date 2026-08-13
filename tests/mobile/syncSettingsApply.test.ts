import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import { pairSettings, type SettingsChoiceMap } from '@core/sync/settingsPair'
import type { SettingsSnapshot } from '@core/sync/settingsSnapshot'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { applySettingsSync } from '../../src/mobile/runtime/syncSettingsApply'

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

const bootSession = (): Promise<StandaloneSession> => bootStandaloneSession(adapters(), { skipPackFetch: true })

function snapshot(over: Partial<SettingsSnapshot> = {}): SettingsSnapshot {
  return {
    llm: {
      provider: 'openai',
      models: { openai: 'gpt-5' },
      endpoint: '',
      maxResponseTokens: 400,
      maxGroupRounds: 3,
      maxImagesPerMessage: 5
    },
    memory: { keepRecentN: 20, autoSummarizeAfter: 30, autoSummarizeEnabled: true },
    colorTheme: 'mint',
    modules: [],
    weather: { polish: false },
    ...over
  }
}

function makeFakeDesktop() {
  const calls: { method: string; path: string; body?: any }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '')
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

describe('applySettingsSync 方向', () => {
  it("choice 'local' 推送到電腦，不改手機自己的設定", async () => {
    const session = await bootSession()
    const local = snapshot({ colorTheme: 'sky' })
    const remote = snapshot({ colorTheme: 'forest' })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(SRC, session, rows, { colorTheme: 'local' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(res.failed).toEqual([])
    expect(res.pushed).toEqual(['配色主題'])
    const call = calls.find((c) => c.path === '/api/settings/color-theme')
    expect(call?.body).toEqual({ theme: 'sky' })
  })

  it("choice 'remote' 寫回手機的 session.settings", async () => {
    const session = await bootSession()
    const local = snapshot({ colorTheme: 'sky' })
    const remote = snapshot({ colorTheme: 'forest' })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(SRC, session, rows, { colorTheme: 'remote' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(res.pulled).toEqual(['配色主題'])
    expect(session.settings.ui.colorTheme).toBe('forest')
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })

  it("不在 choices 裡或選 'keep' 的欄位不動", async () => {
    const session = await bootSession()
    const before = session.settings.ui.colorTheme
    const local = snapshot({ colorTheme: 'sky' })
    const remote = snapshot({ colorTheme: 'forest' })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(SRC, session, rows, {}, undefined, fetchImpl)

    expect(res.pushed).toEqual([])
    expect(res.pulled).toEqual([])
    expect(calls).toEqual([])
    expect(session.settings.ui.colorTheme).toBe(before)
  })
})

describe('applySettingsSync 分組欄位（對話限制／記憶）', () => {
  it('三個欄位只有一個要推時，仍然送出三個數字——電腦端端點要求整組一起送', async () => {
    const session = await bootSession()
    const local = snapshot({ llm: { ...snapshot().llm, maxResponseTokens: 999, maxGroupRounds: 3, maxImagesPerMessage: 5 } })
    const remote = snapshot({ llm: { ...snapshot().llm, maxResponseTokens: 400, maxGroupRounds: 3, maxImagesPerMessage: 5 } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    await applySettingsSync(
      SRC,
      session,
      rows,
      { 'llm.maxResponseTokens': 'local' } as SettingsChoiceMap,
      undefined,
      fetchImpl
    )

    const call = calls.find((c) => c.path === '/api/settings/llm-chat-limits')
    // 沒被選中的兩個欄位維持電腦原本的值，不能被手機的值悄悄覆蓋
    expect(call?.body).toEqual({ maxResponseTokens: 999, maxGroupRounds: 3, maxImagesPerMessage: 5 })
  })

  it('同一組裡一個推一個拉，兩個方向互不干擾', async () => {
    const session = await bootSession()
    const local = snapshot({ memory: { keepRecentN: 50, autoSummarizeAfter: 30, autoSummarizeEnabled: true } })
    const remote = snapshot({ memory: { keepRecentN: 20, autoSummarizeAfter: 99, autoSummarizeEnabled: true } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(
      SRC,
      session,
      rows,
      { 'memory.keepRecentN': 'local', 'memory.autoSummarizeAfter': 'remote' } as SettingsChoiceMap,
      undefined,
      fetchImpl
    )

    const call = calls.find((c) => c.path === '/api/settings/memory')
    // autoSummarizeAfter 是「拉」的那個，電腦端維持自己原本的 99，不該被手機的 30 蓋掉
    expect(call?.body).toEqual({ keepRecentN: 50, autoSummarizeAfter: 99, autoSummarizeEnabled: true })
    expect(session.settings.memory.autoSummarizeAfter).toBe(99)
    expect(res.pushed).toContain('完整保留最近幾則')
    expect(res.pulled).toContain('自動摘要門檻')
  })

  it('組內完全沒有要動的欄位時不發任何請求', async () => {
    const session = await bootSession()
    const local = snapshot()
    const remote = snapshot()
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, {}, undefined, fetchImpl)
    expect(calls.filter((c) => c.path === '/api/settings/llm-chat-limits')).toEqual([])
    expect(calls.filter((c) => c.path === '/api/settings/memory')).toEqual([])
  })
})

describe('applySettingsSync 模組', () => {
  it('模組開關各自獨立呼叫，一個失敗不影響其他模組', async () => {
    const session = await bootSession()
    const local = snapshot({
      modules: [
        { id: 'desktopst.weather', label: '天氣', enabled: true },
        { id: 'desktopst.spotify', label: 'Spotify', enabled: true }
      ]
    })
    const remote = snapshot({
      modules: [
        { id: 'desktopst.weather', label: '天氣', enabled: false },
        { id: 'desktopst.spotify', label: 'Spotify', enabled: false }
      ]
    })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(
      SRC,
      session,
      rows,
      { 'module.desktopst.weather': 'local', 'module.desktopst.spotify': 'local' } as SettingsChoiceMap,
      undefined,
      fetchImpl
    )

    expect(res.failed).toEqual([])
    const toggleCalls = calls.filter((c) => c.path === '/api/settings/modules/toggle')
    expect(toggleCalls).toHaveLength(2)
    expect(toggleCalls.map((c) => c.body)).toEqual(
      expect.arrayContaining([
        { id: 'desktopst.weather', enabled: true },
        { id: 'desktopst.spotify', enabled: true }
      ])
    )
  })

  it("choice 'remote' 走 session.setModuleEnabled，套用模組各自的特殊欄位", async () => {
    const session = await bootSession()
    const local = snapshot({ modules: [{ id: 'desktopst.weather', label: '天氣', enabled: false }] })
    const remote = snapshot({ modules: [{ id: 'desktopst.weather', label: '天氣', enabled: true }] })
    const rows = pairSettings(local, remote)
    const { fetchImpl } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'module.desktopst.weather': 'remote' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(session.settings.weather?.enabled).toBe(true)
  })
})

describe('applySettingsSync 天氣潤飾', () => {
  it("choice 'local' 推送 polish，不動地點座標等其他天氣欄位", async () => {
    const session = await bootSession()
    const local = snapshot({ weather: { polish: true } })
    const remote = snapshot({ weather: { polish: false } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(SRC, session, rows, { 'weather.polish': 'local' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(res.pushed).toEqual(['天氣：使用輔助模型潤飾'])
    const call = calls.find((c) => c.path === '/api/settings/weather')
    expect(call?.body).toEqual({ polish: true })
  })

  it("choice 'remote' 寫回手機，且不清空既有的地點資料", async () => {
    const session = await bootSession()
    session.settings.weather = {
      enabled: true,
      polish: false,
      locationName: '台北市',
      latitude: 25.03,
      longitude: 121.56,
      locationSource: 'gps'
    }
    const local = snapshot({ weather: { polish: false } })
    const remote = snapshot({ weather: { polish: true } })
    const rows = pairSettings(local, remote)
    const { fetchImpl } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'weather.polish': 'remote' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(session.settings.weather.polish).toBe(true)
    expect(session.settings.weather.locationName).toBe('台北市') // 沒被合併邏輯清空
  })
})

describe('applySettingsSync 供應商切換', () => {
  it('拉取新供應商時，沒有型號的話補目錄預設值，不留空模型', async () => {
    const session = await bootSession()
    session.settings.llm.provider = 'openai'
    session.settings.llm.models = { openai: 'gpt-5' }
    const local = snapshot({ llm: { ...snapshot().llm, provider: 'openai' } })
    const remote = snapshot({ llm: { ...snapshot().llm, provider: 'claude', models: {} } })
    const rows = pairSettings(local, remote)
    const { fetchImpl } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'llm.provider': 'remote' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(session.settings.llm.provider).toBe('claude')
    expect(session.settings.llm.models?.claude).toBeTruthy()
  })
})
