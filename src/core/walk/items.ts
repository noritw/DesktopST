/**
 * 陪伴同行的拾物（`docs/walk-items-design.md`）純邏輯。
 *
 * 程式決定品項與稀有度，LLM 只寫名稱與故事。
 */

import { buildMapItemPrompt, findMapItem } from './mapItems'
import { FORTUNES, FORTUNE_GUIDES, cleanFortune, drawFortune, drawReaction, fortuneKindAt } from './itemFortunes'

export type ItemRarity = 'common' | 'uncommon' | 'rare'
export type ItemCategory = 'glow' | 'sound' | 'ink' | 'vessel' | 'nature' | 'lost' | 'gear' | 'unknown'

/** `hint` 是給 LLM 的條件；`label` 只給畫面用。 */
export const ITEM_CATEGORIES: Record<ItemCategory, { label: string; hint: string }> = {
  glow: { label: '發光', hint: '會發光的東西' },
  sound: { label: '聲響', hint: '會響、帶著聲音的東西' },
  ink: { label: '字圖', hint: '寫了字或畫了圖的東西' },
  vessel: { label: '容器', hint: '裡面裝著什麼的東西' },
  nature: { label: '自然', hint: '石、貝、葉、羽等自然物' },
  lost: { label: '舊物', hint: '有歲月痕跡的老東西' },
  gear: { label: '零件', hint: '零件與小機關' },
  unknown: { label: '謎物', hint: '說不出是什麼的東西' }
}

// ── 過招做法（`battle.ts` 轉出口）──────────────────────

export const APPROACHES = {
  lure: '誘導',
  move: '感化',
  trap: '封鎖',
  startle: '嚇阻'
} as const
export type Approach = keyof typeof APPROACHES
export const APPROACH_IDS = Object.keys(APPROACHES) as Approach[]

const APPROACH_OF: Record<ItemCategory, Approach> = {
  glow: 'lure',
  sound: 'lure',
  ink: 'move',
  lost: 'move',
  vessel: 'trap',
  gear: 'trap',
  nature: 'startle',
  unknown: 'startle'
}
export const approachOf = (category: ItemCategory): Approach => APPROACH_OF[category]

export const ITEM_RARITIES: Record<ItemRarity, { label: string; weight: number }> = {
  common: { label: '尋常', weight: 0.7 },
  uncommon: { label: '罕見', weight: 0.25 },
  rare: { label: '奇珍', weight: 0.05 }
}

export interface ItemKind {
  id: string
  category: ItemCategory
  rarity: ItemRarity
  label: string
}

/** ⚠️ 只能往各列**尾端**加：id 由位置產生，改順序或刪除會讓既有收藏對錯品項。 */
const KIND_TABLE: Record<ItemCategory, [common: string, uncommon: string, rare: string]> = {
  glow: ['珠狀 條狀 片狀 環狀 成束 碎屑', '火苗狀 花苞狀 液態 結晶', '星芒 影中的光'],
  sound: ['搖的 敲的 吹的 撥的 轉的 殼狀', '會回聲的 會哼唱的 成對的 只響一半的', '收著人聲的 無聲的樂器'],
  ink: ['成冊的 單張的 捲起的 折起的 成條的 刻上去的', '畫了圖的 蓋了印的 殘缺的 密文的', '會改寫的 空白的'],
  vessel: ['瓶 盒 袋 罐 匣 筒', '上鎖的 層層套的 莢 透明的', '裡面比外面大的 打不開的'],
  nature: ['石 葉 貝 羽 枝 硬果', '化石 水晶 乾花 浮木', '天外石 不凋之物'],
  lost: ['鑰匙 鈕扣 織物 飾物 票證 杯具', '只剩一半的 信物 玩偶 眼鏡', '寫著名字的 還有餘溫的'],
  gear: ['齒輪 發條 螺絲 彈簧 槓桿 鉸鏈', '羅盤 鐘錶 鎖芯 鏡片', '自走的 停不下來的'],
  unknown: ['方的 圓的 長的 扁的 軟的 多孔的', '兩種觸感的 會變重的 看不到背面的 沒有影子的', '像某段時間的 好像在等人的']
}

