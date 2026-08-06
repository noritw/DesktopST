import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  RemoteControlState,
  RemoteDisplay,
  RemoteProgram,
  RemoteScreenshot,
  RemoteSystemAction,
  RemoteWindow
} from '@core/data'
import MonoIcon from '@shared/MonoIcon'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeRemoteError } from './remoteErrors'
import { ScreenshotStage } from './ScreenshotStage'

/**
 * 遙控電腦（清單 H1–H11，B6）。
 *
 * ⚠️ 這支只做「UI 與 `RemoteControlApi` 接線」——實際的截圖、點擊、程式清單、
 * 系統動作全部是既有 `mobileServer.ts` ／ `modules/remote-control/` 端點，
 * 邏輯一行都沒有在這裡重寫。
 *
 * 能力顯示／隱藏一律讀 `RemoteControlState`（桌面設定面板已經設好的白名單），
 * 手機不重做管理介面：截圖（H1/H2/H4/H5）永遠可用，點擊／鍵盤／程式／系統動作
 * 依 `allowedCapabilities` 個別顯示，模組整個關掉或裝置不在白名單時全部隱藏。
 */

type CaptureTarget = { kind: 'display'; index: number } | { kind: 'window'; hwnd: number; title: string; displayIndex: number }

const HOTKEYS: { label: string; keys: string }[] = [
  { label: 'Enter', keys: 'Enter' },
  { label: 'Esc', keys: 'Escape' },
  { label: 'Tab', keys: 'Tab' },
  { label: 'Ctrl+C', keys: 'ctrl+c' },
  { label: 'Ctrl+V', keys: 'ctrl+v' },
  { label: 'Ctrl+Z', keys: 'ctrl+z' },
  { label: 'Alt+Tab', keys: 'alt+tab' },
  { label: 'Ctrl+Alt+Del', keys: 'ctrl+alt+delete' }
]

const SYSTEM_ACTIONS: { action: RemoteSystemAction; label: string; hint: string; destructive: boolean; capability: 'monitor' | 'system' }[] = [
  { action: 'monitor-off', label: '關閉螢幕', hint: '移動滑鼠或觸控可喚醒', destructive: false, capability: 'monitor' },
  { action: 'wake', label: '喚醒螢幕', hint: '', destructive: false, capability: 'monitor' },
  { action: 'shutdown', label: '關機', hint: '電腦會立刻關閉電源', destructive: true, capability: 'system' },
  { action: 'restart', label: '重新開機', hint: '電腦會立刻重新啟動', destructive: true, capability: 'system' }
]

