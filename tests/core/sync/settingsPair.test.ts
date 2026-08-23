import { describe, expect, it } from 'vitest'
import {
  applySettingsPreset,
  countSettingsPlan,
  defaultSettingsChoices,
  pairSettings
} from '../../../src/core/sync/settingsPair'
import type { SettingsSnapshot } from '../../../src/core/sync/settingsSnapshot'

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
    modules: [{ id: 'desktopst.weather', label: '天氣', enabled: true }],
    weather: { polish: false, realtimeQueryEnabled: false, realtimeQueryForecastCounty: '' },
    news: { speakButton: 'sometimes', conversationSearchEnabled: false, conversationSearchTriggerWords: '', conversationSearchMaxAgeHours: 48 },
    appearance: { showLlmBadge: true, showPersonaName: true },
    ...over
  }
}

describe('pairSettings', () => {
  it('完全相同的兩份快照，每個欄位都是 differs: false', () => {
    const rows = pairSettings(snapshot(), snapshot())
    expect(rows.every((r) => !r.differs)).toBe(true)
  })

  it('provider 不同時該列 differs', () => {
    const rows = pairSettings(snapshot(), snapshot({ llm: { ...snapshot().llm, provider: 'claude' } }))
    const row = rows.find((r) => r.key === 'llm.provider')!
    expect(row.differs).toBe(true)
    expect(row.localValue).toBe('openai')
    expect(row.remoteValue).toBe('claude')
  })

  it('每個 provider 的模型各自拆成一列，不是整包比對', () => {
    const rows = pairSettings(
      snapshot({ llm: { ...snapshot().llm, models: { openai: 'gpt-5' } } }),
      snapshot({ llm: { ...snapshot().llm, models: { openai: 'gpt-5', claude: 'opus-5' } } })
    )
    const openaiRow = rows.find((r) => r.key === 'llm.models.openai')!
    const claudeRow = rows.find((r) => r.key === 'llm.models.claude')!
    expect(openaiRow.differs).toBe(false)
    expect(claudeRow.differs).toBe(true)
    expect(claudeRow.remoteValue).toBe('opus-5')
  })

  /*
   * §2.1（2026-08-17）：輔助模型設定跟主模型的 provider／models 是同一個形狀，
   * 逐 provider 拆成一列，不是整包比對。
   */
  it('輔助模型三組欄位（啟用／供應商／各 provider 型號）都比對得到', () => {
    const rows = pairSettings(
      snapshot({
        llm: { ...snapshot().llm, utilityEnabled: false, utilityProvider: 'openai', utilityModels: { openai: 'gpt-5-mini' } }
      }),
      snapshot({
        llm: { ...snapshot().llm, utilityEnabled: true, utilityProvider: 'claude', utilityModels: { openai: 'gpt-5-mini', claude: 'haiku-5' } }
      })
    )
    expect(rows.find((r) => r.key === 'llm.utilityEnabled')).toMatchObject({ differs: true, localValue: false, remoteValue: true })
    expect(rows.find((r) => r.key === 'llm.utilityProvider')).toMatchObject({ differs: true, localValue: 'openai', remoteValue: 'claude' })
    expect(rows.find((r) => r.key === 'llm.utilityModels.openai')).toMatchObject({ differs: false })
    expect(rows.find((r) => r.key === 'llm.utilityModels.claude')).toMatchObject({ differs: true, remoteValue: 'haiku-5' })
  })

  it('每個 provider 的端點各自拆成一列（本機端點不會跟雲端端點混在同一列）', () => {
    const rows = pairSettings(
      snapshot({ llm: { ...snapshot().llm, endpoints: { local: 'http://192.168.1.9:11434/v1' } } }),
      snapshot({ llm: { ...snapshot().llm, endpoints: { local: 'http://100.70.201.116:11434/v1' } } })
    )
    const localRow = rows.find((r) => r.key === 'llm.endpoints.local')!
    const openaiRow = rows.find((r) => r.key === 'llm.endpoints.openai')!
    expect(localRow.differs).toBe(true)
    expect(localRow.remoteValue).toBe('http://100.70.201.116:11434/v1')
    // 沒設過的那家兩邊都是空字串 → 不該被報成差異
    expect(openaiRow.differs).toBe(false)
  })

  it('本機供應商有自己的比對列（SYNC_LLM_PROVIDERS 含 local）', () => {
    const rows = pairSettings(
      snapshot({ llm: { ...snapshot().llm, models: { local: 'qwen3:8b' } } }),
      snapshot({ llm: { ...snapshot().llm, models: {} } })
    )
    const row = rows.find((r) => r.key === 'llm.models.local')!
    expect(row.differs).toBe(true)
    expect(row.localValue).toBe('qwen3:8b')
  })

  it('模組：本機有、電腦沒有的模組（舊版電腦）仍然出現，且不算差異', () => {
    const local = snapshot({ modules: [{ id: 'desktopst.weather', label: '天氣', enabled: true }] })
    const remote = snapshot({ modules: [] })
    const rows = pairSettings(local, remote)
    const row = rows.find((r) => r.key === 'module.desktopst.weather')!
    expect(row.differs).toBe(false) // 電腦沒有 = 無從比較，不當成差異逼使用者處理
  })

  it('模組開關不同時 differs', () => {
    const local = snapshot({ modules: [{ id: 'desktopst.weather', label: '天氣', enabled: true }] })
    const remote = snapshot({ modules: [{ id: 'desktopst.weather', label: '天氣', enabled: false }] })
    const row = pairSettings(local, remote).find((r) => r.key === 'module.desktopst.weather')!
    expect(row.differs).toBe(true)
  })
})

