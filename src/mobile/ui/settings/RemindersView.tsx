import { useCallback, useEffect, useState } from 'react'
import type { Reminder, ReminderSchedule } from '@core/types'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from './settingsErrors'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

/** 對齊桌面版 `RemindersManagerWindow.tsx` 的措辭，同一個排程在兩邊看到的敘述要一樣。 */
function scheduleLabel(s: ReminderSchedule): string {
  if (s.type === 'startup') return '每次啟動'
  if (s.type === 'daily') return `每天 ${pad(s.hour)}:${pad(s.minute)}`
  if (s.type === 'weekly') {
    const names = [...s.days].sort((a, b) => a - b).map((d) => WEEKDAY_LABELS[d] ?? '?').join('、')
    return `每週 ${names} ${pad(s.hour)}:${pad(s.minute)}`
  }
  if (s.type === 'interval') {
    const mins = Math.round(s.intervalMs / 60_000)
    if (mins >= 60 && mins % 60 === 0) return `每 ${mins / 60} 小時`
    return `每 ${mins} 分鐘`
  }
  const d = new Date(s.at)
  return `一次性 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 提醒清單（B3 階段 4，資料面；排程本身是 B5）。 */
export function RemindersView(): JSX.Element {
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)
  const [reminders, setReminders] = useState<Reminder[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setReminders(await getData().reminders.list())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const reminder = await getData().reminders.create()
      push('reminder-editor', reminder.id)
    } catch (e) {
      toast(describeSettingsError(e, '建立提醒'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (r: Reminder): Promise<void> => {
    if (!reminders) return
    const next = reminders.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x))
    setReminders(next)
    try {
      await getData().reminders.toggle(r.id, !r.enabled)
    } catch (e) {
      setReminders(reminders)
      toast(describeSettingsError(e, '切換提醒'), 'error')
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入提醒失敗</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]">
          重試
        </button>
      </div>
    )
  }

  if (!reminders) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="pb-2">
      {reminders.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-sub)]">還沒有任何提醒。</p>
      ) : (
        <div className="space-y-2">
          {reminders.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => push('reminder-editor', r.id)}
              className="flex w-full items-center gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--text)]">{r.label || '（未命名）'}</p>
                <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">{scheduleLabel(r.schedule)}</p>
              </div>
              <input
                type="checkbox"
                checked={r.enabled}
                onClick={(e) => e.stopPropagation()}
                onChange={() => void toggle(r)}
                className="h-4 w-4 shrink-0 accent-[var(--mint2)]"
              />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className="mt-3 w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50"
      >
        ＋ 新增提醒
      </button>
    </div>
  )
}