const RARITY_ORDER: ItemRarity[] = ['common', 'uncommon', 'rare']

export const ITEM_KINDS: ItemKind[] = (Object.keys(KIND_TABLE) as ItemCategory[]).flatMap((category) =>
  KIND_TABLE[category].flatMap((row, r) =>
    row.split(' ').map((label, i) => ({
      id: `${category}-${RARITY_ORDER[r][0]}${i + 1}`,
      category,
      rarity: RARITY_ORDER[r],
      label
    }))
  )
)

const KIND_BY_ID = new Map(ITEM_KINDS.map((k) => [k.id, k]))
export const findItemKind = (id: string): ItemKind | undefined => KIND_BY_ID.get(id)

/** 撿到但還沒揭曉所需的一切；記帳當下就定案，之後不再抽。 */
export interface ItemDrop {
  id: string
  day: string
  kindId: string
  finderId: string
  finderName: string
  /** 該日記帳後的步數。只印在卡片上，不進 prompt。 */
  stepsToday: number
}

export interface ItemProgress {
  steps: number
  /** 0＝還沒抽過門檻 */
  nextDropAt: number
  dropsSinceRare: number
}

export const DROP_MIN_STEPS = 1200
export const DROP_MAX_STEPS = 2500
export const RARE_PITY = 25

export function defaultItemProgress(): ItemProgress {
  return { steps: 0, nextDropAt: 0, dropsSinceRare: 0 }
}

const rollThreshold = (random: () => number): number =>
  DROP_MIN_STEPS + Math.floor(random() * (DROP_MAX_STEPS - DROP_MIN_STEPS + 1))

const pick = <T>(list: readonly T[], random: () => number): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))]

function rollRarity(dropsSinceRare: number, random: () => number): ItemRarity {
  if (dropsSinceRare >= RARE_PITY) return 'rare'
  const r = random()
  if (r < ITEM_RARITIES.common.weight) return 'common'
  return r < ITEM_RARITIES.common.weight + ITEM_RARITIES.uncommon.weight ? 'uncommon' : 'rare'
}

export interface DropContext {
  finders: readonly { id: string; name: string }[]
  newId: () => string
  random?: () => number
}

/** 把新增步數餵進進度，跨過門檻就掉落。沒有同行角色時不累積。 */
export function advanceItemProgress(
  progress: ItemProgress,
  steps: number,
  at: { day: string; stepsToday: number },
  ctx: DropContext
): { progress: ItemProgress; drops: ItemDrop[] } {
  const random = ctx.random ?? Math.random
  if (steps <= 0 || ctx.finders.length === 0) return { progress, drops: [] }
  const next = { ...progress, steps: progress.steps + steps }
  if (next.nextDropAt <= 0) next.nextDropAt = rollThreshold(random)
  const drops: ItemDrop[] = []
  while (next.steps >= next.nextDropAt) {
    next.steps -= next.nextDropAt
    next.nextDropAt = rollThreshold(random)
    const rarity = rollRarity(next.dropsSinceRare, random)
    next.dropsSinceRare = rarity === 'rare' ? 0 : next.dropsSinceRare + 1
    const kind = pick(ITEM_KINDS.filter((k) => k.rarity === rarity), random)
    const finder = pick(ctx.finders, random)
    drops.push({
      id: ctx.newId(),
      day: at.day,
      kindId: kind.id,
      finderId: finder.id,
      finderName: finder.name,
      stepsToday: at.stepsToday
    })
  }
  return { progress: next, drops }
}

// ── 地圖 ─────────────────────────────────────────────

export const JOURNEY_MAPS = {
  dream: '夢境',
  city: '城市',
  castle: '城堡',
  space: '太空',
  ruins: '遺跡街道',
  station: '遺跡車站',
  town: '小鎮'
} as const
export type JourneyMapId = keyof typeof JOURNEY_MAPS
export const JOURNEY_MAP_IDS = Object.keys(JOURNEY_MAPS) as JourneyMapId[]

