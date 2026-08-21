import { useCallback, useEffect, useState } from 'react'
import type { Reminder } from '@core/types'
import MonoIcon from '@shared/MonoIcon'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from './settingsErrors'
import { scheduleLabel } from './reminderFormat'
import { exactAlarmPermission, openExactAlarmSettings } from '../../adapters/nativeAlarms'

/** 提醒清單。時間格式與編輯器的原生選擇器共用 `reminderFormat`，見那支的說明。 */
export function RemindersView(): JSX.Element {
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)
  const [reminders, setReminders] = useState<Reminder[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Android 12+ 的「鬧鐘與提醒」授權；null＝這台裝置沒有這個開關或還沒查到 */
  const [exactAlarm, setExactAlarm] = useState<{ granted: boolean; applicable: boolean } | null>(null)

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

  /*
   * 精準鬧鐘權限：**不能靜默失敗**。
   * 沒授權的話鬧鐘會退回不精準模式（誤差可能數分鐘），
   * 使用者只會覺得「提醒不準」而完全查不出原因。
   * 每次進這一頁都重查——使用者可能剛從系統設定回來。
   */
  useEffect(() => {
    void exactAlarmPermission().then(setExactAlarm)
  }, [])

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const reminder = await getData().reminders.create()
      await getData().reminders.save(reminder)
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
      {exactAlarm?.applicable && !exactAlarm.granted && (
        <div className="mb-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
          <p className="text-sm text-[var(--text)]">提醒可能會晚幾分鐘</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-sub)]">
            系統還沒允許這個 App 設定精準鬧鐘。開啟之後提醒才會準時響。
          </p>
          <button
            type="button"
            onClick={() => void openExactAlarmSettings()}
            className="mt-2 w-full rounded-full bg-[var(--mint)] py-2 text-sm text-[var(--text)]"
          >
            前往系統設定開啟
          </button>
        </div>
      )}

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
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50"
      >
        <MonoIcon name="plus" className="h-3.5 w-3.5" />
        新增提醒
      </button>

      {/*
        紀錄入口放在清單底下：平常不會用到，但「它到底有沒有響」發生時
        使用者第一個會來的就是提醒這一頁。
      */}
      <button
        type="button"
        onClick={() => push('reminder-history')}
        className="mt-2 w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text-sub)]"
      >
        查看提醒紀錄
      </button>
    </div>
  )
}
