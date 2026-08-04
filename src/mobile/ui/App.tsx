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
import { resolveConnection, wsUrlFor } from './connection'
import { RemoteDataSource } from '../data/remoteDataSource'
import { getDeviceIdentity } from '../data/deviceIdentity'
import { RemoteEventSource } from '../events/remoteEventSource'

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
    const data = new RemoteDataSource({
      baseUrl: () => conn.baseUrl,
      token: () => conn.token,
      // 少了這個，電腦端會把訊息當成「Desktop」送來的，角色會以為你在電腦前打字。
      device: () => getDeviceIdentity()
    })
    const events = new RemoteEventSource({
      wsUrl: () => wsUrlFor(conn),
      // relay 情境下連續失敗要回頁面重新取得 tunnel URL；開發時沒有這回事。
      onNeedsReload: conn.baseUrl === location.origin ? () => location.reload() : undefined
    })
    return attach({ data, events })
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
      <header
        ref={headerRef}
        className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--mint)] px-4 pb-2"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        <span className="text-[17px] font-semibold text-[var(--text)]">DeST</span>
        <div className="flex items-center gap-1">
          <HeaderButton onClick={() => push('conversations')}>💬</HeaderButton>
          <HeaderButton onClick={() => push('news')}>📰</HeaderButton>
          <HeaderButton onClick={() => push('theme-picker')}>🎨</HeaderButton>
        </div>
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

function HeaderButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full text-lg active:bg-[var(--surface)]/60"
    >
      {children}
    </button>
  )
}

function LoadFailed({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-3xl">🔌</div>
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
