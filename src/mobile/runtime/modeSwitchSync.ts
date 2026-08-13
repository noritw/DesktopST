import type { SyncDiff } from '@core/sync/types'
import type { StandaloneSession } from './session'
import type { SyncResult } from './syncImport'
import { pullFromDesktop } from './syncPull'
import { buildPushSelection, pushSync, type NameConflict, type PushSummary } from './syncPush'
import type { FetchImpl, SyncSource } from './syncTransport'

/**
 * 模式切換時的資料搬運方向（`docs/mobile-mode-switch-sync.md` §2）。
 *
 * 抽成獨立、不碰 React／Capacitor 的函式，是因為 P1 那次踩過的坑
 * （`docs/mobile-sync-m3-kickoff.md` §0.1）正是「方向接錯」——`ModeSwitcher.tsx`
 * 把手機 → 電腦的推送邏輯掛在了「遙控 → 獨立」上。方向本身要能被單元測試
 * 直接驗證，不能只靠人眼看 UI 程式碼順不順；如果邏輯留在元件的閉包裡，
 * 測這件事就得整套掛起 React／zustand／Capacitor，成本完全不成比例。
 */

/**
 * 獨立 → 遙控：把手機資料推到電腦。
 * 呼叫端（`ModeSwitcher.tsx` 的 `tryConnect`）負責先讓使用者選過
 * 「帶過去並切換」，且只有這個方向才會呼叫這支。
 */
export async function pushLocalToRemote(
  remoteSrc: SyncSource,
  session: StandaloneSession,
  diff: SyncDiff,
  onProgress: (msg: string) => void,
  onNameConflicts?: (conflicts: NameConflict[]) => Promise<Set<string> | null>,
  fetchImpl?: FetchImpl
): Promise<PushSummary> {
  const selectedIds = await buildPushSelection(diff, session)
  return pushSync(remoteSrc, session, diff, { selectedIds, onProgress, onNameConflicts }, fetchImpl)
}

/**
 * 遙控 → 獨立：把電腦資料拉回手機。
 * 呼叫端（`ModeSwitcher.tsx` 的 `goStandalone`）負責先讓使用者選過
 * 「帶過去並切換」，且只有這個方向才會呼叫這支。
 */
export async function pullRemoteToLocal(
  remoteSrc: SyncSource,
  session: StandaloneSession,
  fetchImpl?: FetchImpl
): Promise<SyncResult> {
  return pullFromDesktop(remoteSrc, session, fetchImpl)
}
