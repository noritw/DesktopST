import { buildManifest } from '@core/sync/manifestBuild'
import { joinTriggerWords, settingsSnapshotHash, type SettingsSnapshot } from '@core/sync/settingsSnapshot'
import type { Manifest } from '@core/sync/types'
import type { StandaloneSession } from './session'
import { getJson, type FetchImpl, type SyncSource } from './syncTransport'

/**
 * S2 M2 差異預覽（`docs/mobile-mode-switch-sync.md` §6.2）：抓電腦端的輕量清單。
 *
 * 沿用 `syncTransport.ts` 的 token header／錯誤正規化——跟 S1 的
 * `fetchSyncPreview` 是同一套抓取邏輯，只是端點跟回應形狀不同。
 */
/**
 * 這支是「切換模式」按下去之後的第一個等待點，逾時要短：使用者正盯著畫面，
 * 電腦沒開時等 30 秒等同當掉（owner 2026-08-13 回報「卡在連線中沒反應」）。
 * 抓不到清單不會擋住切換——呼叫端會當成「這次不帶資料」照樣放行。
 */
export const MANIFEST_TIMEOUT_MS = 8000

export async function fetchRemoteManifest(src: SyncSource, fetchImpl: FetchImpl = globalThis.fetch): Promise<Manifest> {
  return getJson<Manifest>(src, '/api/sync-manifest', fetchImpl, MANIFEST_TIMEOUT_MS)
}

/** 電腦端目前的設定子集（S2 M5，比對畫面的「設定」分頁用）。 */
export async function fetchRemoteSettingsSnapshot(
  src: SyncSource,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SettingsSnapshot> {
  return getJson<SettingsSnapshot>(src, '/api/settings/sync-snapshot', fetchImpl, MANIFEST_TIMEOUT_MS)
}

/**
 * 手機端的設定比對子集（S2 M5）。**唯一**的定義在 `core/sync/settingsSnapshot.ts`，
 * 這裡只是把 `session.settings` 的形狀套進那個共用型別，不要另外組欄位——
 * 兩邊定義一旦漂移，設定同步會整個判斷錯亂且沒有任何錯誤訊息（見該檔案檔頭）。
 */
export async function buildLocalSettingsSnapshot(session: StandaloneSession): Promise<SettingsSnapshot> {
  const llm = session.settings.llm
  const modules = await session.listModules()
  const newsEditable = await session.getNewsEditableSettings()
  return {
    llm: {
      provider: llm.provider,
      models: { ...(llm.models ?? {}) },
      endpoints: { ...(llm.endpoints ?? {}) },
      extraInstruction: llm.extraInstruction ?? '',
      maxResponseTokens: llm.maxResponseTokens,
      maxGroupRounds: llm.maxGroupRounds,
      maxImagesPerMessage: llm.maxImagesPerMessage,
      utilityEnabled: !!llm.utilityEnabled,
      utilityProvider: llm.utilityProvider ?? llm.provider,
      utilityModels: { ...(llm.utilityModels ?? {}) }
    },
    // ⚠️ 只挑三欄，**不要整包塞** `session.settings.memory`——它多一個
    // `keepDebugPromptN`（桌面 Log 視窗專用），而桌面端只回三欄，多帶一欄
    // 會讓 `settingsSnapshotHash()` 永遠對不起來（見 `MemorySyncSubset` 檔內說明）。
    memory: {
      keepRecentN: session.settings.memory.keepRecentN,
      autoSummarizeAfter: session.settings.memory.autoSummarizeAfter,
      autoSummarizeEnabled: session.settings.memory.autoSummarizeEnabled
    },
    colorTheme: session.settings.ui.colorTheme ?? 'mint',
    modules: modules.map((m) => ({ id: m.id, label: m.label, enabled: m.enabled })),
    weather: {
      polish: !!session.settings.weather?.polish,
      realtimeQueryEnabled: !!session.settings.weather?.realtimeQuery?.enabled,
      realtimeQueryForecastCounty: session.settings.weather?.realtimeQuery?.forecastCounty ?? ''
    },
    news: {
      speakButton: newsEditable.speakButton,
      conversationSearchEnabled: !!newsEditable.conversationSearch?.enabled,
      conversationSearchTriggerWords: joinTriggerWords(newsEditable.conversationSearch?.triggerWords),
      conversationSearchMaxAgeHours: newsEditable.conversationSearch?.maxAgeHours ?? 0
    },
    appearance: {
      showLlmBadge: session.settings.ui.showLlmBadge ?? true,
      showPersonaName: session.settings.ui.showPersonaName ?? true
    }
  }
}

/**
 * 把手機本地資料組成跟 `/api/sync-manifest` 一樣的輕量清單，供 `computeDiff` 比對。
 */
export async function buildLocalManifest(session: StandaloneSession): Promise<Manifest> {
  const [lorebooks, settingsSnapshot] = await Promise.all([
    session.listLorebooksManifest(),
    buildLocalSettingsSnapshot(session)
  ])

  /*
   * 用語解說要**整本**才算得出 contentHash，`listLorebooksManifest()` 只給
   * id/name/updatedAt。本數很少（個位數），逐本讀進來不是問題；讀不到的
   * 那本就跳過雜湊、留在清單裡當成 `unknown`，不要整趟失敗。
   */
  const books = (await Promise.all(lorebooks.map((l) => session.getLorebook(l.id).catch(() => null)))).filter(
    (b): b is NonNullable<typeof b> => !!b
  )

  return buildManifest({
    characters: session.characters,
    personas: session.personas,
    worlds: session.worlds,
    scenes: session.scenes,
    lorebooks: books,
    conversations: session.listConversationsManifest(),
    settingsHash: settingsSnapshotHash(settingsSnapshot)
  })
}
