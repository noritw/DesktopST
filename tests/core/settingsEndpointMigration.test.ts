import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { AppSettings } from '@core/types'
import { hydrateSettings } from '@core/store/settings'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { createSecretAdapterFromKey, generateMasterKey } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession } from '../../src/mobile/runtime/session'

/**
 * 單一 `llm.endpoint` → per-provider `llm.endpoints` 的遷移。
 *
 * 為了讓本機供應商能跟雲端主模型並存，端點從一個字串改成一張表。
 * 這裡除了驗轉換規則，更重要的是驗**遷移有寫回磁碟**——
 * 只作用在記憶體的遷移每次開機都會重跑，磁碟永遠是舊格式，
 * 使用者清空的端點會被舊值一再復活（CLAUDE.md §5「資料遷移要寫回磁碟」）。
 */

function deps(): Parameters<typeof hydrateSettings>[2] {
  return {
    secrets: { encrypt: (v: string) => v, decrypt: (v: string) => v, isAvailable: () => true },
    // 這幾支只在舊欄位遷移時才會被呼叫，本測試的輸入都不觸發
    migrate: {} as Parameters<typeof hydrateSettings>[2]['migrate'],
    resolveRemoteControl: (rc) => ({
      enabled: false,
      allowedCapabilities: [],
      requireConfirmation: [],
      ...rc
    })
  } as Parameters<typeof hydrateSettings>[2]
}

describe('endpoint → endpoints 遷移規則', () => {
  it('舊的自訂端點歸給 openai', () => {
    const r = hydrateSettings({ llm: { endpoint: 'https://proxy.example/v1' } }, [], deps())
    expect(r.settings.llm.endpoints).toEqual({ openai: 'https://proxy.example/v1' })
    expect(r.needsResave).toBe(true)
  })

  it('api.x.ai 的端點歸給 grok，不是 openai', () => {
    // 舊 UI 只在 openai／grok 顯示端點欄位，靠網域分辨即可；
    // 不能寫進「當時的 provider」——使用者可能填完端點後又切去 Claude
    const r = hydrateSettings(
      { llm: { provider: 'claude', endpoint: 'https://api.x.ai/v1' } },
      [],
      deps()
    )
    expect(r.settings.llm.endpoints).toEqual({ grok: 'https://api.x.ai/v1' })
  })

  it('已經是新格式時不重跑遷移，也不要求重存', () => {
    const r = hydrateSettings(
      { llm: { endpoint: 'https://old.example/v1', endpoints: { local: 'http://localhost:11434/v1' } } },
      [],
      deps()
    )
    expect(r.settings.llm.endpoints).toEqual({ local: 'http://localhost:11434/v1' })
    expect(r.needsResave).toBe(false)
  })

  it('沒有舊端點時不會憑空生出東西', () => {
    const r = hydrateSettings({ llm: {} }, [], deps())
    expect(r.settings.llm.endpoints).toEqual({})
    expect(r.needsResave).toBe(false)
  })
})

describe('遷移要寫回磁碟（不能只活在記憶體）', () => {
  function adapters(storage: ReturnType<typeof createMemoryStorage>): PlatformAdapters {
    return {
      storage,
      secrets: createSecretAdapterFromKey(generateMasterKey()),
      http: { fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch, supportsStreaming: false },
      scheduler: { schedule: () => {}, cancel: () => {}, cancelAll: () => {} },
      notifier: { notify: () => Promise.resolve() }
    }
  }

  it('開機讀到舊格式後，磁碟上就是新格式了', async () => {
    const storage = createMemoryStorage()
    await storage.writeJson(keys.SETTINGS_KEY, {
      llm: { provider: 'openai', endpoint: 'https://proxy.example/v1' }
    })

    await bootStandaloneSession(adapters(storage), { skipPackFetch: true })

    const onDisk = (await storage.readJson<AppSettings>(keys.SETTINGS_KEY))!
    expect(onDisk.llm.endpoints).toEqual({ openai: 'https://proxy.example/v1' })
  })

  it('遷移後把端點清空，重開機不會被舊值復活', async () => {
    const storage = createMemoryStorage()
    await storage.writeJson(keys.SETTINGS_KEY, {
      llm: { provider: 'openai', endpoint: 'https://proxy.example/v1' }
    })

    const s1 = await bootStandaloneSession(adapters(storage), { skipPackFetch: true })
    s1.settings.llm.endpoints = {}
    s1.settings.llm.endpoint = undefined
    await s1.saveSettings()

    const s2 = await bootStandaloneSession(adapters(storage), { skipPackFetch: true })
    expect(s2.settings.llm.endpoints).toEqual({})
  })
})
