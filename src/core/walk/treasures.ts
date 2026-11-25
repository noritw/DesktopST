import { APPROACHES, approachOf, type Approach } from './battle'
import { ITEM_CATEGORIES, type ItemCategory, type ItemRarity } from './items'

/**
 * 角色專屬的寶物清單：每位 24 種，各有「為什麼留著」與絕招（`docs/walk-items-design.md` §15.8）。
 * 預設角色用內建清單；其他角色由使用者決定要不要依角色卡寫一份。
 */

export const TREASURE_WEATHERS = ['晴', '雨', '陰', '冷', '熱'] as const
export type TreasureWeather = (typeof TREASURE_WEATHERS)[number]

export interface Treasure {
  category: ItemCategory
  rarity: ItemRarity
  name: string
  /** 角色說的一句話；把跟這個角色的關聯直接講給玩家聽 */
  why: string
  /** 一句話說怎麼用，過招與「使用」共用 */
  move: string
  /** 只在這種天氣比較容易找到；沒有＝任何天氣 */
  weather?: TreasureWeather
}

export type TreasureList = Record<string, Treasure>

export interface TreasureSlot {
  id: string
  category: ItemCategory
  rarity: ItemRarity
}

const RARITIES: [ItemRarity, string][] = [['common', 'c'], ['uncommon', 'u'], ['rare', 'r']]

/** ⚠️ id 由分類、稀有度、序號組成，存進收藏後不可改；要增加只往後加序號。 */
export const TREASURE_SLOTS: readonly TreasureSlot[] = (Object.keys(ITEM_CATEGORIES) as ItemCategory[]).flatMap((category) =>
  RARITIES.map(([rarity, letter]) => ({ id: `${category}-${letter}1`, category, rarity }))
)

const SLOT_BY_ID = new Map(TREASURE_SLOTS.map((s) => [s.id, s]))

/** 少於這個數就視為失敗 */
export const MIN_TREASURES = 18
export const TREASURE_MAX_RESPONSE_TOKENS = 2500

const MOVE_HINTS: Record<Approach, string> = {
  lure: '把對方的注意力引到別的地方',
  move: '讓對方心軟或愣住',
  trap: '讓對方卡住',
  startle: '讓對方嚇一跳'
}

const moveRule = (name: string): string =>
  `讓人一看就懂怎麼做到的。普通東西照它真正的用途和性質用，真有魔法的東西才會有神奇效果。想不出合理的用法就不要硬扯，改寫成角色用自己的本事出手（例如會魔法的：「使出冰柱魔法，把對方逼退」）。**做法要像「${name}」會做的事、會說的話**：先想這個角色遇到麻煩會怎麼反應，冷淡的不會殷勤招待，直率的不會拐彎。不寫角色名字，主詞空著，直接從動作寫起；擋路的東西稱為「對方」`

/** 打開箱子當下才想的物品，絕招照同一套規則寫。 */
export function moveGuide(approach: Approach, name: string): string {
  return `拿它對付擋路的麻煩東西（不一定有手腳），做法是「${APPROACHES[approach]}」，${MOVE_HINTS[approach]}。${moveRule(name)}。寫法像「擺上空杯，說『要喝茶自己泡』，對方就去找茶壺了」「深吸一口氣猛吹，吹到第三次才響，嗚地嚇退對方」，不可照抄。東西不會用掉，絕招不傷人`
}

export function buildTreasurePrompt(name: string, samples: string): string {
  return [
    '[寶物清單]',
    `「${name}」陪使用者散步時會找到小寶物。請列出 24 種看到就會覺得「${name}」會喜歡的東西。`,
    '東西本身可以很普通，像咖啡杯、雨傘、小石頭；也可以來自角色的職業、世界、興趣。跟角色的關聯放在「為什麼留著」和絕招，用角色的個性、習慣、在意的事來寫。有的普通、有的特別，混著來。',
    '可以有 1～3 種願意跟著走的小夥伴，像使魔、召喚獸、小精靈，依角色的世界決定要不要。',
    '',
    '每種五欄：',
    '- 代號',
    '- 名稱：一眼看得懂的具體東西，2～10 字',
    `- 為什麼留著：「${name}」說的一句話，25 字內，完全是角色卡的口氣，把特徵演出來`,
    `- 絕招：拿它對付擋路的麻煩東西（可能是一團線、刺球、石塊、霧、一大疊東西、亂跳的球，**不一定有手腳和衣服**），25 字內，${moveRule(name)}`,
    '- 天氣：任意、晴、雨、陰、冷、熱 選一個。6～10 種要寫成特定天氣才會找到的東西，像雨天的青苔、晴天曬乾的小石頭；其他寫任意',
    '',
    '分類與絕招做法：',
    ...(Object.keys(ITEM_CATEGORIES) as ItemCategory[]).map((c) => {
      const a = approachOf(c)
      return `- ${c}：${ITEM_CATEGORIES[c].hint}；${APPROACHES[a]}，${MOVE_HINTS[a]}`
    }),
    '代號 c 平常、u 有點特別、r 這個角色會珍惜一輩子。',
    '',
    '規則：',
    '- 名稱不重複',
    '- 不要編使用者做過什麼、送過什麼、說過什麼；可以對使用者說話，但不寫共同回憶。稱使用者一律用「你」',
    '- 真的有關才提其他角色',
    '- 東西沒有主人。絕招不傷人。不寫屍體、生病、死亡、血腥、真實品牌、真實地名',
    '- 不提預設角色、骰子、步數',
    '- 繁體中文（台灣用語），白話好懂，不要詩意或打啞謎',
    '',
    '寫法範例（只參考怎麼寫，東西、台詞和絕招都要依自己的角色重想，不可照抄）：',
    samples,
    '',
    '只輸出 24 行，每行用全形直線分成五欄，不要編號、不要加其他文字：',
    '代號｜名稱｜為什麼留著｜絕招｜天氣',
    `代號依序是：${TREASURE_SLOTS.map((s) => s.id).join('、')}`
  ].join('\n')
}

const clean = (s: string): string => s.replace(/\*\*/g, '').trim()
const within = (s: string, min: number, max: number): boolean => s.length >= min && s.length <= max

/** 逐行解析，壞的略過。 */
export function toTreasureList(raw: string): TreasureList {
  const list: TreasureList = {}
  const names = new Set<string>()
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const cols = line.split(/[｜|]/).map(clean).filter(Boolean)
    if (cols.length < 4 || cols.length > 5) continue
    const slot = SLOT_BY_ID.get(cols[0].match(/[a-z]+-[cur]\d/i)?.[0].toLowerCase() ?? '')
    if (!slot || list[slot.id]) continue
    const name = cols[1].replace(/^[「『【]+|[」』】]+$/g, '')
    const why = cols[2]
    const move = cols[3].replace(/。$/, '')
    if (!within(name, 2, 16) || !within(why, 2, 50) || !within(move, 4, 50) || names.has(name)) continue
    names.add(name)
    const weather = TREASURE_WEATHERS.find((w) => w === cols[4])
    list[slot.id] = { category: slot.category, rarity: slot.rarity, name, why, move, ...(weather ? { weather } : {}) }
  }
  return list
}

/** 有效的太少回 `null`，呼叫端視為失敗、可重試。 */
export function parseTreasureReply(raw: string): TreasureList | null {
  const list = toTreasureList(raw)
  return Object.keys(list).length >= MIN_TREASURES ? list : null
}
