import { SYNC_LLM_PROVIDERS, type SettingsSnapshot } from './settingsSnapshot'

/**
 * 設定的逐欄位比對（S2 M5）。
 *
 * 跟 `pair.ts`（角色／使用者設定／世界觀／情境／用語解說）是平行的兩套系統，
 * 刻意不共用型別：`pair.ts` 比對的是「一筆一筆、各自有 id 的實體」，
 * 兩邊都有時才談「是不是同一個」；設定不是這樣——`llm.provider` 這種欄位
 * **兩邊永遠都有值**，沒有「只有手機有」這種狀態，所以不需要 id 配對、
 * 也沒有 M4 那種「選空的一邊＝刪除」的語意。硬套同一組型別只會讓兩邊都
 * 長出一堆用不到的可選欄位。
 */

export type SettingsChoice = 'local' | 'remote' | 'keep'
export type SettingsChoiceMap = Record<string, SettingsChoice>

/** 分組只用來在畫面上加小標題，不影響比對或套用邏輯。 */
export type SettingsGroup = 'llm' | 'chat' | 'memory' | 'appearance' | 'modules'

export interface SettingsFieldRow {
  /** 穩定 key，同時是 `SettingsChoiceMap` 的索引與套用邏輯的分派依據。 */
  key: string
  group: SettingsGroup
  /** 中文標籤留在這裡而不是 UI 層——設定欄位是固定集合，不像實體名稱是使用者輸入的資料。 */
  label: string
  localValue: string | number | boolean
  remoteValue: string | number | boolean
  differs: boolean
}

function row(
  key: string,
  group: SettingsGroup,
  label: string,
  l: string | number | boolean,
  r: string | number | boolean
): SettingsFieldRow {
  return { key, group, label, localValue: l, remoteValue: r, differs: l !== r }
}

/** provider id → 中文名稱。UI 層的 `PROVIDER_LABELS`（`mobile/ui/settings/providerInfo.ts`）刻意不搬進 core（roadmap §3.3：中文文案不進 core），這裡是唯一例外——因為 label 要跟著欄位一起產生，放 UI 層就得把「這個 key 對應哪個 provider」的知識也搬過去，兩邊都要維護。 */
/**
 * Spotify／日曆的 `enabled` 不進同步比對（owner 2026-08-17）：授權只接桌面，
 * 手機上這顆開關開了也沒有對應功能。id 跟 `mobile/runtime/session.ts`／
 * `main/ipcHandlers.ts` 的 `SPOTIFY_MODULE_ID`／`CALENDAR_MODULE_ID` 對齊。
 */
const EXCLUDED_MODULE_IDS = new Set(['desktopst.spotify', 'desktopst.calendar'])

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
  gemini: 'Google Gemini',
  grok: 'xAI Grok',
  local: '本機／自訂端點'
}

