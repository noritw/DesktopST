import { useEffect } from 'react'
import { handleBack, useUiStore } from '../stores/uiStore'

/**
 * 返回鍵／返回手勢。
 *
 * 手機使用者的第一直覺是「往回滑」而不是找 ✕。少了這個，每一層 sheet 都會變成
 * 陷阱：滑回去卻整個 app 關掉（APK）或跳離頁面（網頁版）。
 *
 * ## 作法：拿 history 當堆疊的影子
 *
 * 每疊一層畫面就 `pushState` 一筆，返回時 `popstate` 觸發 `handleBack()`。
 * 這樣**瀏覽器返回手勢、Android 實體返回鍵、我們自己的 ✕ 三者共用同一條路徑**，
 * 不會出現「用手勢關掉但 stack 還留著」的錯位。
 *
 * ⚠️ **APK 的實體返回鍵**目前也走這條（Android WebView 會把它轉成 popstate）。
 * 若之後發現行為不一致，再裝 `@capacitor/app` 用它的 `backButton` 事件覆蓋 ——
 * 屆時只改這支檔案，`handleBack()` 不用動。
 */
export function useBackButton(): void {
  const depth = useUiStore((s) => s.stack.length + (s.dialog ? 1 : 0))

  useEffect(() => {
    const onPop = (): void => {
      // 消化掉了就停在這裡；下面那個 effect 會把 history 長度補回來。
      if (handleBack()) return
      // 沒東西可關：讓它真的返回（網頁版回上一頁／APK 退出）。
      history.back()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 讓 history 的深度追上畫面堆疊的深度。
  useEffect(() => {
    const current = (history.state as { destDepth?: number } | null)?.destDepth ?? 0
    if (depth > current) history.pushState({ destDepth: depth }, '')
  }, [depth])
}
