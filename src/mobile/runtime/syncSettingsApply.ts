import { DEFAULT_MODEL_BY_PROVIDER } from '@core/llm/modelCatalog'
import { SYNC_LLM_PROVIDERS } from '@core/sync/settingsSnapshot'
import type { ColorTheme } from '@core/types'
import type { SpeakMode } from '@core/news/types'
import { splitTriggerWords } from '@core/sync/settingsSnapshot'
import type { SettingsChoiceMap, SettingsFieldRow } from '@core/sync/settingsPair'
import type { StandaloneSession } from './session'
import { postJson, type FetchImpl, type SyncSource } from './syncTransport'

/**
 * 執行設定比對畫面上的決定（S2 M5）。
 *
 * 跟 `syncApply.ts`（角色／使用者設定／世界觀／情境／用語解說）平行的另一支——
 * 不合併是因為欄位沒有 id、沒有「刪除」語意，執行方式也不同：那邊是一列一個
 * HTTP 呼叫／一個檔案；這裡有三組欄位（對話限制、記憶、模組）分別各自共用
 * **同一支**電腦端端點（`llm-chat-limits`／`memory`／逐一 `modules/toggle`），
 * 混在一起會讓 `syncApply.ts` 多出一堆這裡才用得到的特例。
 */

export interface SettingsApplyResult {
  /** 推到電腦的欄位標籤。 */
  pushed: string[]
  /** 拉回手機的欄位標籤。 */
  pulled: string[]
  failed: { label: string; error: string }[]
}

/**
 * `llm.maxResponseTokens`／`maxGroupRounds`／`maxImagesPerMessage` 三個欄位
 * 共用電腦端同一支 `POST /api/settings/llm-chat-limits`，一次送三個數字。
 *
 * 使用者可能只挑其中一兩個欄位選「用手機的」，另一兩個「不動」或「用電腦的」——
 * 這不衝突：三個欄位各自獨立決定「這個數字最後應該是多少」，只是**送到電腦**
 * 這個動作剛好要三個數字一起送。所以推送前要算出「三個欄位各自的目標值」
 * （選手機就用手機值，選電腦或不動就維持電腦原本的值），送出去的正是這三個
 * 目標值，不是「只有被選中的那個」。
 */
const CHAT_LIMIT_KEYS = ['llm.maxResponseTokens', 'llm.maxGroupRounds', 'llm.maxImagesPerMessage'] as const
const MEMORY_KEYS = ['memory.keepRecentN', 'memory.autoSummarizeAfter', 'memory.autoSummarizeEnabled'] as const

