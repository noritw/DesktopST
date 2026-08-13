import { useEffect, useState } from 'react'

/**
 * 等待網路回應時的秒數倒數（owner 2026-08-13 提議）。
 *
 * 為什麼需要：電腦關機時所有對電腦的請求都要等到逾時才會失敗，這段期間畫面
 * 只有一句「連線中⋯⋯」，使用者分不出「還在跑」與「又當掉了」——而這個 app
 * 前一天才剛因為漏掉逾時真的卡死過三次，所以那個懷疑完全合理。
 * 會動的數字同時回答兩件事：**它還活著**，以及**最久還要等多久**。
 *
 * ⚠️ **倒數的秒數一定要跟真正的逾時同一個來源**（`PROBE_TIMEOUT_MS`／
 * `MANIFEST_TIMEOUT_MS` 都已匯出）。自己另外寫一個數字的話，一旦兩邊不一致，
 * 使用者會看到「倒數到 0 卻還在轉」或「還沒數完就跳錯誤」——那比沒有倒數更糟，
 * 因為它會讓人不再相信畫面上的任何提示。
 *
 * 以「開始時刻 ＋ 現在時刻」推算而不是每秒遞減：手機把背景分頁的計時器降頻是
 * 常態，遞減式的倒數在切出去再切回來時會嚴重落後，而牆上時鐘不會。
 */
/**
 * 還剩幾秒（純算術，抽出來才測得到邊界）。
 *
 * `Math.ceil` 是刻意的：剩 0.3 秒時要顯示「1 秒」而不是「0 秒」——
 * 只有真的到期才顯示歸零，否則使用者會看到數字停在 0 卻還在跑。
 */
export function secondsLeftAt(totalMs: number, elapsedMs: number): number {
  return Math.ceil(Math.max(0, totalMs - elapsedMs) / 1000)
}

export function useCountdown(totalMs: number, running: boolean): number {
  const [left, setLeft] = useState(() => secondsLeftAt(totalMs, 0))

  useEffect(() => {
    if (!running) {
      setLeft(secondsLeftAt(totalMs, 0))
      return
    }
    const startedAt = Date.now()
    setLeft(secondsLeftAt(totalMs, 0))
    // 250ms 一次而不是 1000ms：整秒才更新的話，數字跳動與使用者的體感會差到一秒，
    // 看起來像卡頓。
    const timer = setInterval(() => {
      setLeft(secondsLeftAt(totalMs, Date.now() - startedAt))
    }, 250)
    return () => clearInterval(timer)
  }, [running, totalMs])

  return left
}

/**
 * 倒數文字。歸零之後不要顯示「0 秒」——那看起來像壞掉，
 * 實際狀況是「逾時已到，正在收尾」。
 */
export function countdownLabel(base: string, secondsLeft: number): string {
  return secondsLeft > 0 ? `${base}⋯⋯（${secondsLeft} 秒）` : `${base}⋯⋯（即將放棄）`
}
