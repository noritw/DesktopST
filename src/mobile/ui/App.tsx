import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { applyTheme } from './theme'
import { useUiStore } from './stores/uiStore'
import { useAppStore, describeError, notifyForeground } from './stores/appStore'
import { useBackButton } from './shell/useBackButton'
import { ViewStack } from './shell/ViewStack'
import { ToastHost } from './shell/ToastHost'
import { DialogHost } from './shell/DialogHost'
import { Lightbox } from './shell/Lightbox'
import { AvatarCropView } from './characters/AvatarCropView'
import { NameConflictPicker } from './shell/NameConflictPicker'
import { SyncComparePicker } from './shell/SyncComparePicker'
import { MessageList } from './chat/MessageList'
import { Composer } from './chat/Composer'
import { AvatarBar } from './characters/AvatarBar'
import MonoIcon from '@shared/MonoIcon'
import { PROBE_TIMEOUT_MS, modeBadgeLabel, probeRemote, wsUrlFor } from './connection'
import { useConnectionStore } from './stores/connectionStore'
import { RemoteDataSource } from '../data/remoteDataSource'
import { LocalDataSource } from '../data/localDataSource'
import { getDeviceIdentity } from '../data/deviceIdentity'
import { RemoteEventSource } from '../events/remoteEventSource'
import { HeaderChips } from './context/HeaderChips'
import { countdownLabel, useCountdown } from './shell/useCountdown'
import { isReconnected, nextOfflineSince } from './shell/offlineWatch'
import { initCapacitorSecrets, capacitorAdapters } from '../adapters'
import { bootStandaloneSession } from '../runtime/session'
import { getStandaloneSession, setStandaloneSession } from '../runtime/sessionHolder'

/**
 * 手機 UI 的根元件。
 *
 * 這裡是**唯一**知道「現在接的是哪種資料來源」的地方 ——
 * 底下所有元件都只透過 `useAppStore` 拿資料（階段 0-③ 的整個重點）。
 */
/**
 * 斷線多久才跳視窗問使用者。鎖屏／切背景／換 Wi-Fi 頻段造成的短暫斷線
 * 會自己接回來，一斷就問會在正常使用中打斷好幾次。
 */
