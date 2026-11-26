import { useEffect, useRef, useState, type RefObject } from 'react'
import type { WeekStats } from '@core/walk/points'

/** 今日旅途頂部的步數、點數與週統計。 */

const reducedMotion = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const FLY_MS = 750
const TWEEN_MS = 900

/**
 * 點數。變多時從 `fromRef`（步數）飛光點進來再往上跳；變少時往下數並浮出「−N」。
 * 播完新入帳的量呼叫 `onSeen`，之後不再重播。
 */
export function PointsPill({
  balance,
  unseen,
  fromRef,
  onSeen
}: {
  balance: number
  unseen: number
  fromRef: RefObject<HTMLElement>
  onSeen: (n: number) => void
}): JSX.Element {
  const [shown, setShown] = useState<number | null>(null)
  const shownRef = useRef<number | null>(null)
  const [flies, setFlies] = useState<{ key: number; dx: number; dy: number; delay: number }[]>([])
  const [delta, setDelta] = useState<{ key: number; n: number } | null>(null)
  const [bump, setBump] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const seq = useRef(0)
  const frame = useRef<number>()
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current)
      timers.current.forEach(clearTimeout)
    },
    []
  )

  const set = (v: number): void => {
    shownRef.current = v
    setShown(v)
  }

  const tween = (from: number, to: number): void => {
    if (frame.current) cancelAnimationFrame(frame.current)
    if (reducedMotion()) return set(to)
    const start = performance.now()
    const step = (t: number): void => {
      const k = Math.min(1, (t - start) / TWEEN_MS)
      const eased = 1 - Math.pow(1 - k, 3)
      set(Math.round(from + (to - from) * eased))
      if (k < 1) frame.current = requestAnimationFrame(step)
      else setBump((b) => b + 1)
    }
    frame.current = requestAnimationFrame(step)
  }

  const flyIn = (from: number, to: number): void => {
    const a = fromRef.current?.getBoundingClientRect()
    const b = ref.current?.getBoundingClientRect()
    if (reducedMotion() || !a || !b) {
      tween(from, to)
      return
    }
    const dx = a.left + a.width / 2 - (b.left + b.width / 2)
    const dy = a.top + a.height / 2 - (b.top + b.height / 2)
    const count = Math.min(10, 3 + Math.floor(Math.log10(Math.max(10, to - from)) * 2))
    setFlies(Array.from({ length: count }, (_, i) => ({ key: ++seq.current, dx: dx + (i % 3 - 1) * 10, dy: dy + (i % 2) * 8, delay: i * 70 })))
    timers.current.push(setTimeout(() => tween(from, to), FLY_MS * 0.6))
    timers.current.push(setTimeout(() => setFlies([]), FLY_MS + count * 70 + 100))
    setDelta({ key: ++seq.current, n: to - from })
  }

  useEffect(() => {
    const prev = shownRef.current
    if (prev === null) {
      if (unseen > 0 && unseen <= balance) {
        set(balance - unseen)
        // 等版面排好再量位置
        timers.current.push(setTimeout(() => flyIn(balance - unseen, balance), 250))
        onSeen(unseen)
      } else {
        set(balance)
        if (unseen > 0) onSeen(unseen)
      }
      return
    }
    if (balance === prev) return
    if (balance > prev) {
      flyIn(prev, balance)
      if (unseen > 0) onSeen(Math.min(unseen, balance - prev))
    } else {
      setDelta({ key: ++seq.current, n: balance - prev })
      tween(prev, balance)
    }
    // 只跟著數字變
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, unseen])

  return (
    <span ref={ref} className="relative inline-flex items-center gap-1.5 rounded-full bg-[#FFFDF4] px-3.5 py-2 text-[#3D5A52]">
      <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border-2 border-[#FFFDF4] bg-[#F5C96B]" />
      <span key={bump} className="points-bump text-[17px] font-bold tabular-nums" aria-live="polite">
        {(shown ?? balance).toLocaleString()}
      </span>
      <span className="text-[12px]">點</span>
      {flies.map((f) => (
        <span
          key={f.key}
          className="points-fly"
          style={{ ['--dx' as string]: `${f.dx}px`, ['--dy' as string]: `${f.dy}px`, animationDelay: `${f.delay}ms` }}
        />
      ))}
      {delta && (
        <span
          key={delta.key}
          className={`points-delta absolute -bottom-5 right-2 text-[13px] font-bold ${delta.n > 0 ? 'text-[#3D7A5A]' : 'text-[#9A6A4A]'}`}
        >
          {delta.n > 0 ? `＋${delta.n.toLocaleString()}` : `−${(-delta.n).toLocaleString()}`}
        </span>
      )}
    </span>
  )
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

/** 本週步數：週一起算的長條、合計、平均。 */
export function WeekPanel({ stats, today, onClose }: { stats: WeekStats; today: string; onClose: () => void }): JSX.Element {
  const max = Math.max(1, ...stats.days.map((d) => d.steps ?? 0))
  return (
    <div className="anim-pop-in absolute inset-x-3 top-24 z-[730] rounded-[22px] bg-[#FFFDF4] px-4 pb-3 pt-4 text-[#3D5A52]">
      <div className="flex items-baseline justify-between">
        <p className="text-[15px] font-bold">本週步數</p>
        <button type="button" className="px-2 py-1 text-[13px]" onClick={onClose}>關閉</button>
      </div>
      <div className="grid grid-cols-2 gap-2 pt-2 text-center">
        <div className="rounded-[16px] bg-[#EAF7F1] py-2">
          <p className="text-[12px]">合計</p>
          <p className="text-[22px] font-bold tabular-nums">{stats.total.toLocaleString()}</p>
        </div>
        <div className="rounded-[16px] bg-[#EAF7F1] py-2">
          <p className="text-[12px]">每日平均</p>
          <p className="text-[22px] font-bold tabular-nums">{stats.average.toLocaleString()}</p>
        </div>
      </div>
      <div className="flex h-32 items-end gap-1.5 pt-3" role="list" aria-label="每日步數">
        {stats.days.map((d, i) => (
          <div key={d.day} role="listitem" className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] tabular-nums">{d.steps ? (d.steps >= 1000 ? `${(d.steps / 1000).toFixed(1)}k` : d.steps) : ''}</span>
            <span
              className={`w-full rounded-t-[8px] rounded-b-[4px] ${d.day === today ? 'bg-[#7FCFB0]' : 'bg-[#BFE6D6]'}`}
              style={{ height: d.steps === null ? 0 : `${Math.max(4, ((d.steps ?? 0) / max) * 72)}%` }}
            />
            <span className={`text-[12px] ${d.day === today ? 'font-bold' : ''}`}>{WEEKDAYS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
