import { useEffect, useMemo, useRef, useState } from 'react'
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
import { detectLanDirect, modeBadgeLabel, resolveConnection, wsUrlFor } from './connection'
import { RemoteDataSource } from '../data/remoteDataSource'
import { LocalDataSource } from '../data/localDataSource'
import { getDeviceIdentity } from '../data/deviceIdentity'
import { RemoteEventSource } from '../events/remoteEventSource'
import { HeaderChips } from './context/HeaderChips'
import { initCapacitorSecrets, capacitorAdapters } from '../adapters'
import { bootStandaloneSession } from '../runtime/session'
import { getStandaloneSession, setStandaloneSession } from '../runtime/sessionHolder'

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
  const snapshotTheme = useAppStore((s) => s.snapshot?.colorTheme)
  const refresh = useAppStore((s) => s.refresh)
  const headerRef = useRef<HTMLElement>(null)
  const [lanDirect, setLanDirect] = useState<boolean | null>(null)

  useBackButton()

  useEffect(() => {
    applyTheme(theme, document.documentElement, document)
  }, [theme])

  /**
   * 跟著 snapshot 的主題走（遙控＝電腦；獨立＝本機 settings）。
   */
  useEffect(() => {
    if (snapshotTheme) useUiStore.getState().setTheme(snapshotTheme)
  }, [snapshotTheme])

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
  const modeText = modeBadgeLabel(conn, lanDirect)

  useEffect(() => {
    let cancelled = false
    let detach: (() => void) | null = null

    void (async () => {
      if (conn.mode === 'standalone') {
        await initCapacitorSecrets()
        if (cancelled) return
        const session = await bootStandaloneSession(capacitorAdapters)
        if (cancelled) return
        // S1 匯入要直接對 session 動手（不經 DataSource，見 sessionHolder 檔頭）
        setStandaloneSession(session)
        setLanDirect(null)
        detach = attach({
          data: new LocalDataSource(session),
          events: session.events
        })
        return
      }

      const lan = await detectLanDirect(conn)
      if (cancelled) return
      setLanDirect(lan)

      const data = new RemoteDataSource({
        baseUrl: () => conn.baseUrl,
        token: () => conn.token,
        device: () => getDeviceIdentity(),
        lanDirect: lan
      })
      const events = new RemoteEventSource({
        wsUrl: () => wsUrlFor(conn),
        onNeedsReload: conn.baseUrl === location.origin ? () => location.reload() : undefined
      })
      detach = attach({ data, events })
    })()

    return () => {
      cancelled = true
      detach?.()
      setStandaloneSession(null)
    }
  }, [conn, attach])

  useEffect(() => {
    const onVisible = (): void => {
      const session = getStandaloneSession()
      if (document.visibilityState === 'visible') {
        useAppStore.getState().refresh()
        // 亮屏／回到前景：補發押後的提醒（inactiveBehavior: notify_on_unlock）
        session?.onAppResumed()
      } else {
        /*
         * 離開前景＝把接下來要響的提醒台詞先生一句起來當離線底線
         * （見 docs/mobile-standalone-reminder-plan.md §2.1）。
         *
         * ⚠️ 這裡是**唯一**能吃到「使用者剛剛那一輪互動」的時機。
         * 不要改成建立提醒時就生——那樣設完提醒之後的對話全都不會被算進去，
         * 正是 owner 2026-08-11 明確否決的做法。
         *
         * 從最近工作清單上滑劃掉之前，App 早就已經 pause 過了，
         * 所以這個時機也涵蓋「劃掉」的情況。
         */
        session?.onAppBackgrounded()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <header
        ref={headerRef}
        className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--mint)] px-3 pb-2"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        {/* 兩字小標籤；版號／建置／連線說明點進去「關於」再看。 */}
        <button
          type="button"
          onClick={() => push('about')}
          aria-label={`目前模式：${modeText}，開啟關於`}
          className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text)] active:bg-[var(--surface)]"
        >
          {modeText}
        </button>
        {ready ? <HeaderChips /> : <span className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text)]">DeST</span>}
        <button
          type="button"
          onClick={() => push('menu')}
          aria-label="選單"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text)] active:bg-[var(--surface)]/60"
        >
          <MonoIcon name="menu" className="h-5 w-5" />
        </button>
      </header>

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
