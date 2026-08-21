import type { ConnectionStatus } from '@core/events'

/**
 * 「已經斷線多久了」的狀態推進（純函式，抽出來才測得到）。
 *
 * ## ⚠️ 為什麼不能把「不是 offline」當成「連上了」
 *
 * `RemoteEventSource` 斷線後會不斷退避重連，而**每一次重連嘗試都會把狀態設成
 * `'connecting'`**（`connect()` 開頭的 `setStatus('connecting')`），退避間隔是
 * 0.5→1→2→4→8 秒。所以斷線期間看到的狀態是這樣一直跳：
 *
 *   offline → connecting → offline → connecting → ⋯
 *
 * 第一版把「非 offline」一律視為恢復連線、把計時歸零，結果就是 8 秒的門檻
 * **永遠數不完**——owner 2026-08-13 回報「遙控版斷線好像還是沒跳訊息」，
 * 接 USB 抓 logcat 看到 `close` 之後 2 秒就 `connecting`，正是這個。
 *
 * 正確規則：**只有真的 `'online'` 才算恢復**；`'connecting'`／`'idle'` 一律
 * 維持原樣（不歸零也不開始計時），讓計時從第一次 `'offline'` 一路延續下去。
 */
export function nextOfflineSince(
  status: ConnectionStatus,
  prev: number | null,
  now: number,
  isRemote = true
): number | null {
  /*
   * 本機模式根本沒有「連不上電腦」這回事，一律歸零。
   *
   * ⚠️ **一定要在這裡明確歸零，不能只是「不更新」。** 第一版是在 effect 裡
   * `if (conn.mode !== 'remote') return`，於是從遙控切到本機時計時值原封不動
   * 留著——斷線橫幅與紅色標籤跟著留在本機模式的畫面上（owner 2026-08-13 回報
   * 「切到本機之後斷線提示還留在那邊」）。切模式是「換一個世界」，
   * 上一個模式的連線狀態不該跟過來。
   */
  if (!isRemote) return null
  // 只有真的連上才算恢復
  if (status === 'online') return null
  /*
   * `'connecting'` 也要開始計時，不只是 `'offline'`。
   *
   * 兩種「連不上」長得不一樣：**用到一半斷線**會先跳 `'offline'`；但**一開始
   * 就連不上**（電腦關著時開 App、或按了「繼續嘗試連線」）的話 WebSocket 會
   * 一直卡在連線中，`'offline'` 可能好幾分鐘都不會出現（不可路由的位址要等
   * TCP 逾時）。只認 `'offline'` 的話後者永遠不會有任何提示——瀏覽器實測
   * 14 秒內橫幅與標籤都沒出現，就是這個。
   *
   * owner 要的本來就是這兩種：「斷線超過一定時間**／嘗試多次連不上**」。
   */
  if (status === 'offline' || status === 'connecting') return prev ?? now
  // 'idle'：事件來源還沒啟動，不要憑空開始計時
  return prev
}

/** 連線恢復（可以把「這次斷線問過了」重設，下次斷線要重新問）。 */
export function isReconnected(status: ConnectionStatus): boolean {
  return status === 'online'
}