const asMapId = (v: unknown): JourneyMapId | undefined => JOURNEY_MAP_IDS.find((m) => m === v)

/** 選了就固定；沒選則每天輪替，同一天固定同一張。 */
export function journeyMapFor(selected: JourneyMapId | undefined, day: string): JourneyMapId {
  return selected ?? JOURNEY_MAP_IDS[hashOf(day) % JOURNEY_MAP_IDS.length]
}

// ── 收藏 ─────────────────────────────────────────────

export interface ItemWeather {
  description: string
  temperatureC: number
}

export interface ItemUse {
  reaction: string
  text: string
  at: number
}

export interface WalkItem extends ItemDrop {
  /** unopened：沒點開過／還沒生成成功；揭曉成功就自動收進道具欄 */
  status: 'unopened' | 'kept'
  weather?: ItemWeather
  /** 第一次打開時所在的地圖；存下來，重試才不會變 */
  map?: JourneyMapId
  name?: string
  story?: string
  place?: string
  effect?: string
  /** 這是什麼（地圖道具的固定說明） */
  look?: string
  /** 發現者留著它的理由；有這個就不顯示舊的 effect */
  why?: string
  /** 過招贏了那回合顯示 */
  move?: string
  /** 地圖道具或角色寶物的代號 */
  treasureId?: string
  treasureName?: string
  /** 揭曉時一起寫好的籤語，用了才顯示；不進對話 */
  omen?: string
  /** 使用後得到的籤語；每件只能用一次 */
  fortune?: ItemUse
  /** 上次過招出場的時間；之後休息 24 小時（`battle.ts`） */
  lastBattleAt?: number
}

export const ITEM_SORTS = {
  newest: '最新找到',
  oldest: '最早找到',
  approach: '過招效果',
  map: '地圖',
  rarity: '稀有度',
  finder: '發現者',
  name: '名稱'
} as const
export type ItemSort = keyof typeof ITEM_SORTS
export const ITEM_SORT_IDS = Object.keys(ITEM_SORTS) as ItemSort[]

/** `items` 依找到的先後；同一組內一律新的在前。 */
export function sortItems<T extends ItemDrop & { name?: string; map?: JourneyMapId }>(items: readonly T[], sort: ItemSort = 'newest'): T[] {
  if (sort === 'oldest') return [...items]
  const newest = [...items].reverse()
  const categories = Object.keys(ITEM_CATEGORIES)
  const byText = (a = '', b = ''): number => a.localeCompare(b, 'zh-Hant')
  // 稀有的在前
  const rank = (i: T): number => -RARITY_ORDER.indexOf(findItemKind(i.kindId)?.rarity ?? 'common')
  const group = (i: T): number => categories.indexOf(findItemKind(i.kindId)?.category ?? '')
  // 沒有地圖的舊物品排最後
  const place = (i: T): number => (i.map ? JOURNEY_MAP_IDS.indexOf(i.map) : JOURNEY_MAP_IDS.length)
  const how = (i: T): number => APPROACH_IDS.indexOf(approachOf(findItemKind(i.kindId)?.category ?? 'glow'))
  switch (sort) {
    case 'approach':
      return newest.sort((a, b) => how(a) - how(b) || group(a) - group(b))
    case 'map':
      return newest.sort((a, b) => place(a) - place(b))
    case 'rarity':
      return newest.sort((a, b) => rank(a) - rank(b))
    case 'finder':
      return newest.sort((a, b) => byText(a.finderName, b.finderName))
    case 'name':
      return newest.sort((a, b) => byText(a.name, b.name))
    default:
      return newest
  }
}

export interface WalkCollection {
  items: WalkItem[]
  /** 已收進來過的掉落 id：搬移重做或丟掉之後都不會再長回來 */
  seen: string[]
  /** 品項 id → 首次揭曉時間；丟掉仍保留 */
  discovered: Record<string, number>
  /** 使用者同意過「揭曉會把道具條件送給 AI」 */
  consented: boolean
  /** 使用者選的地圖；沒有＝每天輪替 */
  map?: JourneyMapId
  /** 物品頁的排序；沒有＝最新找到的在前 */
  sort?: ItemSort
}

