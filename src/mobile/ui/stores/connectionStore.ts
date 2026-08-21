import { create } from 'zustand'
import { Capacitor } from '@capacitor/core'
import * as keys from '@core/store/keys'
import { capacitorAdapters } from '../../adapters'
import { resolveConnection, type Connection, type ModePref } from '../connection'

/**
 * 目前連線狀態（S2 M1，`docs/mobile-mode-switch-sync.md` §4）。
 *
 * 取代原本 `App.tsx` 裡 `useMemo(() => resolveConnection(), [])` 的常數寫法——
 * `conn` 現在是可以變動的 store 狀態，讓「不重開 App 就切換模式」成立。
 * `App.tsx` 的 attach effect 只要繼續依賴 `conn`，掛載／卸載循環就自動是對的
 * （這是設計文件 §4.1 的關鍵觀察，不需要重寫連線層）。
 */

interface ConnectionState {
  /** `null` 表示 `init()` 還沒解析完成（要先讀存好的偏好）。 */
  conn: Connection | null
  init: () => Promise<void>
  /**
   * 切換模式。呼叫端（UI）自己負責先做完 §4.3 的守門檢查
   * （是否正在生成、遙控是否連得上）——這裡只管「切了之後記不記得住」。
   */
  switchTo: (next: Connection) => Promise<void>
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  conn: null,

  init: async () => {
    const pref = await readModePref()
    set({ conn: resolveConnection(location, pref) })
  },

  switchTo: async (next) => {
    set({ conn: next })
    // 網頁版沒有「原生殼冷啟動」這回事，偏好對它沒有意義（見 connection.ts 的原生判斷）。
    if (!Capacitor.isNativePlatform()) return

    /*
     * ⚠️ 切回獨立時**不能把記住的 `remote` 洗掉**——不然下次「切換到遙控」
     * 就永遠找不到上次那台電腦，每次都要重新掃 QR。只有切到遙控成功時才更新它。
     */
    const prev = await readModePref()
    const pref: ModePref =
      next.mode === 'remote'
        ? { mode: 'remote', remote: { baseUrl: next.baseUrl, token: next.token } }
        : { mode: 'standalone', remote: prev?.remote }
    await capacitorAdapters.storage.writeJson(keys.MODE_PREF_KEY, pref)
  }
}))

async function readModePref(): Promise<ModePref | null> {
  if (!Capacitor.isNativePlatform()) return null
  return capacitorAdapters.storage.readJson<ModePref>(keys.MODE_PREF_KEY)
}
