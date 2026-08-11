import { useCallback, useEffect, useState } from 'react'
import type { ReminderHistoryItem, ReminderHistoryStatus } from '@core/types'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from './settingsErrors'
import { formatDateTime } from './reminderFormat'

/**
 * 提醒觸發歷史。
 *
 * 為什麼需要這個畫面：提醒是背景發生的事，使用者常常根本沒看到通知
 * （螢幕暗著、震動模式、配對的手錶把通知轉走並清掉手機那則）。
 * 沒有歷史的話「它到底有沒有響」查不出來，「安靜略過」與「壞掉」
 * 在使用者眼裡長得一模一樣——而我們現在刻意讓某些情況安靜略過
 * （情境不符、離線且關掉降級），更需要有地方交代。
 */

const STATUS_META: Record<ReminderHistoryStatus, { label: string; tone: 'ok' | 'warn' | 'muted' }> = {
  success: { label: '已提醒', tone: 'ok' },
  offline_fallback: { label: '離線・用了先前的話', tone: 'warn' },
  // 不寫「連不上網」——實際上常常是生成失敗、沒金鑰、沒角色，寫死成網路問題會誤導
  skipped_offline: { label: '沒有可用的台詞，跳過', tone: 'muted' },
  skipped_idle: { label: '待機中，跳過', tone: 'muted' },
  skipped_scene_mismatch: { label: '情境不符，跳過', tone: 'muted' }
}

const TONE_CLASS = {
  ok: 'border-[var(--mint2)] text-[var(--text)]',
  warn: 'border-[var(--border)] text-[var(--text)]',
  muted: 'border-[var(--border)] text-[var(--text-sub)]'
} as const

export function ReminderHistoryView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const [items, setItems] = useState<ReminderHistoryItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setItems(await getData().reminders.history())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const removeOne = async (item: ReminderHistoryItem): Promise<void> => {
    const prev = items
    setItems((list) => list?.filter((x) => x.id !== item.id) ?? null)
    try {
      await getData().reminders.removeHistoryItem(item.id)
    } catch (e) {
      setItems(prev)
      toast(describeSettingsError(e, '刪除紀錄'), 'error')
    }
  }

  const clearAll = async (): Promise<void> => {
    const ok = await confirm({
      title: '清空紀錄',
      message: '所有提醒紀錄都會被刪掉，這個動作沒辦法復原。',
      confirmLabel: '清空',
      destructive: true
    })
    if (!ok) return
    const prev = items
    setItems([])
    try {
      await getData().reminders.clearHistory()
    } catch (e) {
      setItems(prev)
      toast(describeSettingsError(e, '清空紀錄'), 'error')
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入紀錄失敗</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
        >
          重試
        </button>
      </div>
    )
  }

  if (!items) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--text-sub)]">還沒有提醒紀錄。</p>
  }

  return (
    <div className="pb-2">
      <div className="space-y-2">
        {items.map((h) => {
          const meta = STATUS_META[h.status] ?? STATUS_META.success
          return (
            <div key={h.id} className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm text-[var(--text)]">{h.characterName || h.reminderLabel}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${TONE_CLASS[meta.tone]}`}>
                      {meta.label}
                    </span>
                  </div>
                  {h.text ? (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text)]">{h.text}</p>
                  ) : (
                    <p className="mt-1 text-sm text-[var(--text-sub)]">（沒有發出通知）</p>
                  )}
                  <p className="mt-1 text-[11px] text-[var(--text-sub)]">
                    {h.reminderLabel} · {formatDateTime(h.timestamp)}
                  </p>
                  {/*
                    降級原因單獨一行。擠在時間後面會被截斷，
                    而這正是「為什麼又是舊句子」唯一查得到的地方。
                  */}
                  {h.errorMessage && (
                    <p className="mt-0.5 break-words text-[11px] leading-relaxed text-[var(--text-sub)]">
                      原因：{h.errorMessage}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void removeOne(h)}
                  className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--text-sub)]"
                >
                  刪除
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() => void clearAll()}
        className="mt-3 w-full rounded-full border border-[var(--danger)] py-2.5 text-sm text-[var(--danger)]"
      >
        清空所有紀錄
      </button>
    </div>
  )
}