const DISCONNECT_ASK_DELAY_MS = 8000

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
  /**
   * 這次開 App 有沒有問過「連不上電腦，要改用本機嗎」。
   *
   * 用 ref 而不是 state：問過就不再問，這件事不需要重繪畫面，
   * 而且 state 會讓 attach effect 因為相依變動而重跑一次。
   */
  const askedOfflineRef = useRef(false)
  const [lanDirect, setLanDirect] = useState<boolean | null>(null)
  /** 開機時正在探測電腦在不在（給倒數用，見 `useCountdown` 的說明）。 */
  const [probing, setProbing] = useState(false)
  const probeSecondsLeft = useCountdown(PROBE_TIMEOUT_MS, probing)
  /** 連線中斷是從什麼時候開始的（`null` ＝ 現在是通的）。 */
  const [offlineSince, setOfflineSince] = useState<number | null>(null)
  /** 這一次斷線有沒有問過使用者。重連成功就歸零，下次斷線要再問。 */
  const askedDisconnectRef = useRef(false)
  /**
   * 已經斷線一段時間了（不是閃一下就好的那種）。
   * 左上角模式標籤會轉成警告色 —— 那顆在主畫面上一直看得到，
   * 比只有一條橫幅更難忽略（owner 2026-08-13 提議）。
   */
  const [sustainedOffline, setSustainedOffline] = useState(false)

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

  const conn = useConnectionStore((s) => s.conn)
  const initConn = useConnectionStore((s) => s.init)
  const modeText = conn ? modeBadgeLabel(conn, lanDirect) : ''

  // 只解析一次：切換模式之後改的是 store 裡的 conn，不會再走這裡。
  useEffect(() => {
    void initConn()
  }, [initConn])

  useEffect(() => {
    if (!conn) return
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

      /*
       * 開機時先探一下電腦在不在（`probeRemote` 自帶逾時，理由見它的註解）。
       *
       * 沒有這一步的話，電腦關機時舊的 `detectLanDirect()` 會卡在沒有逾時的
       * fetch 上，下面的 `attach()` 永遠不會被呼叫 —— `ready` 一直是 false、
       * `loadError` 也一直是 null，畫面就停在「載入中⋯⋯」，連既有的
       * `LoadFailed` 重試畫面都出不來（owner 2026-08-13 回報「上次停在遙控版、
       * 電腦關掉之後，開 App 卡在那邊沒東西」）。
       */
      setProbing(true)
      let probe
      try {
        probe = await probeRemote(conn)
      } finally {
        setProbing(false)
      }
      if (cancelled) return

      /*
       * 連不上就問使用者要不要改用本機 —— **不自動切**。
       * 自動切過去會讓「電腦只是還沒開機」的人莫名其妙進了另一個資料庫，
       * 而兩邊的對話是分開的，看起來就像資料不見了。設計文件 §4.3 只寫了
       * 「切到獨立永遠是安全的」，那是指使用者主動切換；開機這條路徑要問過。
       *
       * 只問一次（`askedOfflineRef`）：之後的斷線由 `RemoteEventSource` 自己
       * 退避重連，每次重連失敗都彈一次視窗會沒完沒了。
       */
      if (!probe.alive && Capacitor.isNativePlatform() && !askedOfflineRef.current) {
        askedOfflineRef.current = true
        const goLocal = await useUiStore.getState().confirm({
          title: '連不上電腦',
          message:
            '找不到上次連線的那台電腦（可能已關機、或不在同一個 Wi-Fi）。\n\n' +
            '要先改用手機獨立版嗎？獨立版用的是手機自己的角色與對話，' +
            '之後隨時能在「關於」頁切回遙控。',
          confirmLabel: '改用手機獨立版'
        })
        if (cancelled) return
        if (goLocal) {
          // 切過去之後這個 effect 會帶著 standalone 的 conn 重跑，這裡直接收工。
          await useConnectionStore.getState().switchTo({ mode: 'standalone', baseUrl: '', token: '' })
          return
        }
        // 選「繼續嘗試連線」：照常掛上去，由 RemoteEventSource 自己重連，
        // 畫面會顯示既有的離線橫幅與重試按鈕。
      }

      setLanDirect(probe.lanDirect)

      const data = new RemoteDataSource({
        baseUrl: () => conn.baseUrl,
        token: () => conn.token,
        device: () => getDeviceIdentity(),
        lanDirect: probe.lanDirect
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

  /**
   * 用到一半斷線（電腦關機／離開 Wi-Fi）。
   *
   * owner 2026-08-13 回報「遙控版用到一半我把電腦的 DeST 關掉，沒有出現任何訊息」——
   * 原本只有一條很細的紅色橫幅，正在讀訊息的人不會注意到，而且橫幅被任何開著的
   * Sheet 蓋住就完全看不到。改成主動跳對話框問，並把橫幅本身加上可以直接按的
   * 「改用本機」。
   */
  useEffect(() => {
    /*
     * ⚠️ 規則全部在 `nextOfflineSince` 裡，**不要在這裡自己判斷 status 或模式**。
     * 兩個踩過的坑都是因為在這裡自作聰明：
     * ① 把「非 offline」當成恢復連線 → 重連嘗試不斷歸零計時，門檻永遠數不完
     * ② 本機模式直接 early return → 從遙控切過去時斷線提示留在畫面上不會消失
     */
    const isRemote = conn?.mode === 'remote'
    setOfflineSince((prev) => nextOfflineSince(status, prev, Date.now(), isRemote))
    if (!isRemote || isReconnected(status)) askedDisconnectRef.current = false
  }, [status, conn?.mode])

  useEffect(() => {
    if (offlineSince === null) {
      setSustainedOffline(false)
      return
    }
    const t = setTimeout(() => setSustainedOffline(true), DISCONNECT_ASK_DELAY_MS)
    return () => clearTimeout(t)
  }, [offlineSince])

  const switchToStandalone = useCallback(async (): Promise<void> => {
    askedDisconnectRef.current = true
    await useConnectionStore.getState().switchTo({ mode: 'standalone', baseUrl: '', token: '' })
    useUiStore.getState().toast('已切換到本機模式')
  }, [])

  useEffect(() => {
    if (offlineSince === null || askedDisconnectRef.current) return
    if (!Capacitor.isNativePlatform()) return

    /*
     * 等一下再問：手機鎖屏、切背景、Wi-Fi 換頻段都會造成幾秒的斷線，
     * 那些會自己接回來。一斷就跳視窗的話，正常使用中會被打斷好幾次。
     */
    const timer = setTimeout(() => {
      if (askedDisconnectRef.current) return
      /*
       * 已經有別的對話框開著就不搶——`uiStore.dialog` 只有一個位子，
       * 蓋過去會把使用者正在看的東西弄掉。這時仍有橫幅上的按鈕可用。
       */
      if (useUiStore.getState().dialog) return
      askedDisconnectRef.current = true
      void (async () => {
        const goLocal = await useUiStore.getState().confirm({
          title: '與電腦的連線中斷',
          message:
            '可能是電腦關機、DeST 被關掉，或手機離開了同一個 Wi-Fi。\n\n' +
            '要改用手機獨立版嗎？獨立版用的是手機自己的角色與對話，' +
            '之後隨時能在「關於」頁切回遙控。\n\n' +
            // 取消鈕的字是 DialogHost 固定的「取消」，這裡明講按了會怎樣，
            // 免得使用者以為「取消」＝取消切換＝什麼都不會發生。
            '按「取消」會繼續嘗試重新連線，畫面上方會保留中斷提示。',
          confirmLabel: '改用手機獨立版'
        })
        if (goLocal) await switchToStandalone()
      })()
    }, DISCONNECT_ASK_DELAY_MS)

    return () => clearTimeout(timer)
  }, [offlineSince, switchToStandalone])

  useEffect(() => {
    const onVisible = (): void => {
      const session = getStandaloneSession()
      if (document.visibilityState === 'visible') {
        // `notifyForeground()` 一定要在這裡呼叫（`EventSource` 介面本來就是這樣
        // 設計的，見 `core/events/types.ts`）：漏了這行，切背景時被系統斷線的
        // WebSocket 只能乾等一般的退避重連，回前景那一刻本來可以立刻重連／
        // 立刻對帳卻沒有觸發（owner 2026-08-15 實測踩到：本地模型回應慢時
        // 切出去，回來只看到一則「網路錯誤」，答案要再等好一下子才自己冒出來）。
        notifyForeground()
        void useAppStore.getState().refresh()
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
          aria-label={`目前模式：${modeText}${sustainedOffline && conn?.mode === 'remote' ? "，連線中斷" : ""}，開啟關於`}
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold active:opacity-80 ${
            sustainedOffline && conn?.mode === 'remote'
              ? 'border-[var(--danger)] bg-[var(--danger)] text-[var(--danger-text)]'
              : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text)]'
          }`}
        >
          {sustainedOffline && conn?.mode === 'remote' ? `${modeText}·斷線` : modeText}
        </button>
        {ready ? <HeaderChips /> : <span className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text)]">DeST</span>}
        <button
          type="button"
          onClick={() => ready && push('menu')}
          disabled={!ready}
          aria-label="選單"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text)] active:bg-[var(--surface)]/60 disabled:opacity-40"
        >
          <MonoIcon name="menu" className="h-5 w-5" />
        </button>
      </header>

      {/*
        ⚠️ 看的是 `offlineSince` 而不是 `status === 'offline'`。
        重連退避期間狀態多數時間是 `'connecting'`，用 status 判斷的話橫幅會
        一閃一閃甚至幾乎看不到——owner 2026-08-13 回報「沒有斷線提示，
        點進去顯示連線中」正是這個。`offlineSince` 在真的連上之前不會歸零。
      */}
      {offlineSince !== null && conn?.mode === 'remote' && (
        <div className="flex items-center gap-2 bg-[var(--danger)] px-4 py-2 text-xs text-[var(--danger-text)]">
          <MonoIcon name="plug" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 font-medium">連不上電腦，正在重試⋯⋯</span>
          {Capacitor.isNativePlatform() && conn?.mode === 'remote' && (
            <button
              type="button"
              onClick={() => void switchToStandalone()}
              className="shrink-0 rounded-full border border-current px-2.5 py-1 font-medium"
            >
              改用本機
            </button>
          )}
        </div>
      )}

      {!ready && loadError ? (
        <LoadFailed message={describeError(loadError, 'load')} onRetry={() => void refresh()} />
      ) : !ready ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-sub)]">
          {probing ? countdownLabel('正在連電腦', probeSecondsLeft) : '載入中⋯⋯'}
        </div>
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
      <AvatarCropView />
      <NameConflictPicker />
      <SyncComparePicker />
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