export function defaultCollection(): WalkCollection {
  return { items: [], seen: [], discovered: {}, consented: false }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function normalizeItemProgress(raw: unknown): ItemProgress {
  if (!isObject(raw)) return defaultItemProgress()
  return { steps: num(raw.steps), nextDropAt: num(raw.nextDropAt), dropsSinceRare: num(raw.dropsSinceRare) }
}

function normalizeDrop(raw: unknown): ItemDrop | null {
  if (!isObject(raw)) return null
  const id = str(raw.id)
  const kindId = str(raw.kindId)
  const day = str(raw.day)
  if (!id || !day || !kindId || !findItemKind(kindId)) return null
  return {
    id,
    day,
    kindId,
    finderId: str(raw.finderId) ?? '',
    finderName: str(raw.finderName) ?? '',
    stepsToday: num(raw.stepsToday)
  }
}

export function normalizeDrops(raw: unknown): ItemDrop[] {
  return Array.isArray(raw) ? raw.map(normalizeDrop).filter((d): d is ItemDrop => d !== null) : []
}

function normalizeUse(raw: unknown): ItemUse | undefined {
  const text = isObject(raw) ? str(raw.text) : undefined
  return isObject(raw) && text ? { reaction: str(raw.reaction) ?? '', text, at: num(raw.at) } : undefined
}

export function normalizeCollection(raw: unknown): WalkCollection {
  const d = defaultCollection()
  if (!isObject(raw)) return d
  const items: WalkItem[] = []
  for (const r of Array.isArray(raw.items) ? raw.items : []) {
    const drop = normalizeDrop(r)
    if (!drop || !isObject(r)) continue
    // 地圖道具的名稱與說明照表：改過表（例如換掉讓人不舒服的品項）時，手上的也跟著換
    const fixed = str(r.name) ? findMapItem(str(r.treasureId)) : undefined
    const name = fixed?.name ?? str(r.name)
    const w = r.weather
    items.push({
      ...drop,
      // 舊資料的 opened（揭曉但沒按保留）一律視為已收
      status: name && (r.status === 'kept' || r.status === 'opened') ? 'kept' : 'unopened',
      weather:
        isObject(w) && typeof w.description === 'string' && typeof w.temperatureC === 'number'
          ? { description: w.description, temperatureC: w.temperatureC }
          : undefined,
      map: asMapId(r.map),
      name,
      story: str(r.story),
      place: str(r.place),
      effect: str(r.effect),
      look: fixed?.look ?? str(r.look),
      why: str(r.why),
      move: fixed?.move ?? str(r.move),
      treasureId: str(r.treasureId),
      treasureName: fixed?.name ?? str(r.treasureName),
      omen: str(r.omen),
      // 試玩期曾可用三次、存成 uses 陣列，取最後一句
      fortune: normalizeUse(r.fortune) ?? (Array.isArray(r.uses) ? normalizeUse(r.uses.at(-1)) : undefined),
      lastBattleAt: num(r.lastBattleAt) || undefined
    })
  }
  const discovered: Record<string, number> = {}
  if (isObject(raw.discovered)) for (const [k, v] of Object.entries(raw.discovered)) discovered[k] = num(v)
  return {
    items,
    seen: Array.isArray(raw.seen) ? raw.seen.filter((s): s is string => typeof s === 'string') : [],
    discovered,
    consented: raw.consented === true,
    map: asMapId(raw.map),
    sort: ITEM_SORT_IDS.find((k) => k === raw.sort)
  }
}

/** 把掉落收進收藏。以 id 去重，重做安全。 */
export function addDrops(
  c: WalkCollection,
  drops: readonly ItemDrop[],
  weatherOf: (d: ItemDrop) => ItemWeather | undefined = () => undefined
): WalkCollection {
  const seen = new Set(c.seen)
  const fresh = drops.filter((d) => !seen.has(d.id))
  if (fresh.length === 0) return c
  return {
    ...c,
    items: [...c.items, ...fresh.map((d): WalkItem => ({ ...d, status: 'unopened', weather: weatherOf(d) }))],
    seen: [...c.seen, ...fresh.map((d) => d.id)].slice(-500)
  }
}

export function patchItem(c: WalkCollection, id: string, patch: Partial<WalkItem>): WalkCollection {
  return { ...c, items: c.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }
}

export function discardItem(c: WalkCollection, id: string): WalkCollection {
  return { ...c, items: c.items.filter((i) => i.id !== id) }
}

/** 抽一句籤語並記下來；沒有名字或用過了就原樣回傳。 */
export function useItem(c: WalkCollection, id: string, now: number, random: () => number = Math.random): WalkCollection {
  const item = c.items.find((i) => i.id === id)
  if (!item?.name || item.fortune) return c
  const recent = c.items
    .flatMap((i) => i.fortune ?? [])
    .sort((a, b) => b.at - a.at)
    .slice(0, 20)
    .map((u) => u.text)
  const fortune: ItemUse = {
    reaction: drawReaction(findItemKind(item.kindId)!.category, random),
    text: item.omen ?? drawFortune(recent, random),
    at: now
  }
  return patchItem(c, id, { fortune })
}

export function applyGenerated(c: WalkCollection, id: string, text: ItemText, now: number): WalkCollection {
  const item = c.items.find((i) => i.id === id)
  // 已經有名字的不覆蓋：同一件不能重新生成
  if (!item || item.name) return c
  const mapItem = findMapItem(item.treasureId)
  // 地圖道具全照表；角色寶物名字要認得出來，理由與絕招照清單
  const fixed: Partial<WalkItem> = mapItem
    ? { name: mapItem.name, look: mapItem.look, move: mapItem.move, place: undefined, effect: undefined, why: undefined }
    : item.treasureName
    ? { name: text.name.includes(item.treasureName) ? text.name : item.treasureName, why: item.why, move: item.move, effect: undefined }
    : {}
  const next = patchItem(c, id, { ...text, ...fixed, status: 'kept' })
  const keys = mapItem ? [mapItem.id] : [item.kindId, ...(item.treasureId ? [`${item.finderId}/${item.treasureId}`] : [])]
  return { ...next, discovered: { ...c.discovered, ...Object.fromEntries(keys.map((k) => [k, c.discovered[k] ?? now])) } }
}

// ── 給模型的內容 ─────────────────────────────────────

export interface ItemText {
  name: string
  story: string
  place?: string
  effect?: string
  why?: string
  move?: string
  omen?: string
}

/** 抽象的品項直接丟給模型會寫成謎語，這裡補一句看得懂的說明。沒列的就是字面意思。 */
const KIND_HINTS: Record<string, string> = {
  'glow-c1': '像珠子的發光小物',
  'glow-c2': '細長條的發光小物',
  'glow-c3': '薄片狀的發光小物',
  'glow-c4': '圈環狀的發光小物',
  'glow-c5': '一小束會發光的細絲',
  'glow-c6': '一小把發光碎片',
  'glow-u1': '形狀像小火苗的燈',
  'glow-u2': '形狀像花苞的燈',
  'glow-u3': '裝在小瓶裡的發光液體',
  'glow-u4': '會發光的晶體',
  'glow-r1': '星形的發光寶物',
  'glow-r2': '在暗處才看得到光的寶物',
  'unknown-c1': '方形、沒人看得出用途的小物',
  'unknown-c2': '圓形、沒人看得出用途的小物',
  'unknown-c3': '細長、沒人看得出用途的小物',
  'unknown-c4': '扁平、沒人看得出用途的小物',
  'unknown-c5': '捏起來軟軟的、沒人看得出用途的小物',
  'unknown-c6': '有很多小孔、沒人看得出用途的小物',
  'unknown-u1': '一半粗糙一半光滑的小物',
  'unknown-u2': '有時輕有時重的小物',
  'unknown-u3': '怎麼翻都只看得到正面的小物',
  'unknown-u4': '照光也沒有影子的小物',
  'unknown-r1': '讓人想起某段時光的寶物',
  'unknown-r2': '像是專程等人來找的寶物'
}

/** 不分好壞的發現經過，只讓故事不要每件都像；不顯示在畫面上。 */
const ENCOUNTERS = ['一眼就看到', '差點走過頭才注意到', '繞了一小段路才遇到', '停下來休息時發現', '瞥見一點動靜，走近才找到', '跟別的東西混在一起，分開才看到']

/** 程式指定角落：讓模型自己選的話，十件有八件在公園長椅。任何世界觀都有這些地方。 */
const SPOTS = ['轉角', '樓梯下', '水邊', '大樹下', '門口', '橋邊', '牆縫', '草叢', '欄杆旁', '石階上', '窗臺下', '箱子後面']

export function hashOf(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const spotOf = (id: string): string => SPOTS[hashOf(id) % SPOTS.length]

// 由 id 決定，重試不變也不必存；除掉角落那部分，兩者才不會綁在一起
const encounterOf = (id: string): string => ENCOUNTERS[Math.floor(hashOf(id) / SPOTS.length) % ENCOUNTERS.length]

/** `moveHint`：絕招怎麼寫；清單上的寶物已有絕招，用不到。 */
export function buildItemPrompt(item: WalkItem, speakerName: string, moveHint = ''): string {
  const named = item.treasureName
  const kind = findItemKind(item.kindId)!
  const omenKind = fortuneKindAt((Math.floor(hashOf(item.id) / 936) % 100) / 100)
  const omenList = FORTUNES[omenKind]
  const omenAt = hashOf(`${item.id}!`) % omenList.length
  const omenSamples = [0, 1, 2].map((n) => `「${omenList[(omenAt + n * 5) % omenList.length]}」`).join('')
  const mapItem = findMapItem(item.treasureId)
  if (mapItem) {
    const outside = item.map === 'city' || item.map === 'town'
    return buildMapItemPrompt(
      mapItem,
      speakerName,
      `方向是${FORTUNE_GUIDES[omenKind]}。語氣像${omenSamples}，不可照抄`,
      outside && item.weather ? `${item.weather.description}，${Math.round(item.weather.temperatureC)}°C` : undefined
    )
  }
  const hint = named
    ? `${named}（${ITEM_CATEGORIES[kind.category].hint}）`
    : (KIND_HINTS[kind.id] ?? `${ITEM_CATEGORIES[kind.category].hint}，${kind.label}`)
  const lines = [
    '[找到的寶物]',
    `「${speakerName}」陪使用者散步尋寶，找到一件小寶物，現在拿給使用者看。`,
    '它一直藏在路上等人發現，**沒有主人**：不是別人掉的、忘的或擺著的，所以不要寫失主、歸還、偷拿。寶物是指讓人喜歡，不一定貴重，平凡的小東西也可以。',
    `- 東西：${hint}`,
    `- 珍貴程度：${{ common: '普通小物', uncommon: '有點特別', rare: '非常難得' }[kind.rarity]}`,
    `- 怎麼發現的：${encounterOf(item.id)}`
  ]
  if (item.weather) lines.push(`- 當時大約是${item.weather.description}，${Math.round(item.weather.temperatureC)}°C（讓東西或發現的經過看得出這個天氣，像雨天沾著水珠、晴天曬得乾乾的）`)
  if (named) lines.push(`- 為什麼留著（已經決定，另外顯示）：${item.why}`)
  lines.push(
    '',
    '第一要求是**讀的人一看就懂**：先想好一件具體、畫得出來的東西，再寫。',
    named
      ? `- 名稱：要完整寫出「${named}」，前面可以加一個看得到的特徵，不加也可以`
      : '- 名稱：普通名詞加一個看得到的特徵，像「缺了一角的藍色書籤」。不要把兩個無關的詞硬湊',
    `- 故事：「${speakerName}」當面對使用者說的話，白話，兩句，總共 60 字內。第一句說在哪裡怎麼找到、長什麼樣；第二句說看到它的反應，或當場拿它做了什麼，不要說為什麼留著`,
    '- 兩句要有因果，像真的發生過。口吻像角色卡，但不要為了有個性而拐彎抹角、打啞謎或堆比喻',
    '- 不要每次都扯到其他角色；除非東西真的跟對方有關',
    `- 地點：角色世界裡某處的「${spotOf(item.id)}」，前面加上具體是什麼地方。角色卡若只說住在電腦或程式裡，就用一般街上的地方；不要提程式、介面、桌面、預設角色`,
    ...(named
      ? []
      : [
          `- 留著：「${speakerName}」說為什麼想留著它，一句話，完全是角色卡的口氣，跟角色的個性、習慣或在意的事有關。不要重複故事`,
          `- 絕招：${moveHint || '拿它對付擋路的麻煩東西，照它真正的用途用，擋路的東西稱為「對方」'}`
        ]),
    `- 籤語：使用者用這件東西時會得到的一句話，是籤在說話，不是「${speakerName}」在說話。方向是${FORTUNE_GUIDES[omenKind]}。要從這件東西的用途或特徵聯想（例如遙控器→想換台的時候就換吧；書籤→停在這裡也沒關係，明天再翻下一頁），單獨看也懂、對誰都說得通。不寫負面、療效、投資，不指名道姓。語氣像${omenSamples}，不可照抄`,
    '- 不要屍體。奇特的性質可以有，但只要一個，並直接講明',
    '- 不要用使用者所在的真實地名，不要編使用者做了什麼，不要提步數',
    '- 繁體中文（台灣用語）',
    '',
    `只輸出下面${named ? '四' : '六'}行，每行一項，不要加其他文字：`,
    `名稱：（${named ? '14 字內' : '4～12 字'}）`,
    '故事：',
    '地點：（10 字內）',
    ...(named ? [] : ['留著：（25 字內）', '絕招：（25 字內）']),
    '籤語：（20 字內，一句）'
  )
  return lines.join('\n')
}

/** 解析失敗回 `null`，呼叫端視為生成失敗、可重試。`fixedName`：名稱已定，回覆裡沒有。 */
export function parseItemReply(raw: string, fixedName?: string): ItemText | null {
  const text = raw.replace(/\r/g, '')
  const field = (label: string): string => {
    const m = text.match(
      new RegExp(`(?:^|\\n)[\\s>*#-]*${label}[\\s*]*[：:][\\s*]*([\\s\\S]*?)(?=\\n[\\s>*#-]*(?:名稱|故事|地點|效果|留著|絕招|籤語)[\\s*]*[：:]|$)`)
    )
    return (m?.[1] ?? '').replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim()
  }
  const name = fixedName ?? field('名稱').replace(/^[「『《【（(]+|[」』》】）)。]+$/g, '').slice(0, 20)
  const story = field('故事').slice(0, 400)
  if (!name || !story) return null
  return {
    name,
    story,
    place: field('地點').slice(0, 80) || undefined,
    effect: field('效果').slice(0, 120) || undefined,
    why: field('留著').replace(/^「([^「」]*)」$/, '$1').slice(0, 80) || undefined,
    move: field('絕招').replace(/^「([^「」]*)」$/, '$1').replace(/。$/, '').slice(0, 80) || undefined,
    omen: cleanFortune(field('籤語'))
  }
}

/** 「聊聊這個」送進對話的文字。 */
export function buildItemTalkMessage(item: WalkItem): string {
  const lines = [`聊聊這件寶物吧。`, `【${item.name}】${item.finderName ? `（${item.finderName}找到的）` : ''}`, item.story ?? '']
  if (item.look && item.map) lines.push(`（在${JOURNEY_MAPS[item.map]}的箱子裡找到的。${item.look}）`)
  const note = item.why ?? item.effect
  if (note) lines.push(note)
  if (item.fortune) lines.push(`用了它，得到一句：「${item.fortune.text}」`)
  return lines.filter(Boolean).join('\n')
}
