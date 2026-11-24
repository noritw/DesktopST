import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Trip } from '@core/walk/journey'
import { useAvatarUrl } from '../characters/useAvatarUrl'
import { Avatar } from '../characters/Avatar'
import { between, pointAt, type Point, type Road } from './road'

const SCENE = { w: 390, h: 560 }
const MS_PER_UNIT = 6
const FOLLOW_DELAY_MS = 220

/** 走近時稍微變大，遠近才合理。 */
const scaleAt = (y: number): number => 1 + Math.max(0, Math.min(1, (y - 160) / 300)) * 0.35

function frame(p: Point): Keyframe {
  return {
    left: `${(p.x / SCENE.w) * 100}%`,
    top: `${(p.y / SCENE.h) * 100}%`,
    transform: `translate(-50%, -100%) scale(${scaleAt(p.y)})`,
    zIndex: Math.round(p.y)
  }
}

/** 畫面上現在的腳底位置。 */
function whereIs(el: HTMLElement): Point | null {
  const scene = el.parentElement
  if (!scene?.clientWidth) return null
  return { x: (el.offsetLeft / scene.clientWidth) * SCENE.w, y: (el.offsetTop / scene.clientHeight) * SCENE.h }
}

export interface PartyTrip extends Trip {
  seq: number
}

/** 站在旅途上的角色，腳底落在路上；`rank` 0 走最前面。 */
export function Companion({
  id,
  name,
  road,
  rank,
  trip,
  played,
  onArrive
}: {
  id: string
  name: string
  road: Road
  rank: number
  trip: PartyTrip
  /** 已經走完的那一趟；之後才出現的角色直接站到終點 */
  played: number
  onArrive: (seq: number) => void
}): JSX.Element {
  const url = useAvatarUrl(id)
  const ref = useRef<HTMLDivElement>(null)
  const onRoad = (p: number): number => p * road.length
  const end = onRoad(trip.stops.length ? trip.stops[trip.stops.length - 1] : trip.start)
  const settled = played >= trip.seq
  /** 目前離盡頭多遠 */
  const current = useRef(settled ? end : onRoad(trip.start))
  const doneSeq = useRef(settled ? trip.seq : -1)
  const arrive = useRef(onArrive)
  arrive.current = onArrive
  const [walking, setWalking] = useState(false)

  // 位置只由這裡寫，React 重畫不會蓋掉
  useLayoutEffect(() => {
    if (ref.current) Object.assign(ref.current.style, frame(pointAt(road, current.current, rank)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const seq = trip.seq
    const targets = doneSeq.current !== seq && trip.stops.length ? trip.stops.map(onRoad) : [end]
    const done = (): void => {
      current.current = end
      doneSeq.current = seq
      Object.assign(el.style, frame(pointAt(road, end, rank)))
      setWalking(false)
      if (rank === 0) arrive.current(seq)
    }

    const way = [current.current]
    for (const t of targets) way.push(...between(road, way[way.length - 1], t))
    // 從畫面上真正的位置出發：換到隊伍別的順位時才不會跳一格
    const points = way.map((d) => pointAt(road, d, rank))
    points[0] = whereIs(el) ?? points[0]
    const run = [0]
    for (let i = 1; i < way.length; i++)
      run.push(run[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
    const total = run[run.length - 1]
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (total < 1 || reduced || typeof el.animate !== 'function') {
      done()
      return
    }

    const delay = rank * FOLLOW_DELAY_MS
    const starting = setTimeout(() => setWalking(true), delay)
    const anim = el.animate(
      points.map((p, i) => ({ ...frame(p), offset: run[i] / total })),
      { delay, duration: Math.max(450, Math.min(3200, total * MS_PER_UNIT)), easing: 'linear' }
    )
    anim.onfinish = done
    return () => {
      // 被打斷時停在半路，下一段從這裡接著走
      clearTimeout(starting)
      const progress = anim.playState === 'finished' ? null : anim.effect?.getComputedTiming().progress
      if (typeof progress === 'number') {
        const gone = progress * total
        const i = Math.max(1, run.findIndex((r) => r >= gone))
        const t = (gone - run[i - 1]) / (run[i] - run[i - 1] || 1)
        current.current = way[i - 1] + (way[i] - way[i - 1]) * t
        const at = whereIs(el)
        if (at) Object.assign(el.style, frame(at))
      }
      anim.onfinish = null
      anim.cancel()
      setWalking(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.seq, rank, road])

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute flex items-end justify-center"
      style={{ height: '16%', transformOrigin: '50% 100%' }}
    >
      <div className={`flex h-full items-end ${walking ? 'anim-journey-walk' : 'anim-journey-idle'}`}>
        {url ? (
          <img src={url} alt={name} className="h-full w-auto max-w-[110px] object-contain object-bottom" />
        ) : (
          <Avatar characterId={id} size={64} />
        )}
      </div>
    </div>
  )
}
