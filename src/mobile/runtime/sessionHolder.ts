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

/**
 * 一個「已經 boot 好、等著被 `App.tsx` 收編」的獨立模式 session（B-6，2026-08-16）。
 *
 * 遙控模式下切去獨立模式前，`ModeSwitcher.tsx` 的 `localSessionForSync()` 會
 * 先自己 boot 一份 session 來跑同步（比對畫面時 `current` 還是 null，遙控模式
 * 沒有活著的獨立 session）。同步把改動（例如對面改過的對話標題）寫進**這份**
 * session 的記憶體與磁碟之後，緊接著的 `switchTo()` 會讓 `App.tsx` 的 attach
 * effect 重跑——但那個 effect 的 cleanup **無條件** `setStandaloneSession(null)`，
 * 而且 cleanup 一定搶在新的 effect 本體之前跑，所以就算 `localSessionForSync()`
 * 直接把剛 boot 的 session 塞進 `current`，也會在新 effect 讀到之前就被清掉。
 * 直接改那段 cleanup 邏輯風險較高（那裡踩過好幾次坑，見 CLAUDE.md §5）。
 *
 * 改用另一個變數繞開這個問題：`current` 的 cleanup 完全不會碰到它。
 * `App.tsx` 進入獨立模式時**優先收下**這裡的 session（而不是重新 boot 一份
 * 只認磁碟的新的）——省一次重複 boot，也保證同步剛寫進記憶體的東西
 * （不必等它落地磁碟被下一次 boot 讀回來）立刻就是接下來 UI 看到的那份。
 *
 * `take` 之後自動清空：只用一次，用過即棄，不要變成另一個常駐單例。
 */
let pending: StandaloneSession | null = null

export function setPendingStandaloneSession(session: StandaloneSession): void {
  pending = session
}

export function takePendingStandaloneSession(): StandaloneSession | null {
  const s = pending
  pending = null
  return s
}
