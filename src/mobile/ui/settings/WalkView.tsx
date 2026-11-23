import { useCallback, useEffect, useState } from 'react'
import { stepsToKm, type WalkSettings, type WalkState } from '@core/walk'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import { clearWalkData, loadWalkSettings, loadWalkState, localDay, saveWalkSettings } from '../../runtime/walk'
import { openWalkSettings, requestWalkAccess, walkAccess, type WalkAccess } from '../../runtime/walkBridge'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { ToggleRow } from './SettingsView'

/** 陪伴同行（`docs/walk-together-design.md`）。 */

const CARD = 'space-y-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3'
const BUTTON =
  'w-full rounded-full bg-[var(--mint)] px-4 py-2.5 text-[14px] font-medium text-[var(--text)] disabled:opacity-45'
const SUB = 'text-[12px] leading-relaxed text-[var(--text-sub)]'
const INPUT = 'w-24 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]'

const ACCESS_TEXT: Record<WalkAccess['state'], string> = {
  ok: '已授權讀取步數',
  unsupported: '這支手機無法計步（沒有 Health Connect）',
  needs_update: 'Health Connect 需要安裝或更新',
  no_permission: '尚未授權讀取步數',
  error: '查詢授權狀態失敗，稍後再試'
}

export function WalkView(): JSX.Element {
  const session = getStandaloneSession()
  const toast = useUiStore((s) => s.toast)
  const present = useAppStore((s) => s.snapshot?.presentCharacters) ?? []
  const [settings, setSettings] = useState<WalkSettings | null>(null)
  const [state, setState] = useState<WalkState | null>(null)
  const [access, setAccess] = useState<WalkAccess | null>(null)
  const [busy, setBusy] = useState(false)
  const [height, setHeight] = useState('')
  const [readError, setReadError] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!session) return
    const s = await loadWalkSettings(session.walkStorage)
    setSettings(s)
    setHeight(s.heightCm ? String(s.heightCm) : '')
    setAccess(await walkAccess())
    if (s.enabled) {
      try {
        await session.syncWalkNow()
        setReadError(false)
      } catch {
        setReadError(true)
      }
    }
    setState(await loadWalkState(session.walkStorage))
  }, [session])

  useEffect(() => {
    void reload().catch(() => setReadError(true))
  }, [reload])

  if (!session) return <p className={SUB}>這個功能只在本機模式可用。</p>
  if (!settings) return <p className={SUB}>讀取中…</p>

  const save = async (patch: Partial<WalkSettings>): Promise<void> => {
    const next = { ...settings, ...patch }
    setSettings(next)
    try {
      await saveWalkSettings(session.walkStorage, next)
      await session.refreshWalkWidget()
    } catch {
      toast('設定失敗', 'error')
    }
  }

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } catch {
      toast('操作失敗，稍後再試', 'error')
    } finally {
      setBusy(false)
    }
  }

  const askAccess = (): Promise<void> =>
    run(async () => {
      const before = access?.state
      const after = await requestWalkAccess()
      setAccess(after)
      if (before === 'no_permission' && after.state === 'no_permission') {
        toast('尚未授權。若沒有跳出授權畫面，請用下方按鈕到 Health Connect 開啟', 'error')
      }
      await reload()
    })

  const saveHeight = (): void => {
    const n = Number(height)
    if (height.trim() === '') {
      void save({ heightCm: undefined, heightPromptDone: true })
    } else if (n >= 100 && n <= 230) {
      void save({ heightCm: n, heightPromptDone: true })
      toast('已儲存身高')
    } else {
      toast('身高請填 100～230 公分', 'error')
    }
  }

  const speak = (): Promise<void> =>
    run(async () => {
      const r = await session.speakWalkNow(true)
      if (r.spoke) useUiStore.getState().popAll()
      else if (r.reason === 'steps') toast('今天還沒有步數可以聊')
      else if (r.reason === 'no_character') toast('沒有可以說話的角色（都不在場或被禁言）', 'error')
      else if (r.reason === 'busy') toast('角色正在想，等一下')
      else toast('角色現在說不了話，檢查網路與 API Key', 'error')
    })

  const todaySteps = state?.creditedByDay[localDay(Date.now())]
  const numberField = (
    label: string,
    key: 'minStepsToSpeak' | 'minIntervalMinutes' | 'maxPerDay',
    max: number
  ): JSX.Element => (
    <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
      {label}
      <input
        key={`${key}-${settings[key]}`}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        defaultValue={settings[key]}
        onBlur={(e) => {
          const n = Math.round(Number(e.target.value))
          if (e.target.value !== '' && n >= 0 && n <= max) void save({ [key]: n })
          else e.target.value = String(settings[key])
        }}
        className={INPUT}
      />
    </label>
  )

  return (
    <div className="space-y-3 pb-2">
      <div className={CARD}>
        <ToggleRow
          label="開啟陪伴同行"
          checked={settings.enabled}
          onChange={(v) => void save({ enabled: v }).then(() => (v ? askAccess() : reload()))}
        />
        <p className={SUB}>
          你走了多遠，目前對話裡的角色就在他們的世界陪你走多遠。步數只存在這支手機；
          <b>開啟 App 時，會自動把大約的距離（與你開啟的天氣）送到你設定的 AI 服務</b>，讓角色回應。
          角色說過的話會留在對話裡。
        </p>
      </div>

      {settings.enabled && (
        <>
          <div className={CARD}>
            <p className="text-sm font-medium text-[var(--text)]">{access ? ACCESS_TEXT[access.state] : '檢查授權中…'}</p>
            {access?.state === 'ok' && (
              <p className={SUB}>
                {access.backgroundGranted
                  ? '小工具可以在背景更新'
                  : access.backgroundSupported
                    ? '尚未允許背景讀取，小工具要開 App 才會更新'
                    : '這支手機不支援背景讀取，小工具要開 App 才會更新'}
              </p>
            )}
            {access && access.state !== 'unsupported' && (access.state !== 'ok' || (access.backgroundSupported && !access.backgroundGranted)) && (
              <button type="button" disabled={busy} className={BUTTON} onClick={() => void askAccess()}>授權</button>
            )}
            {access && access.state !== 'unsupported' && (
              <button
                type="button"
                className="text-[12px] text-[var(--text-sub)] underline"
                onClick={() => void openWalkSettings().catch(() => toast('無法開啟 Health Connect', 'error'))}
              >
                開啟 Health Connect 設定
              </button>
            )}
          </div>

          <div className={CARD}>
            <p className="text-[22px] font-bold text-[var(--text)]">
              {access?.state !== 'ok' || todaySteps === undefined ? '—' : `${todaySteps.toLocaleString()} 步`}
            </p>
            {access?.state === 'ok' && todaySteps !== undefined && (
              <p className={SUB}>今天約 {stepsToKm(todaySteps, settings).toFixed(1)} 公里</p>
            )}
            {readError && access?.state === 'ok' && <p className={SUB}>這次讀取失敗，顯示的是上次的數字</p>}
            {present.map((c) => (
              <p key={c.id} className={SUB}>
                與{c.name}一起走了約 {stepsToKm(state?.byCharacter[c.id]?.totalSteps ?? 0, settings).toFixed(1)} 公里
              </p>
            ))}
            <button type="button" disabled={busy} className={BUTTON} onClick={() => void run(reload)}>重新讀取</button>
            <button type="button" disabled={busy} className={BUTTON} onClick={() => void speak()}>
              {busy ? '請稍候…' : '聊聊剛才的散步'}
            </button>
          </div>

          <div className={CARD}>
            <p className="text-sm font-medium text-[var(--text)]">身高（選填）</p>
            <p className={SUB}>
              只用來估算你的步幅，把步數換算成距離。只存在這支手機，不會傳給 AI 或角色。
              不填也能使用，會以一般步幅計算。
            </p>
            <div className="flex items-center gap-2">
              <input
                aria-label="身高（公分）"
                inputMode="decimal"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className={INPUT}
              />
              <span className={SUB}>cm</span>
              <button type="button" className="ml-auto rounded-full bg-[var(--mint)] px-4 py-1.5 text-[13px] text-[var(--text)]" onClick={saveHeight}>儲存</button>
              {!settings.heightPromptDone && (
                <button type="button" className="px-2 py-1.5 text-[13px] text-[var(--text-sub)]" onClick={() => void save({ heightPromptDone: true })}>略過</button>
              )}
            </div>
          </div>

          <div className={CARD}>
            <ToggleRow label="開 App 時角色主動說話" checked={settings.speakOnOpen} onChange={(v) => void save({ speakOnOpen: v })} />
            <ToggleRow label="一併告訴角色目前天氣" checked={settings.includeWeather} onChange={(v) => void save({ includeWeather: v })} />
            {numberField('至少多走幾步才說', 'minStepsToSpeak', 100000)}
            {numberField('兩次間隔（分鐘）', 'minIntervalMinutes', 1440)}
            {numberField('每天最多幾次', 'maxPerDay', 100)}
            <p className={SUB}>天氣不含地名，且要先在「設定」開啟天氣。</p>
          </div>

          <button
            type="button"
            disabled={busy}
            className="w-full py-2 text-[13px] text-[var(--text-sub)] underline"
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true)
                return
              }
              setConfirmClear(false)
              void run(async () => {
                await clearWalkData(session.walkStorage)
                await reload()
                toast('已清除')
              })
            }}
          >
            {confirmClear ? '再按一次確定清除（不會刪除已經說過的對話）' : '清除陪伴同行資料'}
          </button>
        </>
      )}
    </div>
  )
}
