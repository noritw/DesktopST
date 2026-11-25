import { approachOf } from './battle'
import { BUILTIN_TREASURES } from './builtinTreasures'
import { MAP_ITEMS, kindIdOf } from './mapItems'
import { findItemKind, hashOf, patchItem, type ItemWeather, type JourneyMapId, type WalkCollection, type WalkItem } from './items'
import { TREASURE_SLOTS, moveGuide, type Treasure, type TreasureWeather } from './treasures'

/** 打開箱子時定下是哪一件：地圖的道具表，奇珍偶爾是角色的專屬寶物（`docs/walk-items-design.md` §15.14）。 */

export function weatherTags(w: ItemWeather | undefined): TreasureWeather[] {
  if (!w) return []
  const d = w.description
  const tags: TreasureWeather[] = []
  if (/雨|雷|rain|shower|thunder|drizzle/i.test(d)) tags.push('雨')
  else if (/晴|sun|clear/i.test(d)) tags.push('晴')
  if (/陰|雲|霧|cloud|overcast|fog|mist/i.test(d)) tags.push('陰')
  if (w.temperatureC <= 16) tags.push('冷')
  if (w.temperatureC >= 30) tags.push('熱')
  return tags
}

/** 奇珍有機會是角色的專屬寶物 */
const OWN_RARE_ONE_IN = 3

/** 定下地圖與道具；定了就不變，重試也一樣。 */
export function prepareReveal(c: WalkCollection, id: string, map?: JourneyMapId): WalkCollection {
  const item = c.items.find((i) => i.id === id)
  const at = item?.map ?? map
  if (!item || item.name || item.treasureId || !at) return c
  const rarity = findItemKind(item.kindId)!.rarity
  const h = hashOf(`${id}#`)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(h / OWN_RARE_ONE_IN) % list.length]

  if (rarity === 'rare' && h % OWN_RARE_ONE_IN === 0 && at !== 'ruins' && at !== 'station') {
    const own = ownRare(c, item)
    if (own.length > 0) {
      const [slotId, t] = pick(own)
      // 清單的代號也是合法的 kindId，做法跟著它
      return patchItem(c, id, { map: at, kindId: slotId, treasureId: slotId, treasureName: t.name, why: t.why, move: t.move })
    }
  }

  // 沒找過的先出；全找過就挑手上最少的，免得一直重複同一件
  const pool = MAP_ITEMS.filter((i) => i.map === at && i.rarity === rarity)
  const held = (tid: string): number => c.items.filter((i) => i.treasureId === tid).length
  const fresh = pool.filter((i) => !c.discovered[i.id] && held(i.id) === 0)
  const fewest = Math.min(...pool.map((i) => held(i.id)))
  const t = pick(fresh.length > 0 ? fresh : pool.filter((i) => held(i.id) === fewest))
  return patchItem(c, id, { map: at, kindId: kindIdOf(t), treasureId: t.id, treasureName: t.name, look: t.look, move: t.move })
}

function ownRare(c: WalkCollection, item: WalkItem): [string, Treasure][] {
  const list = BUILTIN_TREASURES[item.finderName.trim()]
  if (!list) return []
  const tags = weatherTags(item.weather)
  const taken = new Set(c.items.filter((i) => i.finderId === item.finderId).map((i) => i.treasureId))
  return TREASURE_SLOTS.flatMap((s): [string, Treasure][] => {
    const t = list[s.id]
    const ok =
      t && s.rarity === 'rare' && !taken.has(s.id) && (!t.weather || tags.includes(t.weather)) && !c.discovered[`${item.finderId}/${s.id}`]
    return ok ? [[s.id, t]] : []
  })
}

/** 即時生成時，絕招怎麼寫。 */
export function liveMoveGuide(kindId: string, name: string): string {
  return moveGuide(approachOf(findItemKind(kindId)!.category), name)
}
