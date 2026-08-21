import { useEffect } from 'react'
import { handleBack, useUiStore } from '../stores/uiStore'

/**
 * 返回鍵／返回手勢。
 *
 * 手機使用者的第一直覺是「往回滑」而不是找 ✕。少了這個，每一層 sheet 都會變成
 * 陷阱：滑回去卻整個 app 關掉（APK）或跳離頁面（網頁版）。
 *
 * ## 兩條路徑，因為 WebView 與瀏覽器的返回鍵根本不是同一件事
 *
 * · **APK**：`@capacitor/app` 的 `backButton` 事件。
 * · **瀏覽器**：拿 history 當堆疊的影子——每疊一層就 `pushState`，返回時吃 `popstate`。
 *
 * ⚠️ **APK 不能靠 popstate。** 原本整支只有 popstate 那條，註解寫著
 * 「Android WebView 會把返回鍵轉成 popstate」——**這是錯的**。
 * Capacitor 8 的 `BridgeActivity` 沒有覆寫 `onBackPressed`，返回鍵走的是
 * Activity 預設行為（直接 `finish()`），完全不碰 WebView 的歷史。
 * 結果是**返回手勢在 APK 裡從來沒有生效過**：一按就結束 activity，
 * 使用者從最近使用重新進來時 app 是全新啟動、停在聊天畫面 ——
 * 看起來就是「正在管理關鍵字，點一點就自己跳回首頁」
 * （owner 2026-08-12 回報，靠 `[nav-diag]` 完全沒印出 `back` 才定位到）。
 *
 * 兩條路徑共用 `handleBack()`，所以「哪一層該先關」的規則只有一份。
 */
export function useBackButton(): void {
  // 深度要涵蓋**每一個吃返回鍵的東西**（見 `handleBack`）。
  // 少算任何一項，返回一次就會連關兩層。
  const depth = useUiStore((s) => s.stack.length + (s.dialog ? 1 : 0) + (s.lightbox ? 1 : 0))

  // ── APK：原生返回鍵 ──────────────────────────────────
  useEffect(() => {
    let remove: (() => void) | null = null
    let cancelled = false

    void (async () => {
      // 動態 import：瀏覽器煙測與 vitest 沒有原生 plugin，靜態 import 會在載入時就炸。
      const mod = await import('@capacitor/app').catch(() => null)
      if (!mod || cancelled) return
      // ⚠️ 不要 `return mod.App`——plugin proxy 把任何屬性存取都當成原生方法呼叫，
      // resolve 時摸 `.then` 會變成呼叫原生的 `App.then()` 而永遠卡住（見 CLAUDE.md §5）。
      const { App } = mod
      const handle = await App.addListener('backButton', () => {
        // 沒東西可關才真的離開；直接 exitApp 會讓每一層 sheet 都變成單向陷阱。
        if (handleBack()) return
        void App.exitApp()
      }).catch(() => null)
      if (cancelled) {
        void handle?.remove()
        return
      }
      remove = handle ? () => void handle.remove() : null
    })()

    return () => {
      cancelled = true
      remove?.()
    }
  }, [])

  // ── 瀏覽器：拿 history 當堆疊的影子 ──────────────────
  useEffect(() => {
    const onPop = (): void => {
      // 消化掉了就停在這裡；下面那個 effect 會把 history 長度補回來。
      if (handleBack()) return
      // 沒東西可關：讓它真的返回（網頁版回上一頁）。
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
