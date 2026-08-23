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
      endpoints: {},
      extraInstruction: '',
      maxResponseTokens: 400,
      maxGroupRounds: 3,
      maxImagesPerMessage: 5,
      utilityEnabled: false,
      utilityProvider: 'openai',
      utilityModels: {}
    },
    memory: { keepRecentN: 20, autoSummarizeAfter: 30, autoSummarizeEnabled: true },
    colorTheme: 'mint',
    modules: [],
    weather: { polish: false, realtimeQueryEnabled: false, realtimeQueryForecastCounty: '' },
    news: { speakButton: 'sometimes', conversationSearchEnabled: false, conversationSearchTriggerWords: '', conversationSearchMaxAgeHours: 48 },
    appearance: { showLlmBadge: true, showPersonaName: true },
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
        { id: 'desktopst.news', label: '個人新聞報', enabled: true }
      ]
    })
    const remote = snapshot({
      modules: [
        { id: 'desktopst.weather', label: '天氣', enabled: false },
        { id: 'desktopst.news', label: '個人新聞報', enabled: false }
      ]
    })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(
      SRC,
      session,
      rows,
      { 'module.desktopst.weather': 'local', 'module.desktopst.news': 'local' } as SettingsChoiceMap,
      undefined,
      fetchImpl
    )

    expect(res.failed).toEqual([])
    const toggleCalls = calls.filter((c) => c.path === '/api/settings/modules/toggle')
    expect(toggleCalls).toHaveLength(2)
    expect(toggleCalls.map((c) => c.body)).toEqual(
      expect.arrayContaining([
        { id: 'desktopst.weather', enabled: true },
        { id: 'desktopst.news', enabled: true }
      ])
    )
  })

  /*
   * owner 2026-08-17 決定：Spotify／日曆的授權只接桌面，手機同步 `enabled`
   * 開了也沒用，容易讓人誤以為手機上能用，所以這兩個模組不進比對範圍。
   */
  it('Spotify／日曆的 enabled 不進比對範圍，即使兩邊不同也不會產生列', async () => {
    const local = snapshot({
      modules: [
        { id: 'desktopst.spotify', label: 'Spotify', enabled: true },
        { id: 'desktopst.calendar', label: 'Google 日曆', enabled: true }
      ]
    })
    const remote = snapshot({
      modules: [
        { id: 'desktopst.spotify', label: 'Spotify', enabled: false },
        { id: 'desktopst.calendar', label: 'Google 日曆', enabled: false }
      ]
    })
    const rows = pairSettings(local, remote)
    expect(rows.find((r) => r.key === 'module.desktopst.spotify')).toBeUndefined()
    expect(rows.find((r) => r.key === 'module.desktopst.calendar')).toBeUndefined()
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
    const local = snapshot({ weather: { polish: true, realtimeQueryEnabled: false, realtimeQueryForecastCounty: '' } })
    const remote = snapshot({ weather: { polish: false, realtimeQueryEnabled: false, realtimeQueryForecastCounty: '' } })
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
    const local = snapshot({ weather: { polish: false, realtimeQueryEnabled: false, realtimeQueryForecastCounty: '' } })
    const remote = snapshot({ weather: { polish: true, realtimeQueryEnabled: false, realtimeQueryForecastCounty: '' } })
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

/*
 * §2.1（2026-08-17）：輔助模型設定原本沒進同步範圍，跟 `weather.polish` 那次
 * 是同一個形狀——手機 UI 已經做得出來、卻永遠不會同步、也沒有任何錯誤訊息。
 */
describe('applySettingsSync 輔助模型（§2.1）', () => {
  it("utilityEnabled 選 'local' 推送到電腦的 llm-utility-enabled 端點", async () => {
    const session = await bootSession()
    const local = snapshot({ llm: { ...snapshot().llm, utilityEnabled: true } })
    const remote = snapshot({ llm: { ...snapshot().llm, utilityEnabled: false } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    const res = await applySettingsSync(
      SRC, session, rows, { 'llm.utilityEnabled': 'local' } as SettingsChoiceMap, undefined, fetchImpl
    )

    expect(res.pushed).toEqual(['輔助模型：使用獨立模型'])
    const call = calls.find((c) => c.path === '/api/settings/llm-utility-enabled')
    expect(call?.body).toEqual({ enabled: true })
  })

  it("utilityProvider 選 'remote' 寫回手機，沒有型號時補目錄預設值", async () => {
    const session = await bootSession()
    session.settings.llm.utilityProvider = 'openai'
    session.settings.llm.utilityModels = {}
    const local = snapshot({ llm: { ...snapshot().llm, utilityProvider: 'openai' } })
    const remote = snapshot({ llm: { ...snapshot().llm, utilityProvider: 'claude' } })
    const rows = pairSettings(local, remote)
    const { fetchImpl } = makeFakeDesktop()

    await applySettingsSync(
      SRC, session, rows, { 'llm.utilityProvider': 'remote' } as SettingsChoiceMap, undefined, fetchImpl
    )

    expect(session.settings.llm.utilityProvider).toBe('claude')
    expect(session.settings.llm.utilityModels?.claude).toBeTruthy()
  })

  it("utilityModels.<provider> 選 'local' 推送對應的型號", async () => {
    const session = await bootSession()
    const local = snapshot({ llm: { ...snapshot().llm, utilityModels: { openai: 'gpt-5-mini' } } })
    const remote = snapshot({ llm: { ...snapshot().llm, utilityModels: {} } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    await applySettingsSync(
      SRC, session, rows, { 'llm.utilityModels.openai': 'local' } as SettingsChoiceMap, undefined, fetchImpl
    )

    const call = calls.find((c) => c.path === '/api/settings/llm-utility-model')
    expect(call?.body).toEqual({ provider: 'openai', model: 'gpt-5-mini' })
  })
})

/*
 * §2.2（2026-08-17）：外觀的模型徽章／發話身分名稱跟 colorTheme 同一類——
 * 兩邊都有這個功能、語意完全一致，只是原本沒被列進比對子集。
 */
describe('applySettingsSync 外觀（§2.2）', () => {
  it("showLlmBadge 選 'local' 推送到電腦端點", async () => {
    const session = await bootSession()
    const local = snapshot({ appearance: { showLlmBadge: false, showPersonaName: true } })
    const remote = snapshot({ appearance: { showLlmBadge: true, showPersonaName: true } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'appearance.showLlmBadge': 'local' } as SettingsChoiceMap, undefined, fetchImpl)

    const call = calls.find((c) => c.path === '/api/settings/show-llm-badge')
    expect(call?.body).toEqual({ show: false })
  })

  it("showPersonaName 選 'remote' 寫回手機的 session.settings.ui", async () => {
    const session = await bootSession()
    const local = snapshot({ appearance: { showLlmBadge: true, showPersonaName: true } })
    const remote = snapshot({ appearance: { showLlmBadge: true, showPersonaName: false } })
    const rows = pairSettings(local, remote)
    const { fetchImpl } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'appearance.showPersonaName': 'remote' } as SettingsChoiceMap, undefined, fetchImpl)

    expect(session.settings.ui.showPersonaName).toBe(false)
  })
})

/*
 * §2.2：新聞的陪聊頻率（speakButton）是唯一手機端有讀寫路徑的新聞子設定——
 * sources／keywordGroups／blacklist 是清單／聯集型，owner 決定先擱著。
 */
describe('applySettingsSync 新聞陪聊頻率（§2.2）', () => {
  it("選 'local' 推送到電腦的 /api/news/settings，只帶 speakButton 這個欄位", async () => {
    const session = await bootSession()
    const local = snapshot({ news: { speakButton: 'always', conversationSearchEnabled: false, conversationSearchTriggerWords: '', conversationSearchMaxAgeHours: 48 } })
    const remote = snapshot({ news: { speakButton: 'off', conversationSearchEnabled: false, conversationSearchTriggerWords: '', conversationSearchMaxAgeHours: 48 } })
    const rows = pairSettings(local, remote)
    const { fetchImpl, calls } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'news.speakButton': 'local' } as SettingsChoiceMap, undefined, fetchImpl)

    const call = calls.find((c) => c.path === '/api/news/settings')
    expect(call?.body).toEqual({ speakButton: 'always' })
  })

  it("選 'remote' 寫回手機本地的新聞設定", async () => {
    const session = await bootSession()
    const local = snapshot({ news: { speakButton: 'off', conversationSearchEnabled: false, conversationSearchTriggerWords: '', conversationSearchMaxAgeHours: 48 } })
    const remote = snapshot({ news: { speakButton: 'always', conversationSearchEnabled: false, conversationSearchTriggerWords: '', conversationSearchMaxAgeHours: 48 } })
    const rows = pairSettings(local, remote)
    const { fetchImpl } = makeFakeDesktop()

    await applySettingsSync(SRC, session, rows, { 'news.speakButton': 'remote' } as SettingsChoiceMap, undefined, fetchImpl)

    const after = await session.getNewsEditableSettings()
    expect(after.speakButton).toBe('always')
  })
})
