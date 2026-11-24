/**
 * 今日旅途的美術（Codex 繪製的原創向量色塊）。
 *
 * 用 `?raw` 轉成 data URI：手機產物必須是單一自足 HTML，不能有外部檔案。
 */
import type { ItemCategory, JourneyMapId } from '@core/walk/items'
import sceneDream from './art/scene-dream.svg?raw'
import sceneCity from './art/scene-city.svg?raw'
import sceneCastle from './art/scene-castle.svg?raw'
import sceneSpace from './art/scene-space.svg?raw'
import sceneRuins from './art/scene-ruins.svg?raw'
import sceneStation from './art/scene-station.svg?raw'
import glow from './art/icon-glow.svg?raw'
import sound from './art/icon-sound.svg?raw'
import ink from './art/icon-ink.svg?raw'
import vessel from './art/icon-vessel.svg?raw'
import nature from './art/icon-nature.svg?raw'
import lost from './art/icon-lost.svg?raw'
import gear from './art/icon-gear.svg?raw'
import unknown from './art/icon-unknown.svg?raw'
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

export const MAP_ART: Record<JourneyMapId, string> = {
  dream: uri(sceneDream),
  city: uri(sceneCity),
  castle: uri(sceneCastle),
  space: uri(sceneSpace),
  ruins: uri(sceneRuins),
  station: uri(sceneStation)
}

/** 還沒揭曉的紙箱，素色四款、單一圖案四款，只是變化，與內容、稀有度無關。 */
export const BOX_ICONS = [boxA, boxB, boxC, boxD, boxE, boxF, boxG, boxH].map(uri)

export function boxIconFor(itemId: string): string {
  return BOX_ICONS[hash(itemId) % BOX_ICONS.length]
}

export const CATEGORY_ICONS: Record<ItemCategory, string> = {
  glow: uri(glow),
  sound: uri(sound),
  ink: uri(ink),
  vessel: uri(vessel),
  nature: uri(nature),
  lost: uri(lost),
  gear: uri(gear),
  unknown: uri(unknown)
}
