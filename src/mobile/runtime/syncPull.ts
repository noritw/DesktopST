import type { StandaloneSession } from './session'
import { runSyncImport, type SyncInitBundle, type SyncResult } from './syncImport'
import { getJson, type FetchImpl, type SyncSource } from './syncTransport'

/**
 * S2 M3 拉取邏輯（`docs/mobile-sync-m3-kickoff.md` P1 修正）。
 *
 * **遙控 → 獨立**時的資料流是「電腦 → 手機」（`docs/mobile-mode-switch-sync.md` §2）。
 * 不重新發明一套逐項選取邏輯——直接沿用 S1（`syncImport.ts` 的 `runSyncImport`）
 * 既有的下載／落地／id remap 流程，把它當成「這次切換時再跑一次的初始化匯入」。
 *
 * 與真正的 S1 初次匯入唯一的差異：`onConflict` 固定用 `'overwrite'`——這次是
 * 使用者在「遙控 → 獨立」切換當下明確選了「帶過去」，電腦是剛才在用的那一份，
 * 同名的就是同一隻角色被電腦端改過，理應蓋掉手機上舊的那份。
 */
export async function pullFromDesktop(
  src: SyncSource,
  session: StandaloneSession,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<SyncResult> {
  const bundle = await getJson<SyncInitBundle>(src, '/api/sync-init', fetchImpl)

  /*
   * S2 同步任何情況都不碰 API Key（roadmap §4.7 硬規則、
   * `mobile-mode-switch-sync.md` §3.2）——僅 S1 初始化才給。
   * `runSyncImport` 本來是給 S1 用的，`bundle.llm.apiKeys` 有值就會被
   * `applySettings()` 帶進去，這裡先拔掉才能安全複用同一支函式。
   */
  if (bundle.llm?.apiKeys) delete bundle.llm.apiKeys
  if (bundle.weather?.realtimeQuery?.cwaApiKey) delete bundle.weather.realtimeQuery.cwaApiKey

  return runSyncImport(src, session, { onConflict: 'overwrite', bundle }, fetchImpl)
}