describe('defaultSettingsChoices', () => {
  it('全部預設 keep——設定沒有單邊獨有的狀況，不能替使用者決定要哪一個', () => {
    const rows = pairSettings(snapshot({ colorTheme: 'sky' }), snapshot({ colorTheme: 'forest' }))
    const choices = defaultSettingsChoices(rows)
    expect(Object.values(choices).every((c) => c === 'keep')).toBe(true)
  })
})

describe('applySettingsPreset', () => {
  it('只影響有差異的欄位，相同的欄位維持 keep', () => {
    const rows = pairSettings(
      snapshot({ colorTheme: 'sky' }),
      snapshot({ colorTheme: 'forest' }) // 其餘欄位相同，只有 colorTheme 不同
    )
    const choices = applySettingsPreset(rows, 'local')
    expect(choices.colorTheme).toBe('local')
    expect(choices['llm.provider']).toBe('keep') // 沒有差異，不受快捷鍵影響
  })
})

describe('countSettingsPlan', () => {
  it('統計推幾項、拉幾項、不動幾項', () => {
    const rows = pairSettings(
      snapshot({ colorTheme: 'sky', llm: { ...snapshot().llm, provider: 'openai' } }),
      snapshot({ colorTheme: 'forest', llm: { ...snapshot().llm, provider: 'claude' } })
    )
    const choices = defaultSettingsChoices(rows)
    choices.colorTheme = 'local'
    choices['llm.provider'] = 'remote'
    const counts = countSettingsPlan(rows, choices)
    expect(counts.push).toBe(1)
    expect(counts.pull).toBe(1)
    expect(counts.untouched).toBe(rows.length - 2)
  })
})

describe('新聞：對話新聞搜尋（2026-08-23 補進比對子集）', () => {
  // 迴歸守門：這三欄 2026-08-22 就加進 `NewsEditableSettings` 且手機可編輯，
  // 卻漏了進比對子集——症狀是兩台裝置永遠各自為政、畫面上連一列都看不到。
  // 跟 `weather.polish` 是同一個錯誤類別（模組除了 enabled 還有自己的子設定）。
  it('三欄都會產生比對列', () => {
    const rows = pairSettings(snapshot(), snapshot())
    for (const key of [
      'news.conversationSearchEnabled',
      'news.conversationSearchTriggerWords',
      'news.conversationSearchMaxAgeHours'
    ]) {
      expect(rows.find((r) => r.key === key), `缺少比對列：${key}`).toBeTruthy()
    }
  })

  it('開關／觸發詞／時效不同時各自 differs，其餘列不受影響', () => {
    const local = snapshot()
    const remote = snapshot({
      news: {
        speakButton: 'sometimes',
        conversationSearchEnabled: true,
        conversationSearchTriggerWords: '地震\n颱風',
        conversationSearchMaxAgeHours: 12
      }
    })
    const rows = pairSettings(local, remote)
    expect(rows.find((r) => r.key === 'news.conversationSearchEnabled')!.differs).toBe(true)
    expect(rows.find((r) => r.key === 'news.conversationSearchTriggerWords')!.differs).toBe(true)
    expect(rows.find((r) => r.key === 'news.conversationSearchMaxAgeHours')!.differs).toBe(true)
    // 同一個模組的其他欄位不該被牽連
    expect(rows.find((r) => r.key === 'news.speakButton')!.differs).toBe(false)
  })
})
