/**
 * 今日旅途的美術（Codex 繪製的原創向量色塊）。
 *
 * 用 `?raw` 轉成 data URI：手機產物必須是單一自足 HTML，不能有外部檔案。
 */
import type { Approach, JourneyMapId } from '@core/walk/items'
import sceneDream from './art/scene-dream.svg?raw'
import sceneCity from './art/scene-city.svg?raw'
import sceneTown from './art/scene-town.svg?raw'
import sceneCastle from './art/scene-castle.svg?raw'
import sceneSpace from './art/scene-space.svg?raw'
import sceneRuins from './art/scene-ruins.svg?raw'
import sceneStation from './art/scene-station.svg?raw'
import boxA from './art/box-a.svg?raw'
import boxB from './art/box-b.svg?raw'
import boxC from './art/box-c.svg?raw'
import boxD from './art/box-d.svg?raw'
import boxE from './art/box-e.svg?raw'
import boxF from './art/box-f.svg?raw'
import boxG from './art/box-g.svg?raw'
import boxH from './art/box-h.svg?raw'

function hash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const uri = (svg: string): string => `data:image/svg+xml,${encodeURIComponent(svg)}`

const icon = (body: string): string =>
  uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)

export const MAP_ART: Record<JourneyMapId, string> = {
  dream: uri(sceneDream),
  city: uri(sceneCity),
  castle: uri(sceneCastle),
  space: uri(sceneSpace),
  ruins: uri(sceneRuins),
  station: uri(sceneStation),
  town: uri(sceneTown)
}

/** 還沒揭曉的紙箱，素色四款、單一圖案四款，只是變化，與內容、稀有度無關。 */
export const BOX_ICONS = [boxA, boxB, boxC, boxD, boxE, boxF, boxG, boxH].map(uri)

export function boxIconFor(itemId: string): string {
  return BOX_ICONS[hash(itemId) % BOX_ICONS.length]
}

/** 過招效果的底色：圖形一律白色，靠底色分辨（設計稿 2026-11-27，Codex 繪製）。 */
export const APPROACH_COLORS: Record<Approach, string> = {
  lure: '#78B5A4',
  move: '#D68FA4',
  trap: '#7EAACB',
  startle: '#AA94CD'
}

const approachIcon = (a: Approach, shape: string): string =>
  icon(`<circle cx="60" cy="60" r="60" fill="${APPROACH_COLORS[a]}"/><g fill="#FFFFFF">${shape}</g>`)

/** 圖示代表過招效果：粉彩圓底＋白色圖形。 */
export const APPROACH_ICONS: Record<Approach, string> = {
  lure: approachIcon('lure', '<g transform="translate(-3 -7) scale(1.2)"><path d="M25 60C27 45 38 37 56 37H61V28Q61 24 65 27L81 41Q85 44 81 47L65 61Q61 64 61 60V51H56C46 51 41 54 39 60Z"/><circle cx="32" cy="78" r="9"/></g>'),
  move: approachIcon('move', '<g transform="translate(-2 0) scale(1.2)"><path d="M39 78C34 76 17 63 17 49C17 36 31 31 39 42C47 31 61 36 61 49C61 63 44 76 39 78Z"/><path d="M72 49C69 48 59 40 59 32C59 23 68 20 72 27C77 20 86 23 86 32C86 40 75 48 72 49Z"/></g>'),
  trap: approachIcon('trap', '<g transform="translate(0 4) scale(1.2)"><path fill-rule="evenodd" d="M41 26V23C41 11 59 11 59 23V26H65Q79 26 79 40V73Q79 80 72 80H28Q21 80 21 73V40Q21 26 35 26ZM47 26H53V23C53 19 47 19 47 23ZM30 40V69Q30 72 33 72H37V35H35Q30 35 30 40ZM45 35V72H55V35ZM63 35V72H68Q70 72 70 69V40Q70 35 65 35Z"/></g>'),
  startle: approachIcon('startle', '<g transform="translate(-4 0) scale(1.2)"><g transform="translate(5 8) scale(.82)"><path d="M29 26Q28 21 33 20L38 19Q43 18 44 23L48 53Q49 58 44 59Q39 60 38 55Z"/><circle cx="47" cy="73" r="7"/></g><path transform="translate(-14 -10) scale(1.25)" d="M71 25Q77 21 75 28L70 43H81Q86 43 82 48L62 72Q57 77 59 70L63 55H55Q50 55 53 50Z"/></g>')
}