export function RemoteControlView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)

  const [rcState, setRcState] = useState<RemoteControlState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [displays, setDisplays] = useState<RemoteDisplay[] | null>(null)
  const [target, setTarget] = useState<CaptureTarget>({ kind: 'display', index: 0 })
  const [withChars, setWithChars] = useState(false)
  const [shot, setShot] = useState<RemoteScreenshot | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [remoteMode, setRemoteMode] = useState(false)
  const [rightClickMode, setRightClickMode] = useState(false)
  const [locked, setLocked] = useState(false)
  const [picker, setPicker] = useState<null | 'displays' | 'windows' | 'programs' | 'system'>(null)
  const [windows, setWindows] = useState<RemoteWindow[] | null>(null)
  const [programs, setPrograms] = useState<RemoteProgram[] | null>(null)
  const [typeText, setTypeText] = useState('')
  const [pressEnter, setPressEnter] = useState(false)

  const shotUrlRef = useRef<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const capabilities = rcState?.allowedCapabilities ?? []
  const deviceAllowed = rcState?.currentDeviceAllowed !== false
  const controlEnabled = !!rcState?.enabled && deviceAllowed
  const canPointer = controlEnabled && capabilities.includes('remote.pointer.click')
  const canKeyboard = controlEnabled && (capabilities.includes('remote.keyboard.type') || capabilities.includes('remote.keyboard.hotkey'))
  const canPrograms = controlEnabled && (capabilities.includes('remote.program.launch') || capabilities.includes('remote.program.close'))
  const canMonitor = controlEnabled && capabilities.includes('remote.monitor.power')
  const canSystem = controlEnabled && (capabilities.includes('remote.system.shutdown') || capabilities.includes('remote.system.restart'))

  useEffect(() => {
    void (async () => {
      try {
        const [state, list] = await Promise.all([getData().remoteControl.getState(), getData().remoteControl.listDisplays()])
        setRcState(state)
        setDisplays(list)
      } catch {
        setLoadFailed(true)
      }
    })()
  }, [])

  useEffect(() => {
    return () => {
      if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
    }
  }, [])

  const setShotAndRevokeOld = useCallback((next: RemoteScreenshot | null) => {
    if (shotUrlRef.current) URL.revokeObjectURL(shotUrlRef.current)
    shotUrlRef.current = next?.url ?? null
    setShot(next)
  }, [])

  const capture = useCallback(async (): Promise<void> => {
    setCapturing(true)
    try {
      const next =
        target.kind === 'display'
          ? await getData().remoteControl.captureDisplay(target.index, withChars)
          : await getData().remoteControl.captureWindow({ hwnd: target.hwnd, title: target.title })
      setShotAndRevokeOld(next)
      void getData()
        .remoteControl.isLocked()
        .then(setLocked)
        .catch(() => {})
    } catch (e) {
      toast(describeRemoteError(e, '截圖'), 'error')
    } finally {
      setCapturing(false)
    }
  }, [target, withChars, setShotAndRevokeOld, toast])

  useEffect(() => {
    void capture()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, withChars])

  const scheduleRefresh = useCallback(
    (delay: number) => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => void capture(), delay)
    },
    [capture]
  )

  const toggleRemoteMode = async (): Promise<void> => {
    if (!remoteMode && !canPointer) {
      toast('鍵鼠遙控未啟用', 'error')
      return
    }
    const next = !remoteMode
    setRemoteMode(next)
    try {
      if (next) {
        if (!withChars) await getData().remoteControl.hideWindows()
      } else {
        setRightClickMode(false)
        await getData().remoteControl.restoreWindows()
      }
    } catch {
      /* 隱藏／恢復視窗失敗不影響遙控本身，安靜跳過 */
    }
  }

  /** 需要確認時才問一次；action 已經送出去了才回傳結果。 */
  const confirmIfNeeded = async (capability: string, title: string): Promise<boolean> => {
    if (!rcState?.requireConfirmation.includes(capability as never)) return true
    return confirm({ title, message: '這個操作需要先確認才會送出。', confirmLabel: '確定' })
  }

  const doTap = async (x: number, y: number, double: boolean): Promise<void> => {
    const confirmed = await confirmIfNeeded('remote.pointer.click', rightClickMode ? '右鍵點擊' : double ? '雙擊' : '點擊')
    if (!confirmed) return
    try {
      await getData().remoteControl.click(x, y, { button: rightClickMode ? 'right' : 'left', double: double && !rightClickMode, confirmed: true })
      toast(`${rightClickMode ? '右鍵' : double ? '雙擊' : '點擊'} (${x}, ${y})`)
      scheduleRefresh(500)
    } catch (e) {
      toast(describeRemoteError(e, '點擊'), 'error')
    }
  }

  const doScroll = async (x: number, y: number, deltaX: number, deltaY: number): Promise<void> => {
    try {
      await getData().remoteControl.scroll(x, y, deltaX, deltaY)
      scheduleRefresh(400)
    } catch {
      /* 滾動失敗不用逐次跳 toast，太吵 */
    }
  }

  const sendType = async (): Promise<void> => {
    const text = typeText.trim()
    if (!text) return
    const confirmed = await confirmIfNeeded('remote.keyboard.type', '輸入文字')
    if (!confirmed) return
    setTypeText('')
    try {
      await getData().remoteControl.typeText(text, { pressEnter, confirmed: true })
      scheduleRefresh(600)
    } catch (e) {
      toast(describeRemoteError(e, '輸入'), 'error')
    }
  }

  const sendKey = async (keys: string): Promise<void> => {
    const confirmed = await confirmIfNeeded('remote.keyboard.hotkey', `送出 ${keys}`)
    if (!confirmed) return
    try {
      await getData().remoteControl.sendKey(keys, true)
      toast(keys)
      scheduleRefresh(500)
    } catch (e) {
      toast(describeRemoteError(e, '送出快捷鍵'), 'error')
    }
  }

  const openPrograms = async (): Promise<void> => {
    setPicker('programs')
    if (programs) return
    try {
      setPrograms(await getData().remoteControl.listPrograms())
    } catch (e) {
      toast(describeRemoteError(e, '讀取程式清單'), 'error')
      setPicker(null)
    }
  }

  const runProgram = async (p: RemoteProgram): Promise<void> => {
    const action = p.running ? 'close' : 'launch'
    const capability = action === 'launch' ? 'remote.program.launch' : 'remote.program.close'
    const confirmed = await confirmIfNeeded(capability, `${action === 'launch' ? '開啟' : '關閉'}「${p.name}」`)
    if (!confirmed) return
    try {
      const result = action === 'launch'
        ? await getData().remoteControl.launchProgram(p.id, true)
        : await getData().remoteControl.closeProgram(p.id, true)
      if (!result.ok) { toast(`操作失敗：${result.error ?? '未知原因'}`, 'error'); return }
      toast(`已${action === 'launch' ? '開啟' : '關閉'}「${p.name}」`)
      setPrograms(await getData().remoteControl.listPrograms())
    } catch (e) {
      toast(describeRemoteError(e, '操作程式'), 'error')
    }
  }

  const openWindows = async (): Promise<void> => {
    setPicker('windows')
    try {
      setWindows(await getData().remoteControl.listWindows())
    } catch (e) {
      toast(describeRemoteError(e, '讀取視窗清單'), 'error')
      setPicker(null)
    }
  }

  const runSystemAction = async (action: RemoteSystemAction, label: string, destructive: boolean): Promise<void> => {
    const ok = await confirm({
      title: label,
      message: destructive ? `確定要${label}嗎？這會立刻執行，不能取消。` : `確定要${label}嗎？`,
      confirmLabel: label,
      destructive
    })
    if (!ok) return
    try {
      const result = await getData().remoteControl.systemAction(action, true)
      if (!result.ok) { toast(`操作失敗：${result.error ?? '未知原因'}`, 'error'); return }
      toast(`已送出「${label}」`)
      setPicker(null)
      if (action === 'wake' || action === 'monitor-off') {
        setTimeout(() => {
          void getData().remoteControl.isLocked().then(setLocked).catch(() => {})
        }, 1500)
      }
    } catch (e) {
      toast(describeRemoteError(e, label), 'error')
    }
  }

  if (loadFailed) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-[var(--text-sub)]">讀取遙控狀態失敗</p>
      </div>
    )
  }

  if (!rcState || !displays) {
    return <div className="py-10 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>
  }

  return (
    <div className="relative flex h-[70vh] flex-col gap-2">
      {!deviceAllowed && (
        <div className="rounded-[12px] bg-[var(--danger)] px-3 py-2 text-xs text-[var(--danger-text)]">
          這台裝置不在電腦端的遙控允許清單裡，鍵鼠與系統動作功能無法使用。
        </div>
      )}
      {locked && (
        <div className="flex items-center gap-2 rounded-[12px] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-sub)]">
          <MonoIcon name="lock" className="h-4 w-4 shrink-0" />
          電腦目前在鎖定畫面。
          {canMonitor && (
            <button type="button" onClick={() => void runSystemAction('wake', '喚醒螢幕', false)} className="ml-auto shrink-0 rounded-full bg-[var(--mint)] px-3 py-1 text-[var(--text)]">
              喚醒
            </button>
          )}
        </div>
      )}

      {/* 工具列：截圖來源與選項 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton icon="monitor" label={target.kind === 'display' ? (displays[target.index]?.label ?? '螢幕') : target.title} onClick={() => setPicker('displays')} />
        <ToolButton icon="folder" label="切換視窗" onClick={() => void openWindows()} />
        <ToolButton icon="refresh" label="重新整理" onClick={() => void capture()} busy={capturing} />
        <label className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text)]">
          <input type="checkbox" checked={withChars} onChange={(e) => setWithChars(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--mint2)]" />
          含角色
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[16px] border border-[var(--border)]">
        <ScreenshotStage shot={shot} remoteMode={remoteMode} rightClickMode={rightClickMode} onTap={(x, y, d) => void doTap(x, y, d)} onScroll={(x, y, dx, dy) => void doScroll(x, y, dx, dy)} />
      </div>

      {/* 遙控模式切換列 */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => void toggleRemoteMode()}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-sm ${remoteMode ? 'bg-[var(--danger)] text-[var(--danger-text)]' : 'bg-[var(--mint)] text-[var(--text)]'}`}
        >
          <MonoIcon name="cursor" className="h-4 w-4" />
          {remoteMode ? '停止遙控' : '開始遙控'}
        </button>
        {remoteMode && (
          <button
            type="button"
            onClick={() => setRightClickMode((v) => !v)}
            className={`shrink-0 rounded-full px-3 py-2 text-sm ${rightClickMode ? 'bg-[var(--peach)] text-[var(--text)]' : 'border border-[var(--border)] text-[var(--text)]'}`}
          >
            {rightClickMode ? '右鍵' : '左鍵'}
          </button>
        )}
        {canPrograms && (
          <ToolButton icon="folder" label="程式" onClick={() => void openPrograms()} />
        )}
        {(canMonitor || canSystem) && <ToolButton icon="power" label="系統" onClick={() => setPicker('system')} />}
      </div>

      {/* 文字輸入與快捷鍵（H8、H9）：遙控中且有鍵盤能力才顯示 */}
      {remoteMode && canKeyboard && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={typeText}
              onChange={(e) => setTypeText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendType() } }}
              placeholder="輸入文字送到電腦上⋯⋯"
              className="min-w-0 flex-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
            />
            <button type="button" onClick={() => void sendType()} className="shrink-0 rounded-full bg-[var(--mint)] p-2 text-[var(--text)]">
              <MonoIcon name="send" className="h-4 w-4" />
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-sub)]">
            <input type="checkbox" checked={pressEnter} onChange={(e) => setPressEnter(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--mint2)]" />
            送出後按 Enter
          </label>
          <div className="flex flex-wrap gap-1.5">
            {HOTKEYS.map((h) => (
              <button key={h.keys} type="button" onClick={() => void sendKey(h.keys)} className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text)]">
                {h.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 螢幕／視窗／程式／系統動作：小型內嵌選單，疊在畫面上 ── */}
      {picker && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/30" onClick={(e) => { if (e.target === e.currentTarget) setPicker(null) }}>
          <div className="max-h-[70%] overflow-y-auto rounded-t-[20px] bg-[var(--surface)] p-4" style={{ paddingBottom: 'var(--safe-bottom)' }}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--text)]">
                {picker === 'displays' ? '選擇觀看螢幕' : picker === 'windows' ? '切換視窗' : picker === 'programs' ? '程式' : '系統動作'}
              </h3>
              <button type="button" onClick={() => setPicker(null)} aria-label="關閉" className="rounded-full p-1 text-[var(--text-sub)]">
                <MonoIcon name="close" className="h-4 w-4" />
              </button>
            </div>

            {picker === 'displays' && (
              <div className="space-y-1.5">
                {displays.map((d) => (
                  <PickerRow key={d.index} label={d.label} selected={target.kind === 'display' && target.index === d.index} onClick={() => { setTarget({ kind: 'display', index: d.index }); setPicker(null) }} />
                ))}
              </div>
            )}

            {picker === 'windows' && (
              <div className="space-y-1.5">
                {!windows ? (
                  <p className="py-4 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</p>
                ) : windows.length === 0 ? (
                  <p className="py-4 text-center text-sm text-[var(--text-sub)]">找不到開啟中的視窗</p>
                ) : (
                  windows.map((w) => (
                    <PickerRow
                      key={w.hwnd}
                      label={w.title}
                      hint={`${w.proc}${w.minimized ? ' · 已最小化' : ''}`}
                      selected={target.kind === 'window' && target.hwnd === w.hwnd}
                      onClick={() => { setTarget({ kind: 'window', hwnd: w.hwnd, title: w.title, displayIndex: w.displayIndex }); setPicker(null) }}
                    />
                  ))
                )}
              </div>
            )}

            {picker === 'programs' && (
              <div className="space-y-1.5">
                {!programs ? (
                  <p className="py-4 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</p>
                ) : programs.length === 0 ? (
                  <p className="py-4 text-center text-sm text-[var(--text-sub)]">電腦端還沒有設定任何程式，請到桌面版設定面板新增。</p>
                ) : (
                  programs.map((p) => (
                    <button key={p.id} type="button" onClick={() => void runProgram(p)} className="flex w-full items-center gap-2 rounded-[12px] border border-[var(--border)] px-3 py-2 text-left">
                      {p.iconDataUrl ? <img src={p.iconDataUrl} className="h-6 w-6 shrink-0 rounded" /> : <MonoIcon name="folder" className="h-5 w-5 shrink-0 text-[var(--text-sub)]" />}
                      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">{p.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${p.running ? 'bg-[var(--danger)] text-[var(--danger-text)]' : 'bg-[var(--mint)] text-[var(--text)]'}`}>
                        {p.running ? '關閉' : '開啟'}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            {picker === 'system' && (
              <div className="space-y-1.5">
                {SYSTEM_ACTIONS.filter((a) => (a.capability === 'monitor' ? canMonitor : canSystem)).map((a) => (
                  <button key={a.action} type="button" onClick={() => void runSystemAction(a.action, a.label, a.destructive)} className="flex w-full items-center justify-between rounded-[12px] border border-[var(--border)] px-3 py-2.5 text-left">
                    <span className="text-sm text-[var(--text)]">{a.label}</span>
                    {a.hint && <span className="text-[11px] text-[var(--text-sub)]">{a.hint}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ToolButton({ icon, label, onClick, busy }: { icon: Parameters<typeof MonoIcon>[0]['name']; label: string; onClick: () => void; busy?: boolean }): JSX.Element {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="flex items-center gap-1 rounded-full border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text)] disabled:opacity-50">
      <MonoIcon name={icon} className="h-3.5 w-3.5" />
      <span className="max-w-[8rem] truncate">{label}</span>
    </button>
  )
}

function PickerRow({ label, hint, selected, onClick }: { label: string; hint?: string; selected: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-[12px] border px-3 py-2.5 text-left ${selected ? 'border-[var(--mint2)] bg-[var(--mint)]/40' : 'border-[var(--border)]'}`}>
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate text-sm text-[var(--text)]">{label}</span>
        {hint && <span className="block truncate text-[11px] text-[var(--text-sub)]">{hint}</span>}
      </span>
      {selected && <MonoIcon name="check" className="ml-2 h-4 w-4 shrink-0 text-[var(--text)]" />}
    </button>
  )
}
