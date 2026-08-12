import { sha1Hex } from '@core/util/sha1'
import { stableStringify } from '@core/util/stableJson'
import type { Manifest } from '@core/sync/types'
import type { StandaloneSession } from './session'
import { getJson, type FetchImpl, type SyncSource } from './syncTransport'

/**
 * S2 M2 差異預覽（`docs/mobile-mode-switch-sync.md` §6.2）：抓電腦端的輕量清單。
 *
 * 沿用 `syncTransport.ts` 的 token header／錯誤正規化——跟 S1 的
 * `fetchSyncPreview` 是同一套抓取邏輯，只是端點跟回應形狀不同。
 */
export async function fetchRemoteManifest(src: SyncSource, fetchImpl: FetchImpl = globalThis.fetch): Promise<Manifest> {
  return getJson<Manifest>(src, '/api/sync-manifest', fetchImpl)
}

/**
 * 把手機本地資料組成跟 `/api/sync-manifest` 一樣的輕量清單，供 `computeDiff` 比對。
 *
 * `settingsHash` 的計算子集**必須**跟桌面端 `buildSettingsManifestHash`
 * （`main/mobileServer.ts`）完全對齊，否則雙邊永遠對不起來——見那邊的註解。
 */
export async function buildLocalManifest(session: StandaloneSession): Promise<Manifest> {
  const [lorebooks, modules] = await Promise.all([session.listLorebooksManifest(), session.listModules()])

  const llm = session.settings.llm
  const subset = {
    llm: {
      provider: llm.provider,
      model: llm.model,
      models: llm.models,
      endpoint: llm.endpoint,
      maxResponseTokens: llm.maxResponseTokens,
      maxGroupRounds: llm.maxGroupRounds,
      maxImagesPerMessage: llm.maxImagesPerMessage
    },
    memory: session.settings.memory,
    colorTheme: session.settings.ui.colorTheme ?? 'mint',
    modules: modules.map((m) => ({ id: m.id, label: m.label, enabled: m.enabled }))
  }

  return {
    characters: session.characters.map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt })),
    personas: session.personas.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })),
    worlds: session.worlds.map((w) => ({ id: w.id, name: w.name, updatedAt: w.updatedAt })),
    scenes: session.scenes.map((s) => ({ id: s.id, name: s.name, updatedAt: s.updatedAt })),
    lorebooks,
    conversations: session.listConversationsManifest(),
    settingsHash: sha1Hex(stableStringify(subset))
  }
}
