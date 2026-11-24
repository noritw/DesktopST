import type { JourneyMapId } from '@core/walk/items'

/** 場景座標（viewBox 390×560）。 */
export interface Point {
  x: number
  y: number
}

/** 各地圖的路線（viewBox 390×560）：`slots` 由近到遠放箱子，`home` 是路的盡頭。改圖時要一起改。 */
export interface MapRoute {
  slots: readonly { x: number; y: number }[]
  home: { x: number; y: number }
}
export const MAP_ROUTES: Record<JourneyMapId, MapRoute> = {
  dream: {
    slots: [{ x: 222, y: 467 }, { x: 291, y: 386 }, { x: 209, y: 337 }, { x: 117, y: 297 }, { x: 135, y: 217 }],
    home: { x: 224, y: 157 }
  },
  city: {
    slots: [{ x: 98, y: 465 }, { x: 213, y: 419 }, { x: 283, y: 355 }, { x: 111, y: 302 }, { x: 207, y: 237 }],
    home: { x: 258, y: 167 }
  },
  castle: {
    slots: [{ x: 120, y: 468 }, { x: 199, y: 412 }, { x: 272, y: 350 }, { x: 122, y: 298 }, { x: 95, y: 216 }],
    home: { x: 195, y: 158 }
  },
  space: {
    slots: [{ x: 132, y: 467 }, { x: 222, y: 428 }, { x: 280, y: 365 }, { x: 290, y: 283 }, { x: 244, y: 218 }],
    home: { x: 161, y: 156 }
  },
  ruins: {
    slots: [{ x: 264, y: 464 }, { x: 171, y: 439 }, { x: 103, y: 380 }, { x: 94, y: 296 }, { x: 155, y: 231 }],
    home: { x: 224, y: 166 }
  },
  station: {
    slots: [{ x: 156, y: 467 }, { x: 156, y: 386 }, { x: 156, y: 304 }, { x: 239, y: 286 }, { x: 289, y: 226 }],
    home: { x: 230, y: 162 }
  }
}

/** 隊伍走的路：從盡頭到最近處，以長度為準。 */
export interface Road {
  points: readonly Point[]
  /** 在各點時，同一排的下一位站在哪裡 */
  spread: readonly Point[]
  /** 在各點時，後一排往哪裡退 */
  back: readonly Point[]
  /** 每個點離盡頭多遠 */
  at: readonly number[]
  length: number
}

/** 往畫面中央那側站，箱子在另一側，不會被擋住。 */
const sideOf = (s: Point): number => (s.x < 195 ? 1 : -1)

export function buildRoad(r: MapRoute): Road {
  const slots = [...r.slots].reverse()
  const points = [r.home, ...slots.map((s) => ({ x: s.x + sideOf(s) * 46, y: s.y + 20 }))]
  // 最近處的另一側留給對手，隊伍改往後排
  const spread = slots.map((s, i) =>
    i === slots.length - 1 ? { x: sideOf(s) * 34, y: -34 } : { x: sideOf(s) * 48, y: -20 }
  )
  const back = slots.map((s, i) =>
    i === slots.length - 1 ? { x: sideOf(s) * -12, y: -62 } : { x: sideOf(s) * 24, y: -78 }
  )
  const at = [0]
  for (let i = 1; i < points.length; i++)
    at.push(at[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  return { points, spread: [{ x: 0, y: 0 }, ...spread], back: [{ x: 0, y: 0 }, ...back], at, length: at[at.length - 1] }
}

/** 第 i 個箱子（由近到遠）在路上的位置，0～1。 */
export function slotsOn(road: Road): number[] {
  return road.at
    .slice(1)
    .reverse()
    .map((d) => d / road.length)
}

/** 三位一排；盡頭是前一位在中間的一字排開。 */
const PER_ROW = 3
const HOME_X = [0, -54, 54, -108, 108, -162]

/** 在路上某處時，第 `rank` 位站的點。 */
export function pointAt(road: Road, distance: number, rank: number): Point {
  const row = Math.floor(rank / PER_ROW)
  const col = rank % PER_ROW
  const d = Math.max(0, Math.min(road.length, distance))
  const i = Math.max(1, road.at.findIndex((a) => a >= d))
  const t = (d - road.at[i - 1]) / (road.at[i] - road.at[i - 1])
  const stand = (n: number): Point => {
    const p = road.points[n]
    const x = n === 0 ? HOME_X[rank] : road.spread[n].x * col + road.back[n].x * row
    return { x: Math.max(50, Math.min(340, p.x + x)), y: p.y + road.spread[n].y * col + road.back[n].y * row }
  }
  const a = stand(i - 1)
  const b = stand(i)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** 兩個距離之間要經過的轉折點（不含起點，含終點）。 */
export function between(road: Road, from: number, to: number): number[] {
  const mid = road.at.filter((d) => d > Math.min(from, to) && d < Math.max(from, to))
  return [...(to < from ? mid.reverse() : mid), to]
}