export async function applySettingsSync(
  src: SyncSource,
  session: StandaloneSession,
  rows: SettingsFieldRow[],
  choices: SettingsChoiceMap,
  onProgress?: (message: string) => void,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SettingsApplyResult> {
  const result: SettingsApplyResult = { pushed: [], pulled: [], failed: [] }
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const choiceOf = (key: string): 'local' | 'remote' | 'keep' => {
    const r = byKey.get(key)
    if (!r || !r.differs) return 'keep'
    return choices[key] ?? 'keep'
  }

  const track = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (err) {
      result.failed.push({ label, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // ── llm.provider（單一欄位、單一端點，不必分組）──
  const providerRow = byKey.get('llm.provider')
  if (providerRow && providerRow.differs) {
    const choice = choiceOf('llm.provider')
    if (choice === 'local') {
      await track(providerRow.label, async () => {
        onProgress?.(`推送「${providerRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-provider', { provider: providerRow.localValue }, fetchImpl)
        result.pushed.push(providerRow.label)
      })
    } else if (choice === 'remote') {
      await track(providerRow.label, async () => {
        onProgress?.(`帶回「${providerRow.label}」⋯⋯`)
        setLocalProvider(session, String(providerRow.remoteValue))
        await session.saveSettings()
        result.pulled.push(providerRow.label)
      })
    }
  }

  // ── llm.models.<provider>（每個 provider 各自的端點呼叫，互不影響）──
  for (const p of SYNC_LLM_PROVIDERS) {
    const key = `llm.models.${p}`
    const r = byKey.get(key)
    if (!r || !r.differs) continue
    const choice = choiceOf(key)
    if (choice === 'local') {
      await track(r.label, async () => {
        onProgress?.(`推送「${r.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-model', { provider: p, model: r.localValue }, fetchImpl)
        result.pushed.push(r.label)
      })
    } else if (choice === 'remote') {
      await track(r.label, async () => {
        onProgress?.(`帶回「${r.label}」⋯⋯`)
        const llm = session.settings.llm
        llm.models = { ...llm.models, [p]: String(r.remoteValue) }
        if (llm.provider === p) llm.model = String(r.remoteValue)
        await session.saveSettings()
        result.pulled.push(r.label)
      })
    }
  }

  // ── llm.endpoints.<provider>（比照 models 逐 provider 一列）──
  for (const p of SYNC_LLM_PROVIDERS) {
    const key = `llm.endpoints.${p}`
    const r = byKey.get(key)
    if (!r || !r.differs) continue
    const choice = choiceOf(key)
    if (choice === 'local') {
      await track(r.label, async () => {
        onProgress?.(`推送「${r.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-endpoint', { provider: p, endpoint: r.localValue }, fetchImpl)
        result.pushed.push(r.label)
      })
    } else if (choice === 'remote') {
      await track(r.label, async () => {
        onProgress?.(`帶回「${r.label}」⋯⋯`)
        const llm = session.settings.llm
        llm.endpoints = { ...llm.endpoints, [p]: String(r.remoteValue) }
        // 攤平欄位跟著更新，否則畫面上「目前端點」會停在舊值
        if (llm.provider === p) llm.endpoint = String(r.remoteValue)
        await session.saveSettings()
        result.pulled.push(r.label)
      })
    }
  }

  // ── llm.extraInstruction（單一欄位、單一端點，比照 llm.provider）──
  const extraInstructionRow = byKey.get('llm.extraInstruction')
  if (extraInstructionRow && extraInstructionRow.differs) {
    const choice = choiceOf('llm.extraInstruction')
    if (choice === 'local') {
      await track(extraInstructionRow.label, async () => {
        onProgress?.(`推送「${extraInstructionRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-extra-instruction', { text: extraInstructionRow.localValue }, fetchImpl)
        result.pushed.push(extraInstructionRow.label)
      })
    } else if (choice === 'remote') {
      await track(extraInstructionRow.label, async () => {
        onProgress?.(`帶回「${extraInstructionRow.label}」⋯⋯`)
        session.settings.llm.extraInstruction = String(extraInstructionRow.remoteValue)
        await session.saveSettings()
        result.pulled.push(extraInstructionRow.label)
      })
    }
  }

  // ── llm.utilityEnabled（單一欄位、單一端點，比照 llm.provider）──
  const utilityEnabledRow = byKey.get('llm.utilityEnabled')
  if (utilityEnabledRow && utilityEnabledRow.differs) {
    const choice = choiceOf('llm.utilityEnabled')
    if (choice === 'local') {
      await track(utilityEnabledRow.label, async () => {
        onProgress?.(`推送「${utilityEnabledRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-utility-enabled', { enabled: utilityEnabledRow.localValue }, fetchImpl)
        result.pushed.push(utilityEnabledRow.label)
      })
    } else if (choice === 'remote') {
      await track(utilityEnabledRow.label, async () => {
        onProgress?.(`帶回「${utilityEnabledRow.label}」⋯⋯`)
        session.settings.llm.utilityEnabled = !!utilityEnabledRow.remoteValue
        await session.saveSettings()
        result.pulled.push(utilityEnabledRow.label)
      })
    }
  }

  // ── llm.utilityProvider（單一欄位、單一端點）──
  const utilityProviderRow = byKey.get('llm.utilityProvider')
  if (utilityProviderRow && utilityProviderRow.differs) {
    const choice = choiceOf('llm.utilityProvider')
    if (choice === 'local') {
      await track(utilityProviderRow.label, async () => {
        onProgress?.(`推送「${utilityProviderRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-utility-provider', { provider: utilityProviderRow.localValue }, fetchImpl)
        result.pushed.push(utilityProviderRow.label)
      })
    } else if (choice === 'remote') {
      await track(utilityProviderRow.label, async () => {
        onProgress?.(`帶回「${utilityProviderRow.label}」⋯⋯`)
        setLocalUtilityProvider(session, String(utilityProviderRow.remoteValue))
        await session.saveSettings()
        result.pulled.push(utilityProviderRow.label)
      })
    }
  }

  // ── llm.utilityModels.<provider>（比照 llm.models 逐 provider 一列）──
  for (const p of SYNC_LLM_PROVIDERS) {
    const key = `llm.utilityModels.${p}`
    const r = byKey.get(key)
    if (!r || !r.differs) continue
    const choice = choiceOf(key)
    if (choice === 'local') {
      await track(r.label, async () => {
        onProgress?.(`推送「${r.label}」⋯⋯`)
        await postJson(src, '/api/settings/llm-utility-model', { provider: p, model: r.localValue }, fetchImpl)
        result.pushed.push(r.label)
      })
    } else if (choice === 'remote') {
      await track(r.label, async () => {
        onProgress?.(`帶回「${r.label}」⋯⋯`)
        const llm = session.settings.llm
        llm.utilityModels = { ...llm.utilityModels, [p]: String(r.remoteValue) }
        await session.saveSettings()
        result.pulled.push(r.label)
      })
    }
  }

  // ── 對話限制三欄一組 ──
  await applyGroupedNumeric(
    src,
    session,
    rows,
    choices,
    CHAT_LIMIT_KEYS,
    '/api/settings/llm-chat-limits',
    (final) => ({
      maxResponseTokens: final['llm.maxResponseTokens'],
      maxGroupRounds: final['llm.maxGroupRounds'],
      maxImagesPerMessage: final['llm.maxImagesPerMessage']
    }),
    (session, key, value) => {
      const field = key.split('.')[1] as 'maxResponseTokens' | 'maxGroupRounds' | 'maxImagesPerMessage'
      session.settings.llm[field] = Number(value)
    },
    result,
    onProgress,
    fetchImpl
  )

  // ── 記憶三欄一組 ──
  await applyGroupedNumeric(
    src,
    session,
    rows,
    choices,
    MEMORY_KEYS,
    '/api/settings/memory',
    (final) => ({
      keepRecentN: final['memory.keepRecentN'],
      autoSummarizeAfter: final['memory.autoSummarizeAfter'],
      autoSummarizeEnabled: final['memory.autoSummarizeEnabled']
    }),
    (session, key, value) => {
      const field = key.split('.')[1] as 'keepRecentN' | 'autoSummarizeAfter' | 'autoSummarizeEnabled'
      if (field === 'autoSummarizeEnabled') session.settings.memory[field] = !!value
      else session.settings.memory[field] = Number(value)
    },
    result,
    onProgress,
    fetchImpl
  )

  // ── 配色主題 ──
  const themeRow = byKey.get('colorTheme')
  if (themeRow && themeRow.differs) {
    const choice = choiceOf('colorTheme')
    if (choice === 'local') {
      await track(themeRow.label, async () => {
        onProgress?.(`推送「${themeRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/color-theme', { theme: themeRow.localValue }, fetchImpl)
        result.pushed.push(themeRow.label)
      })
    } else if (choice === 'remote') {
      await track(themeRow.label, async () => {
        onProgress?.(`帶回「${themeRow.label}」⋯⋯`)
        session.settings.ui.colorTheme = themeRow.remoteValue as ColorTheme
        await session.saveSettings()
        result.pulled.push(themeRow.label)
      })
    }
  }

  // ── 外觀：顯示模型徽章 ──
  const showLlmBadgeRow = byKey.get('appearance.showLlmBadge')
  if (showLlmBadgeRow && showLlmBadgeRow.differs) {
    const choice = choiceOf('appearance.showLlmBadge')
    if (choice === 'local') {
      await track(showLlmBadgeRow.label, async () => {
        onProgress?.(`推送「${showLlmBadgeRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/show-llm-badge', { show: showLlmBadgeRow.localValue }, fetchImpl)
        result.pushed.push(showLlmBadgeRow.label)
      })
    } else if (choice === 'remote') {
      await track(showLlmBadgeRow.label, async () => {
        onProgress?.(`帶回「${showLlmBadgeRow.label}」⋯⋯`)
        session.settings.ui.showLlmBadge = !!showLlmBadgeRow.remoteValue
        await session.saveSettings()
        result.pulled.push(showLlmBadgeRow.label)
      })
    }
  }

  // ── 外觀：顯示發話身分名稱 ──
  const showPersonaNameRow = byKey.get('appearance.showPersonaName')
  if (showPersonaNameRow && showPersonaNameRow.differs) {
    const choice = choiceOf('appearance.showPersonaName')
    if (choice === 'local') {
      await track(showPersonaNameRow.label, async () => {
        onProgress?.(`推送「${showPersonaNameRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/show-persona-name', { show: showPersonaNameRow.localValue }, fetchImpl)
        result.pushed.push(showPersonaNameRow.label)
      })
    } else if (choice === 'remote') {
      await track(showPersonaNameRow.label, async () => {
        onProgress?.(`帶回「${showPersonaNameRow.label}」⋯⋯`)
        session.settings.ui.showPersonaName = !!showPersonaNameRow.remoteValue
        await session.saveSettings()
        result.pulled.push(showPersonaNameRow.label)
      })
    }
  }

  // ── 新聞：陪聊頻率（speakButton）──
  const newsSpeakButtonRow = byKey.get('news.speakButton')
  if (newsSpeakButtonRow && newsSpeakButtonRow.differs) {
    const choice = choiceOf('news.speakButton')
    if (choice === 'local') {
      await track(newsSpeakButtonRow.label, async () => {
        onProgress?.(`推送「${newsSpeakButtonRow.label}」⋯⋯`)
        await postJson(src, '/api/news/settings', { speakButton: newsSpeakButtonRow.localValue }, fetchImpl)
        result.pushed.push(newsSpeakButtonRow.label)
      })
    } else if (choice === 'remote') {
      await track(newsSpeakButtonRow.label, async () => {
        onProgress?.(`帶回「${newsSpeakButtonRow.label}」⋯⋯`)
        // `saveNewsEditableSettings` 內部只疊上傳進去的 patch，不會動到
        // sources／keywordGroups／blacklist 那幾欄——跟 `POST /api/news/settings`
        // 電腦端那支同一個道理（見 mobileRoutes.ts 的說明）。
        await session.saveNewsEditableSettings({ speakButton: newsSpeakButtonRow.remoteValue as SpeakMode })
        result.pulled.push(newsSpeakButtonRow.label)
      })
    }
  }

  // ── 新聞：對話新聞搜尋（開關／觸發詞／時效）──
  //
  // 三欄各自一列（使用者可能只想同步其中一項），但送出去都是同一個巢狀物件
  // `conversationSearch`。兩端的存檔路徑都會**先讀現況再疊 patch**
  // （桌面 `modules/news/mobileRoutes.ts`、手機 `session.saveNewsEditableSettings`），
  // 所以逐欄分開送不會把沒選到的另外兩欄重置掉——這是 2026-08-22 那次修過的坑，
  // 不要為了「少送一次請求」把三欄合併成一包，那會讓「只選一欄」的語意消失。
  const convSearchRows: { key: string; toPatch: (v: string | number | boolean) => Record<string, unknown> }[] = [
    { key: 'news.conversationSearchEnabled', toPatch: (v) => ({ enabled: !!v }) },
    { key: 'news.conversationSearchTriggerWords', toPatch: (v) => ({ triggerWords: splitTriggerWords(String(v)) }) },
    { key: 'news.conversationSearchMaxAgeHours', toPatch: (v) => ({ maxAgeHours: Number(v) }) }
  ]
  for (const { key, toPatch } of convSearchRows) {
    const r = byKey.get(key)
    if (!r || !r.differs) continue
    const choice = choiceOf(key)
    if (choice === 'local') {
      await track(r.label, async () => {
        onProgress?.(`推送「${r.label}」⋯⋯`)
        await postJson(src, '/api/news/settings', { conversationSearch: toPatch(r.localValue) }, fetchImpl)
        result.pushed.push(r.label)
      })
    } else if (choice === 'remote') {
      await track(r.label, async () => {
        onProgress?.(`帶回「${r.label}」⋯⋯`)
        await session.saveNewsEditableSettings({
          conversationSearch: toPatch(r.remoteValue) as never
        })
        result.pulled.push(r.label)
      })
    }
  }

  // ── 天氣：使用輔助模型潤飾 ──
  const weatherPolishRow = byKey.get('weather.polish')
  if (weatherPolishRow && weatherPolishRow.differs) {
    const choice = choiceOf('weather.polish')
    if (choice === 'local') {
      await track(weatherPolishRow.label, async () => {
        onProgress?.(`推送「${weatherPolishRow.label}」⋯⋯`)
        await postJson(src, '/api/settings/weather', { polish: weatherPolishRow.localValue }, fetchImpl)
        result.pushed.push(weatherPolishRow.label)
      })
    } else if (choice === 'remote') {
      await track(weatherPolishRow.label, async () => {
        onProgress?.(`帶回「${weatherPolishRow.label}」⋯⋯`)
        // 比照 `localDataSource.ts` 的 `setWeather`：跟預設值合併，不要讓缺欄位的
        // 舊資料把其餘欄位（地點座標等）意外清空。
        session.settings.weather = {
          enabled: false,
          locationName: '',
          latitude: 0,
          longitude: 0,
          locationSource: '',
          ...session.settings.weather,
          polish: !!weatherPolishRow.remoteValue
        }
        await session.saveSettings()
        result.pulled.push(weatherPolishRow.label)
      })
    }
  }

  // ── 天氣：啟用即時氣象查詢／即時查詢預設縣市（不碰 CWA API Key）──
  const realtimeQueryKeys = ['weather.realtimeQueryEnabled', 'weather.realtimeQueryForecastCounty'] as const
  for (const key of realtimeQueryKeys) {
    const r = byKey.get(key)
    if (!r || !r.differs) continue
    const choice = choiceOf(key)
    const field = key === 'weather.realtimeQueryEnabled' ? 'enabled' : 'forecastCounty'
    if (choice === 'local') {
      await track(r.label, async () => {
        onProgress?.(`推送「${r.label}」⋯⋯`)
        await postJson(src, '/api/settings/weather', { realtimeQuery: { [field]: r.localValue } }, fetchImpl)
        result.pushed.push(r.label)
      })
    } else if (choice === 'remote') {
      await track(r.label, async () => {
        onProgress?.(`帶回「${r.label}」⋯⋯`)
        const prevRq = session.settings.weather?.realtimeQuery
        session.settings.weather = {
          enabled: false,
          polish: false,
          locationName: '',
          latitude: 0,
          longitude: 0,
          locationSource: '',
          ...session.settings.weather
        }
        session.settings.weather.realtimeQuery = {
          enabled: false,
          cwaApiKey: '',
          forecastCounty: '',
          ...prevRq,
          [field]: field === 'enabled' ? !!r.remoteValue : String(r.remoteValue)
        }
        await session.saveSettings()
        result.pulled.push(r.label)
      })
    }
  }

  // ── 模組開關：各自獨立，直接沿用 session.setModuleEnabled（處理各模組的特殊欄位） ──
  for (const r of rows) {
    if (!r.key.startsWith('module.') || !r.differs) continue
    const choice = choiceOf(r.key)
    const moduleId = r.key.slice('module.'.length)
    if (choice === 'local') {
      await track(r.label, async () => {
        onProgress?.(`推送「${r.label}」⋯⋯`)
        await postJson(src, '/api/settings/modules/toggle', { id: moduleId, enabled: r.localValue }, fetchImpl)
        result.pushed.push(r.label)
      })
    } else if (choice === 'remote') {
      await track(r.label, async () => {
        onProgress?.(`帶回「${r.label}」⋯⋯`)
        await session.setModuleEnabled(moduleId, !!r.remoteValue)
        result.pulled.push(r.label)
      })
    }
  }

  if (result.pulled.length > 0) {
    // 一次性存檔即可——上面每個「帶回」分支已經個別呼叫過 saveSettings()／
    // setModuleEnabled()（後者自己會存檔），這裡是保險，重複存檔沒有副作用。
    await session.saveSettings()
    session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  return result
}

/**
 * 三個欄位共用一支電腦端端點的通用處理：算出「三個欄位各自的目標值」
 * （被選中要推的用手機值，其餘維持電腦原本的值），只在真的有欄位要推時
 * 才發送一次請求；拉的方向不需要合併，各欄位獨立寫回 `session.settings`。
 */
async function applyGroupedNumeric(
  src: SyncSource,
  session: StandaloneSession,
  rows: SettingsFieldRow[],
  choices: SettingsChoiceMap,
  keys: readonly string[],
  path: string,
  buildPushPayload: (final: Record<string, string | number | boolean>) => Record<string, unknown>,
  writeLocal: (session: StandaloneSession, key: string, value: string | number | boolean) => void,
  result: SettingsApplyResult,
  onProgress: ((message: string) => void) | undefined,
  fetchImpl: FetchImpl
): Promise<void> {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const finalForRemote: Record<string, string | number | boolean> = {}
  const pushLabels: string[] = []
  const pullJobs: { key: string; label: string; value: string | number | boolean }[] = []

  for (const key of keys) {
    const r = byKey.get(key)
    if (!r) continue
    const choice = r.differs ? (choices[key] ?? 'keep') : 'keep'
    // 電腦端最終要維持的值：被推送的欄位用手機值，其餘（不動／被拉）維持電腦原值
    finalForRemote[key] = choice === 'local' ? r.localValue : r.remoteValue
    if (choice === 'local') pushLabels.push(r.label)
    if (choice === 'remote' && r.differs) pullJobs.push({ key, label: r.label, value: r.remoteValue })
  }

  if (pushLabels.length > 0) {
    try {
      onProgress?.(`推送「${pushLabels.join('、')}」⋯⋯`)
      await postJson(src, path, buildPushPayload(finalForRemote), fetchImpl)
      result.pushed.push(...pushLabels)
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      for (const label of pushLabels) result.failed.push({ label, error })
    }
  }

  for (const job of pullJobs) {
    try {
      onProgress?.(`帶回「${job.label}」⋯⋯`)
      writeLocal(session, job.key, job.value)
      result.pulled.push(job.label)
    } catch (err) {
      result.failed.push({ label: job.label, error: err instanceof Error ? err.message : String(err) })
    }
  }
}

/**
 * 換供應商時沒選過型號就補目錄預設值，避免存出空模型——跟桌面
 * `setLlmProviderDirect`、手機 `localDataSource.ts` 的 `setLlmProvider` 是同一條規則
 * （`core` 的 `resolveModel()` 才不會在空模型時墊錯供應商的型號）。
 */
function setLocalProvider(session: StandaloneSession, provider: string): void {
  const llm = session.settings.llm
  llm.provider = provider as typeof llm.provider
  const model = llm.models?.[provider] || DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER] || ''
  if (model) {
    llm.models = { ...llm.models, [provider]: model }
    llm.model = model
  }
  // 攤平的 `endpoint` 鏡像也要跟著換家，理由同上面那條：留著上一家的值，
  // 切去本機再切回雲端就會帶著本機網址走。
  llm.endpoint = llm.endpoints?.[provider]
}

/** 輔助模型版的 `setLocalProvider`：換供應商沒選過型號就補目錄預設值，避免存出空模型。 */
function setLocalUtilityProvider(session: StandaloneSession, provider: string): void {
  const llm = session.settings.llm
  llm.utilityProvider = provider as typeof llm.provider
  const model =
    llm.utilityModels?.[provider] || DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER] || ''
  if (model) llm.utilityModels = { ...llm.utilityModels, [provider]: model }
}
