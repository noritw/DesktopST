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

/** 圖示代表過招效果；一件一圖之後再補。 */
export const APPROACH_ICONS: Record<Approach, string> = {
  lure: icon('<path d="M22 86q10-44 48-40" fill="none" stroke="#5E9AA8" stroke-width="11"/><path d="M62 24l34 23-34 23z" fill="#8FC4CF" stroke="#5E9AA8" stroke-width="6"/><circle cx="24" cy="98" r="8" fill="#5E9AA8"/><circle cx="48" cy="98" r="5" fill="#8FC4CF"/>'),
  move: icon('<path d="M60 100C18 72 14 52 20 38c8-18 32-18 40 0 8-18 32-18 40 0 6 14 2 34-40 62z" fill="#F3B6BC" stroke="#CF7F88" stroke-width="7"/><path d="M36 44q4-8 12-6" fill="none" stroke="#FFFDF4" stroke-width="6"/>'),
  trap: icon('<path d="M20 100V58a40 40 0 0 1 80 0v42z" fill="#F7E3A8"/><path d="M20 100V58a40 40 0 0 1 80 0v42zM47 100V21M73 100V21M20 62h80" fill="none" stroke="#B9934B" stroke-width="7"/>'),
  startle: icon('<path d="M60 10l12 20 22-10-2 24 22 6-16 18 14 20-24 2-2 24-20-14-20 14-4-24-22-4 14-18L14 50l22-6-2-24 20 10z" fill="#CDB9E8" stroke="#8E74B8" stroke-width="6"/><path d="M60 38v28" stroke="#5E4A85" stroke-width="10"/><circle cx="60" cy="83" r="6" fill="#5E4A85"/>')
}
