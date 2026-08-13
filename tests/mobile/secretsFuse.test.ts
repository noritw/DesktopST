import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import { SECRET_PREFIX } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { AppSettings } from '@core/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { createSecretAdapterFromKey, generateMasterKey, unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession } from '../../src/mobile/runtime/session'

/**
 * 金鑰保險絲（2026-08-13 事故的回歸測試）。
 *
 * 事故經過：`ModeSwitcher` 在遙控模式下臨時 boot 一份 standalone session，
 * 但那時整個 app 從沒呼叫過 `initCapacitorSecrets()`（`App.tsx` 只在獨立模式
 * 分支呼叫）。secrets 退化成 `unavailableSecrets` → `decrypt()` 原樣回傳密文
 * → `hydrateSettings()` 判定「解不開」而把記憶體裡的金鑰設成 ''
 * → S2 M3 的「從電腦帶回資料」跑 `saveSettings()` → `encrypt('')` 回傳 ''
 * → **磁碟上的密文被空字串覆蓋，金鑰永久消失**（owner 回報「API Key 不見了」）。
 *
 * 呼叫端已補上初始化，但那是第二道防線；這裡測的是第一道：
 * **secrets 沒解封時，`saveSettings()` 不准把密文寫成空的。**
 */

function adaptersWith(secrets: PlatformAdapters['secrets'], storage = createMemoryStorage()): PlatformAdapters {
  return {
    storage,
    secrets,
    http: { fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch, supportsStreaming: false },
    scheduler: { schedule: () => {}, cancel: () => {}, cancelAll: () => {} },
    notifier: { notify: () => Promise.resolve() }
  }
}

describe('secrets 沒解封時的存檔保險絲', () => {
  it('secrets 不可用時存檔，磁碟上的加密金鑰不會被空字串蓋掉', async () => {
    const storage = createMemoryStorage()

    // ① 正常情境：secrets 可用，寫入一把真的金鑰
    const master = generateMasterKey()
    const realSecrets = createSecretAdapterFromKey(master)
    const s1 = await bootStandaloneSession(adaptersWith(realSecrets, storage), { skipPackFetch: true })
    s1.settings.llm.apiKeys = { ...s1.settings.llm.apiKeys, claude: 'sk-real-key' }
    await s1.saveSettings()

    const encrypted = (await storage.readJson<AppSettings>(keys.SETTINGS_KEY))!.llm.apiKeys.claude
    expect(encrypted?.startsWith(SECRET_PREFIX)).toBe(true)

    // ② 事故情境：忘了 initCapacitorSecrets()，用同一份磁碟資料再 boot 一次
    const s2 = await bootStandaloneSession(adaptersWith(unavailableSecrets, storage), { skipPackFetch: true })
    // 解不開 → 記憶體裡是空的（既有行為，不是 bug：避免使用者看到亂碼）
    expect(s2.settings.llm.apiKeys.claude).toBe('')

    // 這一步就是當初把金鑰弄丟的那一步
    await s2.saveSettings()

    // ③ 磁碟上的密文必須原封不動
    const after = (await storage.readJson<AppSettings>(keys.SETTINGS_KEY))!.llm.apiKeys.claude
    expect(after).toBe(encrypted)

    // ④ 真正的證明：重新用正確的 secrets 開一次，金鑰要能解回原文
    const s3 = await bootStandaloneSession(adaptersWith(createSecretAdapterFromKey(master), storage), { skipPackFetch: true })
    expect(s3.settings.llm.apiKeys.claude).toBe('sk-real-key')
  })

  it('secrets 正常時，使用者真的要清空金鑰仍然清得掉（保險絲不能擋住正常操作）', async () => {
    const storage = createMemoryStorage()
    const secrets = createSecretAdapterFromKey(generateMasterKey())

    const s1 = await bootStandaloneSession(adaptersWith(secrets, storage), { skipPackFetch: true })
    s1.settings.llm.apiKeys = { ...s1.settings.llm.apiKeys, claude: 'sk-real-key' }
    await s1.saveSettings()

    s1.settings.llm.apiKeys.claude = ''
    await s1.saveSettings()

    const after = (await storage.readJson<AppSettings>(keys.SETTINGS_KEY))!.llm.apiKeys.claude
    expect(after).toBe('')
  })
})
