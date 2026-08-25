import { KINDS, defaultChoice, pairManifests, type ChoiceMap, type PairKind, type PairTable } from '@core/sync/pair'
import { buildLocalManifest, fetchRemoteManifest } from './syncManifest'
import { applySync } from './syncApply'
import { postJson, type FetchImpl, type SyncSource } from './syncTransport'
import { bootStandaloneSession, type StandaloneSession } from './session'
import { getStandaloneSession } from './sessionHolder'
import { capacitorAdapters, initCapacitorSecrets } from '../adapters'

/**
 * 拿一份可以讀寫本機資料的 session（比照 `ModeSwitcher.tsx` 的
 * `localSessionForSync()`）。遙控模式下沒有活著的獨立模式 session，
 * 這裡臨時 boot 一份純粹用來跑這次同步，不接手成為目前使用中的 session
 * ——跟模式切換前的同步不同，這裡不呼叫模式切換，`setPendingStandaloneSession`
 * 用不到。
 */
export async function getLocalSessionForSync(): Promise<StandaloneSession> {
  await initCapacitorSecrets()
  const existing = getStandaloneSession()
  if (existing) return existing
  return bootStandaloneSession(capacitorAdapters)
}

/**
 * §7「推到手機」情況 A／情況 B 共用的核心：只跑 `reminders` 這個 kind 的同步，
 * 不打開完整的逐項比對畫面（`docs/calendar-driven-reminders-kickoff.md` §7）。
 *
 * 每一列的方向用 `defaultChoice()`（只有單邊有的補到另一邊；兩邊都有但內容
 * 不同的維持 `keep`，不自動覆蓋）——跟完整比對畫面「保留差異」按鈕同一套規則，
 * 只是不需要使用者確認。日曆衍生提醒最常見的動作是新增／刪除，這條規則已經
 * 覆蓋；如果使用者手動改過的提醒同時兩邊都有變動，維持 `keep` 讓使用者自己
 * 開完整比對畫面處理，不冒然覆蓋。
 */

export interface RemindersQuickSyncResult {
  ok: boolean
  /** 這次實際 push/pull/刪除的筆數 */
  changed: number
  error?: string
}

function emptyChoiceMap(): ChoiceMap {
  const out = {} as ChoiceMap
  for (const kind of KINDS) out[kind] = {}
  return out
}

export async function runRemindersQuickSync(
  remoteSrc: SyncSource,
  localSession: StandaloneSession,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<RemindersQuickSyncResult> {
  try {
    const [local, remote] = await Promise.all([
      buildLocalManifest(localSession),
      fetchRemoteManifest(remoteSrc)
    ])
    const table: PairTable = pairManifests(local, remote)

    const choices = emptyChoiceMap()
    const remindersKind: PairKind = 'reminders'
    for (const row of table[remindersKind]) {
      choices[remindersKind][row.key] = defaultChoice(row)
    }

    const result = await applySync(remoteSrc, localSession, { table, choices }, fetchImpl)
    const failed = result.failed.filter(f => f.kind === remindersKind)
    const changed =
      result.pushed[remindersKind].length + result.pulled[remindersKind].length +
      result.deletedLocal[remindersKind].length + result.deletedRemote[remindersKind].length

    if (failed.length === 0) {
      // 桌面用這個信號清掉「未推送到手機」旗標，見 §6.1。失敗不影響這次同步結果，
      // 純粹是順手清狀態，清不掉下次還會再提醒，不算嚴重。
      await postJson(remoteSrc, '/api/reminders/sync-complete', {}, fetchImpl).catch(() => {})
    }

    return { ok: failed.length === 0, changed, error: failed[0]?.error }
  } catch (e) {
    return { ok: false, changed: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