export function pairSettings(local: SettingsSnapshot, remote: SettingsSnapshot): SettingsFieldRow[] {
  const rows: SettingsFieldRow[] = [
    row('llm.provider', 'llm', '使用中的 AI 供應商', local.llm.provider, remote.llm.provider),
    ...SYNC_LLM_PROVIDERS.map((p) =>
      row(`llm.models.${p}`, 'llm', `${PROVIDER_LABEL[p]} 模型`, local.llm.models[p] ?? '', remote.llm.models[p] ?? '')
    ),
    // 端點比照模型逐 provider 一列。原本是單一「自訂 API 端點」一列，
    // 拆表之後若還併成一列，使用者會看到「不同」卻不知道是哪一家不同。
    ...SYNC_LLM_PROVIDERS.map((p) =>
      row(
        `llm.endpoints.${p}`,
        'llm',
        `${PROVIDER_LABEL[p]} 端點`,
        local.llm.endpoints[p] ?? '',
        remote.llm.endpoints[p] ?? ''
      )
    ),
    row('llm.extraInstruction', 'llm', '自訂補充指示', local.llm.extraInstruction, remote.llm.extraInstruction),
    row('llm.utilityEnabled', 'llm', '輔助模型：使用獨立模型', local.llm.utilityEnabled, remote.llm.utilityEnabled),
    row('llm.utilityProvider', 'llm', '輔助模型：供應商', local.llm.utilityProvider, remote.llm.utilityProvider),
    ...SYNC_LLM_PROVIDERS.map((p) =>
      row(
        `llm.utilityModels.${p}`,
        'llm',
        `輔助模型：${PROVIDER_LABEL[p]} 模型`,
        local.llm.utilityModels[p] ?? '',
        remote.llm.utilityModels[p] ?? ''
      )
    ),
    row('llm.maxResponseTokens', 'chat', '最大回應字數', local.llm.maxResponseTokens, remote.llm.maxResponseTokens),
    row('llm.maxGroupRounds', 'chat', '群組最多角色回應數', local.llm.maxGroupRounds, remote.llm.maxGroupRounds),
    row('llm.maxImagesPerMessage', 'chat', '單則訊息圖片上限', local.llm.maxImagesPerMessage, remote.llm.maxImagesPerMessage),
    row('memory.keepRecentN', 'memory', '完整保留最近幾則', local.memory.keepRecentN, remote.memory.keepRecentN),
    row('memory.autoSummarizeAfter', 'memory', '自動摘要門檻', local.memory.autoSummarizeAfter, remote.memory.autoSummarizeAfter),
    row(
      'memory.autoSummarizeEnabled',
      'memory',
      '自動摘要開關',
      local.memory.autoSummarizeEnabled,
      remote.memory.autoSummarizeEnabled
    ),
    row('colorTheme', 'appearance', '配色主題', local.colorTheme, remote.colorTheme),
    row('appearance.showLlmBadge', 'appearance', '顯示模型徽章', local.appearance.showLlmBadge, remote.appearance.showLlmBadge),
    row(
      'appearance.showPersonaName',
      'appearance',
      '顯示發話身分名稱',
      local.appearance.showPersonaName,
      remote.appearance.showPersonaName
    ),
    row('weather.polish', 'modules', '天氣：使用輔助模型潤飾', local.weather.polish, remote.weather.polish),
    row(
      'weather.realtimeQueryEnabled',
      'modules',
      '天氣：啟用即時氣象查詢',
      local.weather.realtimeQueryEnabled,
      remote.weather.realtimeQueryEnabled
    ),
    row(
      'weather.realtimeQueryForecastCounty',
      'modules',
      '天氣：即時查詢預設縣市',
      local.weather.realtimeQueryForecastCounty,
      remote.weather.realtimeQueryForecastCounty
    ),
    row('news.speakButton', 'modules', '新聞：陪聊頻率', local.news.speakButton, remote.news.speakButton),
    row(
      'news.conversationSearchEnabled',
      'modules',
      '新聞：對話中搜尋新聞',
      local.news.conversationSearchEnabled,
      remote.news.conversationSearchEnabled
    ),
    row(
      'news.conversationSearchTriggerWords',
      'modules',
      '新聞：對話搜尋觸發詞',
      local.news.conversationSearchTriggerWords,
      remote.news.conversationSearchTriggerWords
    ),
    row(
      'news.conversationSearchMaxAgeHours',
      'modules',
      '新聞：對話搜尋時效（小時，0＝不限）',
      local.news.conversationSearchMaxAgeHours,
      remote.news.conversationSearchMaxAgeHours
    )
  ]

  // 模組：以手機清單為主（兩邊模組集合理論上相同，是同一份程式碼算出來的），
  // 電腦有而手機沒有的（例如舊版手機還沒有某模組）附加在後面、用電腦的 label。
  //
  // ⚠️ **Spotify／日曆的 `enabled` 刻意排除**（owner 2026-08-17 決定）。
  // 這兩個模組的授權只接在桌面（OAuth 跳轉流程），手機上把這顆開關同步成
  // 開著也完全用不了——同步了反而讓使用者以為手機上能用。
  const remoteModules = new Map(remote.modules.map((m) => [m.id, m]))
  for (const m of local.modules) {
    const r = remoteModules.get(m.id)
    remoteModules.delete(m.id)
    if (EXCLUDED_MODULE_IDS.has(m.id)) continue
    rows.push(row(`module.${m.id}`, 'modules', `模組：${m.label}`, m.enabled, r ? r.enabled : m.enabled))
  }
  for (const m of remoteModules.values()) {
    if (EXCLUDED_MODULE_IDS.has(m.id)) continue
    rows.push(row(`module.${m.id}`, 'modules', `模組：${m.label}`, m.enabled, m.enabled))
  }

  return rows
}

/** 差異都預設「不動」——跟實體不同，設定沒有「單邊獨有＝該補齊」的狀況，兩邊都是使用者刻意設過的值，不能替使用者決定要用哪一個。 */
export function defaultSettingsChoice(): SettingsChoice {
  return 'keep'
}

export function defaultSettingsChoices(rows: SettingsFieldRow[]): SettingsChoiceMap {
  const out: SettingsChoiceMap = {}
  for (const r of rows) out[r.key] = defaultSettingsChoice()
  return out
}

/** 「全部用手機」／「全部用電腦」／「保留全部」三顆快捷鍵。 */
export function applySettingsPreset(rows: SettingsFieldRow[], preset: SettingsChoice): SettingsChoiceMap {
  const out: SettingsChoiceMap = {}
  for (const r of rows) out[r.key] = r.differs ? preset : 'keep'
  return out
}

export interface SettingsPlanCounts {
  push: number
  pull: number
  untouched: number
}

export function countSettingsPlan(rows: SettingsFieldRow[], choices: SettingsChoiceMap): SettingsPlanCounts {
  const counts: SettingsPlanCounts = { push: 0, pull: 0, untouched: 0 }
  for (const r of rows) {
    const choice = choices[r.key] ?? 'keep'
    if (!r.differs || choice === 'keep') counts.untouched++
    else if (choice === 'local') counts.push++
    else counts.pull++
  }
  return counts
}
