import { useEffect, useMemo, useState } from 'react'
import {
  APPROACHES,
  APPROACH_IDS,
  HAND_SIZE,
  MIN_ITEMS,
  approachOf,
  battlePool,
  restText,
  suggestHand,
  type Approach
} from '@core/walk/battle'
import { findItemKind, sortItems, type WalkCollection, type WalkItem } from '@core/walk/items'
import { APPROACH_ICONS } from './art'

/** 開打前選出場的物品（`docs/walk-battle-design.md` §4.2）。 */

const PRIMARY = 'w-full rounded-full bg-[var(--mint2)] px-4 py-3 text-[15px] font-medium text-[var(--text)] disabled:opacity-45'
const SECONDARY = 'w-full rounded-full bg-[var(--bg)] px-4 py-2.5 text-[14px] text-[var(--text)] disabled:opacity-45'

const approachOfItem = (i: WalkItem): Approach => approachOf(findItemKind(i.kindId)!.category)

export function BattlePicker({
  collection,
  known,
  busy,
  onStart,
  onBack
}: {
  collection: WalkCollection
  /** 已經知道的弱點；「幫我選」也只看得到這些 */
  known: readonly Approach[]
  busy: boolean
  onStart: (ids: string[]) => void
  onBack: () => void
}): JSX.Element {
  const [filter, setFilter] = useState<Approach | null>(null)
  const [chosen, setChosen] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const sorted = useMemo(() => sortItems(collection.items.filter((i) => i.name), collection.sort), [collection])
  const readyIds = new Set(battlePool(collection.items, now).map((i) => i.id))
  const ready = sorted.filter((i) => readyIds.has(i.id))
  const resting = sorted.filter((i) => !readyIds.has(i.id))
  const shown = (list: WalkItem[]): WalkItem[] => (filter ? list.filter((i) => approachOfItem(i) === filter) : list)
  // 挑的時候有物品被丟掉或時鐘變了，就不算
  const picked = chosen.filter((id) => readyIds.has(id))
  const full = picked.length >= HAND_SIZE

  const toggle = (id: string): void =>
    setChosen(picked.includes(id) ? picked.filter((x) => x !== id) : full ? picked : [...picked, id])

  const row = (i: WalkItem, rests: boolean): JSX.Element => {
    const on = picked.includes(i.id)
    const a = approachOfItem(i)
    return (
      <button
        key={i.id}
        type="button"
        aria-pressed={on}
        disabled={rests || (full && !on)}
        onClick={() => toggle(i.id)}
        className={`flex items-center gap-3 rounded-[18px] border-2 bg-[var(--bg)] px-3 py-2 text-left text-[var(--text)] disabled:opacity-55 ${
          on ? 'border-[var(--mint2)]' : 'border-transparent'
        }`}
      >
        <img src={APPROACH_ICONS[a]} alt="" className="h-9 w-9 shrink-0 rounded-full bg-[#FFFDF4] p-1" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug">{i.name}</span>
          <span className="block text-[12px] text-[var(--text-sub)]">{rests ? restText(i.lastBattleAt, now) : `${i.finderName}找到的`}</span>
        </span>
        <span className="shrink-0 text-right text-[12px]">
          <span className="block rounded-full bg-[var(--surface)] px-3 py-1 text-center text-[13px]">{APPROACHES[a]}</span>
          {on && <span className="block pt-0.5 font-bold">已選</span>}
        </span>
      </button>
    )
  }

  const readyShown = shown(ready)
  const restingShown = shown(resting)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      <p className="text-center text-[14px] text-[var(--text)]">
        三回合怕：{APPROACHES[known[0]]} → {APPROACHES[known[1]]} → ？
      </p>
      <div className="flex shrink-0 flex-wrap gap-1" role="group" aria-label="依做法篩選">
        {[null, ...APPROACH_IDS].map((a) => (
          <button
            key={a ?? 'all'}
            type="button"
            aria-pressed={filter === a}
            onClick={() => setFilter(a)}
            className={`whitespace-nowrap rounded-full px-2.5 py-2 text-[12px] text-[var(--text)] ${filter === a ? 'bg-[var(--mint)] font-medium' : 'bg-[var(--bg)]'}`}
          >
            {a ? APPROACHES[a] : '全部'} {a ? ready.filter((i) => approachOfItem(i) === a).length : ready.length}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
        {readyShown.map((i) => row(i, false))}
        {readyShown.length === 0 && <p className="py-6 text-center text-[13px] text-[var(--text-sub)]">這類沒有能出場的物品</p>}
        {restingShown.length > 0 && <p className="pt-2 text-[13px] text-[var(--text-sub)]">休息中</p>}
        {restingShown.map((i) => row(i, true))}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <button type="button" className={SECONDARY} onClick={onBack}>返回</button>
        <button
          type="button"
          className={SECONDARY}
          onClick={() => setChosen(suggestHand(collection.items, known, Date.now(), picked))}
          disabled={full}
        >
          幫我選
        </button>
        <button
          type="button"
          className={`${PRIMARY} col-span-2`}
          disabled={busy || picked.length < MIN_ITEMS}
          onClick={() => onStart(picked)}
        >
          {picked.length < MIN_ITEMS
            ? `已選 ${picked.length} 件，至少選 ${MIN_ITEMS} 件`
            : `用這 ${picked.length} 件開始（最多 ${HAND_SIZE} 件）`}
        </button>
      </div>
    </div>
  )
}
