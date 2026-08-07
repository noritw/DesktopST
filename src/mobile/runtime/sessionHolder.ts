import type { StandaloneSession } from './session'

/**
 * 目前這個 app 的獨立模式 session（沒有就是遙控模式）。
 *
 * **為什麼不走 `DataSource`**：同步是「跟另一台機器談」，不是「讀寫目前這份資料」。
 * 遙控模式下這件事沒有意義（資料本來就在電腦上），硬塞進 `DataSource` 介面會逼
 * `RemoteDataSource` 生一堆 `not-supported`，也讓 UI 誤以為兩種模式都能同步。
 *
 * 由 `App.tsx` 在開機分流時設定，是**唯一**的寫入點。
 */
let current: StandaloneSession | null = null

export function setStandaloneSession(session: StandaloneSession | null): void {
  current = session
}

export function getStandaloneSession(): StandaloneSession | null {
  return current
}
