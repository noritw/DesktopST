import { useEffect, useMemo, useRef } from 'react'
import { applyTheme } from './theme'
import { useUiStore } from './stores/uiStore'
import { useAppStore, describeError } from './stores/appStore'
import { useBackButton } from './shell/useBackButton'
import { ViewStack } from './shell/ViewStack'
import { ToastHost } from './shell/ToastHost'
import { DialogHost } from './shell/DialogHost'
import { Lightbox } from './shell/Lightbox'
import { MessageList } from './chat/MessageList'
import { Composer } from './chat/Composer'
import { AvatarBar } from './characters/AvatarBar'
import MonoIcon from '@shared/MonoIcon'
import { detectLanDirect, resolveConnection, wsUrlFor } from './connection'
import { RemoteDataSource } from '../data/remoteDataSource'
import { getDeviceIdentity } from '../data/deviceIdentity'
import { RemoteEventSource } from '../events/remoteEventSource'
import { HeaderChips } from './context/HeaderChips'

/**
 * 手機 UI 的根元件。
 *
 * 這裡是**唯一**知道「現在接的是哪種資料來源」的地方 ——
 * 底下所有元件都只透過 `useAppStore` 拿資料（階段 0-③ 的整個重點）。
 */
export function App(): JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const push = useUiStore((s) => s.push)
  const attach = useAppStore((s) => s.attach)
  const ready = useAppStore((s) => s.ready)
  const status = useAppStore((s) => s.status)
  const loadError = useAppStore((s) => s.loadError)
  const remoteTheme = useAppStore((s) => s.snapshot?.colorTheme)
  const refresh = useAppStore((s) => s.refresh)
  const headerRef = useRef<HTMLElement>(null)

  useBackButton()

  useEffect(() => {
    applyTheme(theme, document.documentElement, document)
  }, [theme])

  /**
   * 跟著電腦端的主題走（`settings.ui.colorTheme`）。
   *
   * 這也是為什麼手機不需要自己存一份：真相在電腦那邊，每次載入與每次
   * `state-invalidated` 重抓都會帶回來 —— 包含在電腦上改的、或情境切換
   * 連帶改的（`ScenePreset.colorTheme`）。
   */
  useEffect(() => {
    if (remoteTheme) useUiStore.getState().setTheme(remoteTheme)
  }, [remoteTheme])

  // header 高度給 toast 定位用（見 ToastHost）。不寫死：會隨安全區域與內容變動。
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const sync = (): void => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const conn = useMemo(() => resolveConnection(), [])

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | null = null

    void (async () => {
      // `Capabilities.apiKeyAccess` 要在建構 `RemoteDataSource` 之前就知道
      // （capabilities 是唯讀的同步欄位，見 `core/data/types.ts`），所以先問一次
      // 這支輕量端點。查不到就保守當非區網直連 —— 不確定就不給 API Key 存取。
      const lanDirect = await detectLanDirect(conn)
      if (cancelled) return

      const data = new RemoteDataSource({
        baseUrl: () => conn.baseUrl,
        token: () => conn.token,
        // 少了這個，電腦端會把訊息當成「Desktop」送來的，角色會以為你在電腦前打字。
        device: () => getDeviceIdentity(),
        lanDirect
      })
      const events = new RemoteEventSource({
        wsUrl: () => wsUrlFor(conn),
        // relay 情境下連續失敗要回頁面重新取得 tunnel URL；開發時沒有這回事。
        onNeedsReload: conn.baseUrl === location.origin ? () => location.reload() : undefined
      })
      detach = attach({ data, events })
    })()

    return () => {
      cancelled = true
      detach?.()
    }
  }, [conn, attach])

  // 回前景時對帳（遙控模式才有作用，獨立模式是 no-op）。
  // 由 UI 呼叫而非實作自己監聽 document —— core 不碰 DOM。
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') useAppStore.getState().refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      {/*
        Header 一列做完三件事（owner 2026-08-06 設計）：顯示目前狀態、當作切換入口、
        收納所有功能。原本是「DeST 字樣 ＋ 六顆 emoji 按鈕」，狀態列另外掛在下面一整條——
        現在狀態標籤自己就是入口，功能全收進 ☰，省下一整條的高度。
        `DeST` 字樣拿掉是刻意的：手機螢幕窄，標籤要那個寬度，而 app 名稱在這裡沒有資訊量。
      */}
      <header
        ref={headerRef}
        className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--mint)] px-3 pb-2"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        {ready ? <HeaderChips /> : <span className="flex-1 text-[13px] font-semibold text-[var(--text)]">DeST</span>}
        <button
          type="button"
          onClick={() => push('menu')}
          aria-label="選單"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text)] active:bg-[var(--surface)]/60"
        >
          <MonoIcon name="menu" className="h-5 w-5" />
        </button>
      </header>

      {/* 連線狀態列：獨立模式永遠是 online，所以這條自然不會出現，
          不需要寫 `if (獨立模式)`（階段 0-② 的設計）。 */}
      {status === 'offline' && (
        <div className="bg-[var(--danger)] px-4 py-1.5 text-center text-xs text-[var(--danger-text)]">
          連線中斷，正在重新連線⋯⋯
        </div>
      )}

      {!ready && loadError ? (
        <LoadFailed message={describeError(loadError, 'load')} onRetry={() => void refresh()} />
      ) : !ready ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>
      ) : (
        <>
          <AvatarBar />
          <MessageList />
        </>
      )}

      <Composer />

      <ViewStack />
      <DialogHost />
      <Lightbox />
      <ToastHost />
    </div>
  )
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <MonoIcon name="plug" className="h-8 w-8 text-[var(--text-sub)]" />
      <p className="text-sm leading-relaxed text-[var(--text-sub)]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
      >
        重試
      </button>
    </div>
  )
}
