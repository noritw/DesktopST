import { useCallback, useEffect, useState } from 'react'
import { LLM_FEATURES, groupUsage, sumUsage, type LlmUsageRecord, type UsageTotal } from '@core/llm/usage'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import {
  KEEP_DAYS,
  clearUsage,
  loadUsage,
  loadUsageSettings,
  saveUsageSettings,
  type UsageSettings
} from '../../runtime/llmUsage'
import { useUiStore } from '../stores/uiStore'
import { ToggleRow } from './SettingsView'

/** AI 用量：看各功能花了多少。只記次數與 token，不記內容。 */

const CARD = 'space-y-2.5 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-3'
const SUB = 'text-[12px] leading-relaxed text-[var(--text-sub)]'
const RANGES = [
  { days: 1, label: '今日' },
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' }
]

type Filter = 'normal' | 'test' | 'all'
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'normal', label: '平常' },
  { id: 'test', label: '測試' },
  { id: 'all', label: '全部' }
]

const n = (v: number): string => v.toLocaleString()
const usd = (v: number): string => `US$${v.toFixed(v > 0 && v < 0.1 ? 4 : 2)}`

function rangeStart(days: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return d.getTime()
}

function Chips<T extends string | number>(props: {
  items: Array<{ id: T; label: string }>
  value: T
  onChange: (v: T) => void
}): JSX.Element {
  return (
    <div className="flex gap-2">
      {props.items.map((i) => (
        <button
          key={i.id}
          type="button"
          aria-pressed={i.id === props.value}
          onClick={() => props.onChange(i.id)}
          className={`flex-1 rounded-full border border-[var(--border)] py-2 text-[13px] text-[var(--text)] ${
            i.id === props.value ? 'bg-[var(--mint)] font-medium' : 'bg-[var(--bg)]'
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  )
}

function Group(props: {
  title: string
  rows: Array<{ key: string; total: UsageTotal }>
  name: (key: string) => string
  points: (v: number) => string
}): JSX.Element {
  return (
    <div className={CARD}>
      <p className="text-sm font-medium text-[var(--text)]">{props.title}</p>
      {props.rows.map(({ key, total }) => (
        <div key={key}>
          <div className="flex items-baseline justify-between gap-3 text-sm text-[var(--text)]">
            <span className="min-w-0 break-words">{props.name(key)}</span>
            <span className="shrink-0">{cost(total)}</span>
          </div>
          <p className={SUB}>
            {n(total.calls)} 次・輸入 {n(total.input)}・輸出 {n(total.output)}
            {total.unpriced < total.calls && `・${props.points(total.usd)} 點`}
            {total.usd > 0 && total.calls - total.unpriced > 1 && `・平均每次 ${usd(total.usd / (total.calls - total.unpriced))}`}
            {total.failed > 0 && `・失敗 ${n(total.failed)} 次`}
          </p>
        </div>
      ))}
    </div>
  )
}

function cost(t: UsageTotal): string {
  if (t.calls > 0 && t.unpriced === t.calls) return '無法估價'
  return usd(t.usd)
}

export function LlmUsageView(): JSX.Element {
  const session = getStandaloneSession()
  const ui = useUiStore.getState()
  const [days, setDays] = useState(1)
  const [filter, setFilter] = useState<Filter>('normal')
  const [records, setRecords] = useState<LlmUsageRecord[] | null>(null)
  const [settings, setSettings] = useState<UsageSettings | null>(null)
  const [failed, setFailed] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (!session) return
    try {
      setSettings(await loadUsageSettings(session.adapters.storage))
      setRecords(await loadUsage(session.adapters.storage, rangeStart(30)))
    } catch {
      setFailed(true)
    }
  }, [session])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!session) return <p className={SUB}>這個功能只在本機模式可用。</p>
  if (failed) return <p className={SUB}>讀取失敗，請關掉這頁再開一次。</p>
  if (!records || !settings) return <p className={SUB}>讀取中…</p>

  const save = (patch: Partial<UsageSettings>): void => {
    setSettings({ ...settings, ...patch })
    saveUsageSettings(session.adapters.storage, patch).catch(() => {
      ui.toast('設定失敗', 'error')
      void reload()
    })
  }

  const clear = async (): Promise<void> => {
    const yes = await ui.confirm({
      title: '清除所有用量紀錄？',
      message: '清除後無法復原，不影響對話與設定。',
      confirmLabel: '清除',
      destructive: true
    })
    if (!yes) return
    try {
      await clearUsage(session.adapters.storage)
    } catch {
      ui.toast('清除失敗', 'error')
    }
    await reload()
  }

  const since = rangeStart(days)
  const shown = records.filter((r) => r.at >= since && (filter === 'all' || (r.test === true) === (filter === 'test')))
  const total = sumUsage(shown)
  const points = (v: number): string => n(Math.round((v / settings.usdPerPoint) * 10) / 10)

  return (
    <div className="space-y-3 pb-2">
      <Chips items={RANGES.map((r) => ({ id: r.days, label: r.label }))} value={days} onChange={setDays} />
      <Chips items={FILTERS} value={filter} onChange={setFilter} />

      <div className={CARD}>
        <p className="text-[22px] font-bold text-[var(--text)]">{cost(total)}</p>
        <p className={SUB}>
          {n(total.calls)} 次・輸入 {n(total.input)}・輸出 {n(total.output)} tokens
          {total.unpriced < total.calls && `・試算 ${points(total.usd)} 點`}
        </p>
        {(total.cached > 0 || total.reasoning > 0) && (
          <p className={SUB}>其中快取輸入 {n(total.cached)}、思考輸出 {n(total.reasoning)}</p>
        )}
        {total.unpriced > 0 && <p className={SUB}>有 {n(total.unpriced)} 次沒算進金額（查不到單價，或失敗沒有回報用量）</p>}
      </div>

      {shown.length > 0 && (
        <>
          <Group
            title="依功能"
            rows={groupUsage(shown, (r) => r.feature)}
            name={(k) => (LLM_FEATURES as Record<string, string>)[k] ?? k}
            points={points}
          />
          <Group title="依模型" rows={groupUsage(shown, (r) => r.model || r.provider)} name={(k) => k} points={points} />
        </>
      )}

      <div className={CARD}>
        <ToggleRow label="測試中" checked={settings.testing} onChange={(v) => save({ testing: v })} />
        <p className={SUB}>開著時的用量記在「測試」，不混進「平常」。</p>
        <label className="flex items-center justify-between gap-3 text-sm text-[var(--text)]">
          試算：1 點等於多少美元
          <input
            key={settings.usdPerPoint}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            defaultValue={settings.usdPerPoint}
            onBlur={(e) => {
              const v = Number(e.target.value)
              if (v > 0 && Number.isFinite(v)) save({ usdPerPoint: v })
              else e.target.value = String(settings.usdPerPoint)
            }}
            className="w-24 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)]"
          />
        </label>
        <p className={SUB}>點數只是試算，不會扣除任何東西。</p>
      </div>

      <div className={CARD}>
        <p className={SUB}>
          金額依牌價估算，未計快取折扣，實際以 AI 服務的帳單為準。只記錄這支手機本機模式的次數與 token，不記對話內容，保留
          {' '}{KEEP_DAYS} 天。設定裡的連線測試不計入。
        </p>
        <button type="button" className="text-[12px] text-[var(--text-sub)] underline" onClick={() => void clear()}>
          清除所有用量紀錄
        </button>
      </div>
    </div>
  )
}
