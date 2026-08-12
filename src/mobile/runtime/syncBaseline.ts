import type { StorageAdapter } from '@core/adapters/storage'
import * as keys from '@core/store/keys'
import type { SyncBaseline } from '@core/sync/types'

/**
 * 讀手機上存的同步基準（S2 M2／M3，`docs/mobile-mode-switch-sync.md` §5）。
 *
 * key 不存在（例如第一次切換）時回傳 `null`，呼叫端（`syncManifest.ts` 的
 * `previewSync`）要把這個狀態當成「還沒比對過」，不是「比對出全部都不一樣」。
 */
export async function readBaseline(storage: StorageAdapter): Promise<SyncBaseline | null> {
  return storage.readJson<SyncBaseline>(keys.SYNC_BASELINE_KEY)
}

/**
 * 寫回同步基準（S2 M3）。
 *
 * **重要**：只在推送迴圈裡、每一項**真的成功送出**之後才呼叫。
 * 使用者選「直接切、不帶」時整個推送迴圈根本不會跑，基準檔案原封不動
 * （`docs/mobile-sync-m3-kickoff.md` §3.1）。
 */
export async function writeBaseline(storage: StorageAdapter, baseline: SyncBaseline): Promise<void> {
  await storage.writeJson(keys.SYNC_BASELINE_KEY, baseline)
}
