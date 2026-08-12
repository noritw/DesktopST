import { useCallback, useEffect, useRef, useState } from 'react'
import type { CharacterListItem, ConversationListItem, PresetListItem } from '@core/data'
import type { Reminder, ReminderSchedule } from '@core/types'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from './settingsErrors'
import { formatRelative } from './reminderFormat'
import { getStandaloneSession } from '../../runtime/sessionHolder'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

function currentClock(): { hour: number; minute: number } {
  const d = new Date()
  return { hour: d.getHours(), minute: d.getMinutes() }
}

function clockValue(s: ReminderSchedule): string {
  if (s.type === 'daily' || s.type === 'weekly') return `${pad(s.hour)}:${pad(s.minute)}`
  const c = currentClock()
  return `${pad(c.hour)}:${pad(c.minute)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 提醒編輯器。欄位與措辭對齊桌面版 `RemindersManagerWindow.tsx` 的 `ReminderForm`——
 * 同一個排程在兩邊看到的說法不一樣，使用者會以為存錯了東西。
 *
 * 排程本身（`setTimeout` 排程、開機觸發等）是 B5 才做；這裡只負責把 `Reminder`
 * 存進電腦上同一份清單，桌面的排程器接手之後的事。
 */
export function ReminderEditor({ reminderId }: { reminderId: string }): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const pop = useUiStore((s) => s.pop)
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)

  const standalone = getStandaloneSession() !== null
  const [draft, setDraft] = useState<Reminder | null>(null)
  const [characters, setCharacters] = useState<CharacterListItem[]>([])
  const [scenes, setScenes] = useState<PresetListItem[]>([])
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const dirtyRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const markDirty = (): void => {
    dirtyRef.current = true
    setDirty(true)
  }

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      const [list, chars, sceneList, convList] = await Promise.all([
        getData().reminders.list(),
        getData().characters.list(),
        getData().presets.listScenes(),
        getData().conversations.list()
      ])
      const found = list.find((r) => r.id === reminderId)
      if (!found) { setFailed(true); return }
      setDraft(found)
      setCharacters(chars)
      setScenes(sceneList)
      setConversations(convList)
      // 已經設過進階選項的提醒，一進來就展開——不然使用者找不到自己設過的東西
      if (found.sceneId || found.conversationId || found.wakeMode === 'screen_on_only' || found.allowOfflineFallback === false) {
        setAdvancedOpen(true)
      }
    } catch {
      setFailed(true)
    }
  }, [reminderId])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async (): Promise<boolean> => {
    const current = draft
    if (!current) return false
    if (!current.label.trim()) {
      toast('提醒名稱不可空白', 'error')
      return false
    }
    if (current.schedule.type === 'weekly' && current.schedule.days.length === 0) {
      toast('請至少選擇一個星期', 'error')
      return false
    }
    if (current.schedule.type === 'interval' && current.schedule.intervalMs < 5 * 60_000) {
      toast('間隔時間最短 5 分鐘', 'error')
      return false
    }
    if (current.schedule.type === 'once' && current.schedule.at <= Date.now()) {
      toast('請設定未來的時間', 'error')
      return false
    }
    setBusy(true)
    try {
      await getData().reminders.save(current)
      dirtyRef.current = false
      setDirty(false)
      return true
    } catch (e) {
      toast(describeSettingsError(e, '儲存'), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }, [draft, toast])

  useEffect(() => {
    setCloseGuard(() => {
      if (!dirtyRef.current) return true
      void (async () => {
        const ok = await confirm({
          title: '還沒儲存',
          message: '這則提醒有還沒儲存的改動，要捨棄嗎？',
          confirmLabel: '捨棄',
          destructive: true
        })
        if (ok) {
          dirtyRef.current = false
          pop()
        }
      })()
      return false
    })
    return () => setCloseGuard(null)
  }, [setCloseGuard, confirm, pop])

  const remove = async (): Promise<void> => {
    if (!draft) return
    const ok = await confirm({
      title: `刪除「${draft.label || '這則提醒'}」`,
      message: '刪除後不能復原。',
      confirmLabel: '刪除',
      destructive: true
    })
    if (!ok) return
    setBusy(true)
    try {
      await getData().reminders.remove(draft.id)
      dirtyRef.current = false
      toast('已刪除提醒')
      pop()
    } catch (e) {
      toast(describeSettingsError(e, '刪除'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入提醒失敗，或這則已經被刪除了</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]">
          重試
        </button>
      </div>
    )
  }

  if (!draft) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  const set = <K extends keyof Reminder>(key: K, value: Reminder[K]): void => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))
    markDirty()
  }

  const setScheduleType = (type: ReminderSchedule['type']): void => {
    if (type === 'startup') return set('schedule', { type: 'startup' })
    if (type === 'daily') { const c = currentClock(); return set('schedule', { type: 'daily', hour: c.hour, minute: c.minute }) }
    if (type === 'weekly') { const c = currentClock(); return set('schedule', { type: 'weekly', days: [new Date().getDay()], hour: c.hour, minute: c.minute }) }
    if (type === 'interval') return set('schedule', { type: 'interval', intervalMs: 30 * 60_000 })
    return set('schedule', { type: 'once', at: Date.now() + 60 * 60_000 })
  }

  const setClock = (value: string): void => {
    const [hStr, mStr] = value.split(':')
    const hour = parseInt(hStr ?? '0', 10)
    const minute = parseInt(mStr ?? '0', 10)
    if (draft.schedule.type === 'daily') set('schedule', { type: 'daily', hour, minute })
    else if (draft.schedule.type === 'weekly') set('schedule', { ...draft.schedule, hour, minute })
  }

  const toggleWeekday = (day: number): void => {
    if (draft.schedule.type !== 'weekly') return
    const has = draft.schedule.days.includes(day)
    const nextDays = has ? draft.schedule.days.filter((d) => d !== day) : [...draft.schedule.days, day]
    if (nextDays.length === 0) return
    set('schedule', { ...draft.schedule, days: nextDays.sort((a, b) => a - b) })
  }

  return (
    <div className="pb-2">
      <Field label="提醒名稱">
        <input
          type="text"
          maxLength={40}
          className="field"
          value={draft.label}
          onChange={(e) => set('label', e.target.value)}
          placeholder="例：早安問候、喝水提醒"
        />
      </Field>

      <Field label="由哪個角色說話">
        <select className="field" value={draft.characterId ?? ''} onChange={(e) => set('characterId', e.target.value || undefined)}>
          <option value="">隨機角色（在場的）</option>
          {characters.filter((c) => c.present).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </Field>

      {/*
        notificationDevice：決定這則提醒在哪台裝置響。
        預設是 'mobile'（手機上建的就只在手機響），S2 同步後才會出現需要選 'both' 的場景。
        但現在就要讓使用者能選，這樣從電腦拉過來的 'desktop' 提醒才能在手機上改響。
        只在獨立模式顯示：遙控模式的提醒是電腦那份，在電腦設定就好。
      */}
      {standalone && (
        <Field label="在哪台裝置提醒你">
          <select
            className="field"
            value={draft.notificationDevice ?? 'mobile'}
            onChange={(e) => set('notificationDevice', e.target.value as 'desktop' | 'mobile' | 'both')}
          >
            <option value="mobile">只在手機</option>
            <option value="desktop">只在電腦</option>
            <option value="both">手機和電腦都響</option>
          </select>
        </Field>
      )}

      <Field label="觸發時機">
        <select className="field" value={draft.schedule.type} onChange={(e) => setScheduleType(e.target.value as ReminderSchedule['type'])}>
          <option value="startup">每次啟動程式</option>
          <option value="daily">每天固定時間</option>
          <option value="weekly">每週固定星期與時間</option>
          <option value="interval">間隔時間</option>
          <option value="once">一次性</option>
        </select>
      </Field>

      {(draft.schedule.type === 'daily' || draft.schedule.type === 'weekly') && (
        <Field label={draft.schedule.type === 'daily' ? '每天幾點' : '幾點'}>
          {draft.schedule.type === 'weekly' && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((name, day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleWeekday(day)}
                  className={`min-w-[2.25rem] rounded-full border px-2 py-1 text-xs font-semibold ${
                    draft.schedule.type === 'weekly' && draft.schedule.days.includes(day)
                      ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]'
                      : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-sub)]'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
          <input type="time" className="field" value={clockValue(draft.schedule)} onChange={(e) => setClock(e.target.value)} />
        </Field>
      )}

      {draft.schedule.type === 'interval' && (
        <Field label="每隔幾分鐘（最少 5 分鐘）">
          <input
            type="number"
            min={5}
            max={1440}
            className="field"
            value={Math.round(draft.schedule.intervalMs / 60_000)}
            onChange={(e) => set('schedule', { type: 'interval', intervalMs: Math.max(5, parseInt(e.target.value, 10) || 5) * 60_000 })}
          />
        </Field>
      )}

      {draft.schedule.type === 'once' && (
        <Field
          label="在什麼時候"
          hint={
            formatRelative(draft.schedule.at)
              ? `目前設定：${formatRelative(draft.schedule.at)}`
              : '這個時間已經過了，提醒不會觸發。'
          }
        >
          <input
            type="datetime-local"
            className="field"
            value={toDatetimeLocal(draft.schedule.at)}
            onChange={(e) => set('schedule', { type: 'once', at: new Date(e.target.value).getTime() })}
          />
        </Field>
      )}

      <Field label="自訂指令（選填）" hint="角色說話前會收到這段指令，空白則自然發話。">
        <textarea className="field min-h-[64px]" value={draft.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="例：提醒我喝水" />
      </Field>

      {/*
        獨立版沒接的注入來源要灰掉、而且講清楚為什麼。
        勾了卻什麼都不會發生比不能勾更糟——使用者會以為提醒壞了。
        （遙控模式讀的是電腦那份資料，這三項都正常可用。）
      */}
      <div className="space-y-1.5">
        <ToggleRow
          label="參考便利貼內容"
          checked={!!draft.injectPinnedNotes}
          onChange={(v) => set('injectPinnedNotes', v)}
          disabledNote={standalone ? '手機版還沒有便利貼' : undefined}
        />
        <ToggleRow label="參考對話上下文內容" checked={!!draft.injectConversationContext} onChange={(v) => set('injectConversationContext', v)} />
        <ToggleRow label="加入天氣資訊" checked={!!draft.injectWeather} onChange={(v) => set('injectWeather', v)} />
        <ToggleRow
          label="抓一則新聞當話題"
          checked={!!draft.injectNews}
          onChange={(v) => set('injectNews', v)}
        />
        <ToggleRow
          label="加入接下來的行程"
          checked={!!draft.injectCalendar}
          onChange={(v) => set('injectCalendar', v)}
          disabledNote={standalone ? 'Google 日曆授權只在電腦上' : undefined}
        />
      </div>

      {/*
        進階選項。預設收起來：這些是「已經在用提醒、開始覺得它吵或出戲」之後才會想調的東西，
        第一次建立提醒的人不該被它們擋住（CLAUDE.md 分層原則：進階勿擠第一層）。
        全部只在獨立模式顯示——遙控模式的提醒由電腦端排程，這些欄位還沒有人讀。
      */}
      {standalone && (
        <div className="mb-4 rounded-2xl border border-[var(--border)]">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-sm text-[var(--text)]"
          >
            <span>進階</span>
            <span className="text-[var(--text-sub)]">{advancedOpen ? '收起' : '展開'}</span>
          </button>

          {advancedOpen && (
            <div className="border-t border-[var(--border)] px-3.5 pt-3">
              <Field
                label="待機時要不要叫醒手機"
                hint="「只在使用中」適合提醒休息、喝水這類事——手機放著沒在用就別吵。"
              >
                <select
                  className="field"
                  value={draft.wakeMode ?? 'always'}
                  onChange={(e) => set('wakeMode', e.target.value as 'always' | 'screen_on_only')}
                >
                  <option value="always">一律提醒（待機也叫醒）</option>
                  <option value="screen_on_only">只在使用中提醒</option>
                </select>
              </Field>

              {draft.wakeMode === 'screen_on_only' && (
                <Field label="待機時錯過了怎麼辦">
                  <select
                    className="field"
                    value={draft.inactiveBehavior ?? 'skip'}
                    onChange={(e) => set('inactiveBehavior', e.target.value as 'skip' | 'notify_on_unlock')}
                  >
                    <option value="skip">跳過這次</option>
                    <option value="notify_on_unlock">下次拿起手機時補提醒</option>
                  </select>
                </Field>
              )}

              <Field
                label="綁定情境（選填）"
                hint="綁了之後，這則提醒會用該情境的人設與世界觀來講話。"
              >
                <select
                  className="field"
                  value={draft.sceneId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || undefined
                    setDraft((d) => (d ? { ...d, sceneId: v, sceneConstraint: v ? (d.sceneConstraint ?? 'any_scene') : undefined } : d))
                    markDirty()
                  }}
                >
                  <option value="">不綁定（跟著目前情境）</option>
                  {scenes.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>

              {draft.sceneId && (
                <Field
                  label="什麼時候才響"
                  hint="選「只在這個情境時」，跑團跑到一半就不會被日常提醒打斷。"
                >
                  <select
                    className="field"
                    value={draft.sceneConstraint ?? 'any_scene'}
                    onChange={(e) => set('sceneConstraint', e.target.value as 'any_scene' | 'match_scene_only')}
                  >
                    <option value="any_scene">任何時候都響</option>
                    <option value="match_scene_only">只在這個情境時才響</option>
                  </select>
                </Field>
              )}

              <Field
                label="綁定對話（選填）"
                hint="指定要讀哪一則對話的近期紀錄當脈絡，適合推進特定故事線。"
              >
                <select
                  className="field"
                  value={draft.conversationId ?? ''}
                  onChange={(e) => set('conversationId', e.target.value || undefined)}
                >
                  <option value="">不綁定（用目前的對話）</option>
                  {conversations.map((c) => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              </Field>

              <div className="space-y-1.5 pb-3">
                <ToggleRow
                  label="連不上網時仍要提醒"
                  checked={draft.allowOfflineFallback !== false}
                  onChange={(v) => set('allowOfflineFallback', v)}
                />
                <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
                  關掉的話，連不上網就安靜跳過這次，不會用舊的話搪塞你。
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void remove()}
        className="mt-4 w-full rounded-full border border-[var(--danger)] py-2.5 text-sm text-[var(--danger)] disabled:opacity-50"
      >
        刪除這則提醒
      </button>

      <div className="sticky bottom-0 -mx-5 mt-3 border-t border-[var(--border)] bg-[var(--surface)] px-5 pb-1 pt-2">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-40"
        >
          {busy ? '處理中⋯⋯' : dirty ? '儲存' : '已儲存'}
        </button>
      </div>
    </div>
  )
}

function toDatetimeLocal(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="mb-4 block">
      <span className="text-xs font-semibold text-[var(--text)]">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-sub)]">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabledNote
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  /** 有值＝這項在目前模式下用不到；顯示原因並鎖住。 */
  disabledNote?: string
}): JSX.Element {
  return (
    <label className={`flex items-center justify-between gap-3 py-0.5 ${disabledNote ? 'opacity-45' : ''}`}>
      <span className="min-w-0">
        <span className="block text-sm text-[var(--text)]">{label}</span>
        {disabledNote && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-sub)]">{disabledNote}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked && !disabledNote}
        disabled={!!disabledNote}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--mint2)]"
      />
    </label>
  )
}
