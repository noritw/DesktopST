import { computeRandomResult } from '../random/dice'
import { findItemKind, type ItemCategory, type WalkItem } from './items'

/**
 * 今日旅途的三回合過招（`docs/walk-battle-design.md`）純邏輯。
 *
 * 狀態轉換都是「不合法就原樣回傳」：連點、重做、過期的請求因此安全。
 * ⚠️ 骰子結果要先存檔再演出，否則重開 App 就能重骰。
 */

// ── 做法與對手的形 ───────────────────────────────────

export const APPROACHES = {
  lure: '引開',
  move: '打動',
  trap: '困住',
  startle: '嚇一跳'
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

export interface FoeText {
  name: string
  intro: string
  perfect: string
  win: string
  draw: string
}

/**
 * 圖是共用的形，內容由主角的角色卡決定；`fallback` 是還沒有角色專屬內容時用的。
 * ⚠️ 只能往尾端加，id 不重用。
 */
const FOE_FORM_TABLE = {
  tangle: {
    hint: '纏住、糾結、怎麼理都理不清的東西',
    fallback: {
      name: '打結的線團',
      intro: '前面有一團線纏住了路，我們來想想辦法。',
      perfect: '線團一圈一圈鬆開，變成一條整齊的線。原來它只是想被好好理一理。',
      win: '線團鬆開了一半，自己滾到路邊去。這樣就過得去了。',
      draw: '線團玩累了，自己滾走了。我們也坐下來歇一會兒吧。'
    }
  },
  spike: {
    hint: '很兇、很吵、碰到就刺人的東西',
    fallback: {
      name: '炸毛的刺團',
      intro: '有一團東西炸著毛擋在路上，看起來心情不太好。',
      perfect: '刺團的毛一根一根軟下來，變成蓬蓬的一球。摸起來意外地舒服。',
      win: '刺團收起了刺，哼了一聲讓到旁邊。看來它氣消了。',
      draw: '刺團吵到口渴，自己跑去喝水了。我們也喝口水吧。'
    }
  },
  slab: {
    hint: '很重、擋路、搬不動的東西',
    fallback: {
      name: '愛睏的石塊',
      intro: '好大一塊石頭在路中間打瞌睡，叫都叫不動。',
      perfect: '石塊伸了個大懶腰，精神飽滿地跳到路邊。它還幫我們把路踩平了。',
      win: '石塊打了個呵欠，慢慢挪開了。剛好讓出一條路。',
      draw: '石塊翻個身，順著坡滾去別的地方睡了。看得我也想打個盹。'
    }
  },
  fog: {
    hint: '模糊、看不透、讓人分心的東西',
    fallback: {
      name: '瞇眼的霧',
      intro: '霧裡有一雙眼睛，一直盯著我們看。',
      perfect: '霧散得乾乾淨淨，前面的景色全都看見了。好漂亮。',
      win: '霧眨眨眼睛，慢慢飄開了。路又看得清楚了。',
      draw: '霧看膩了，自己飄去看別的。我們慢慢走，不用急。'
    }
  },
  pile: {
    hint: '一直堆高、做不完的東西',
    fallback: {
      name: '歪歪的大疊',
      intro: '這一大疊東西越堆越高，快要倒下來了。',
      perfect: '整疊東西自己排得整整齊齊，還讓出一張椅子。坐一下吧。',
      win: '大疊矮了一截，搖搖晃晃走開了。看起來輕鬆多了。',
      draw: '大疊覺得這裡太擠，自己搬去別處了。我們剛好有地方休息。'
    }
  },
  bounce: {
    hint: '停不下來、到處跑、抓不住的東西',
    fallback: {
      name: '亂跳的球',
      intro: '有顆球在路上跳來跳去，怎麼都停不下來。',
      perfect: '球跳了最後一下，穩穩停在我們面前。它好像很開心。',
      win: '球越跳越小步，最後自己滾走了。路上安靜下來了。',
      draw: '球跳得太高，跳到別條路上去了。看它跳也滿好玩的。'
    }
  }
} as const satisfies Record<string, { hint: string; fallback: FoeText }>

export type FoeFormId = keyof typeof FOE_FORM_TABLE
export const FOE_FORMS: Record<FoeFormId, { hint: string; fallback: FoeText }> = FOE_FORM_TABLE
export const FOE_FORM_IDS = Object.keys(FOE_FORM_TABLE) as FoeFormId[]

// ── 資料 ─────────────────────────────────────────────

export const ROUND_COUNT = 3
export const HAND_SIZE = 5
export const MIN_ITEMS = 3
export const WIN_FACE = 4
export const REST_MS = 24 * 60 * 60 * 1000
export const APPEAR_MIN = 3
export const APPEAR_MAX = 5
export const LOG_LIMIT = 20

export type BattleItem = Pick<WalkItem, 'id' | 'kindId' | 'name' | 'finderId' | 'finderName' | 'lastBattleAt'>

export interface Person {
  id: string
  name: string
}

/** 發牌當下的快照：物品之後被丟掉，這一場仍能打完。 */
export interface HandItem {
  itemId: string
  name: string
  category: ItemCategory
  finderId: string
  finderName: string
}

export interface BattleRound {
  /** 出場時間；重擲不改，物品的休息從這裡起算 */
  at: number
  itemId: string
  /** 一顆，或做法對時兩顆取高 */
  rolls: number[]
  actorId: string
  actorName: string
  /** 出手的是同行中的發現者，才可以重擲 */
  byFinder: boolean
}

export interface Battle {
  id: string
  leadId: string
  leadName: string
  form: FoeFormId
  weak: Approach[]
  /** 按下開始打才有 */
  hand?: HandItem[]
  text?: FoeText
  rounds: BattleRound[]
  rerollUsed: boolean
}

export type BattleOutcome = 'perfect' | 'win' | 'draw'

export interface BattleRecord {
  id: string
  at: number
  leadId: string
  leadName: string
  form: FoeFormId
  text: FoeText
  outcome: BattleOutcome
  rounds: { itemName: string; actorName: string; won: boolean }[]
}

export interface FoeDexEntry {
  met: number
  won: boolean
  perfect: boolean
  text: FoeText
  leadName: string
}

export interface CharacterFoes {
  name: string
  madeAt: number
  list: Partial<Record<FoeFormId, FoeText>>
}

export interface BattleStore {
  /** 同意過「寫敵人會送出角色卡」 */
  consented: boolean
  /** 拒絕過：不再主動問，仍可自己按 */
  declined: boolean
  /** 上次對手離開後打開成功的箱子數 */
  opened: number
  /** 0＝還沒抽過門檻 */
  nextAt: number
  foes: Record<string, CharacterFoes>
  current?: Battle
  log: BattleRecord[]
  /** key 見 `dexKey()` */
  dex: Record<string, FoeDexEntry>
}

export function defaultBattleStore(): BattleStore {
  return { consented: false, declined: false, opened: 0, nextAt: 0, foes: {}, log: [], dex: {} }
}

export const dexKey = (characterId: string, form: FoeFormId): string => `${characterId}:${form}`

const pick = <T>(list: readonly T[], random: () => number): T =>
  list[Math.min(list.length - 1, Math.floor(random() * list.length))]

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

// ── 休息 ─────────────────────────────────────────────

/** 還要休息多久；0＝可出場。上次出場在未來（手機時間往回調）視為可出場。 */
export function restLeft(lastBattleAt: number | undefined, now: number): number {
  if (!lastBattleAt || lastBattleAt > now) return 0
  return Math.max(0, lastBattleAt + REST_MS - now)
}

/** 物品卡上的文字；可出場時是空字串。 */
export function restText(lastBattleAt: number | undefined, now: number): string {
  const left = restLeft(lastBattleAt, now)
  if (left === 0) return ''
  const minutes = Math.floor(left / 60_000)
  if (minutes === 0) return '馬上就好'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const time = [h ? `${h} 小時` : '', m ? `${m} 分鐘` : ''].filter(Boolean).join(' ')
  return `休息中，還有 ${time}可再出場`
}

/** 補寫出場時間；重做結果相同，已丟掉的物品略過。 */
export function markBattled<T extends { id: string; lastBattleAt?: number }>(items: T[], rounds: readonly BattleRound[]): T[] {
  const at = new Map(rounds.map((r) => [r.itemId, r.at]))
  if (!items.some((i) => at.has(i.id) && i.lastBattleAt !== at.get(i.id))) return items
  return items.map((i) => (at.has(i.id) ? { ...i, lastBattleAt: at.get(i.id) } : i))
}

// ── 遇到對手 ─────────────────────────────────────────

/** 打開箱子成功一次。等著的時候不累計；滿了就停在門檻。 */
export function countOpened(s: BattleStore, random: () => number = Math.random): BattleStore {
  if (s.current) return s
  const nextAt = s.nextAt || APPEAR_MIN + Math.floor(random() * (APPEAR_MAX - APPEAR_MIN + 1))
  return { ...s, nextAt, opened: Math.min(nextAt, s.opened + 1) }
}

function drawWeak(random: () => number): Approach[] {
  const weak = Array.from({ length: ROUND_COUNT }, () => pick(APPROACH_IDS, random))
  if (weak.every((w) => w === weak[0])) {
    weak[ROUND_COUNT - 1] = pick(APPROACH_IDS.filter((a) => a !== weak[0]), random)
  }
  return weak
}

export interface AppearContext {
  present: readonly Person[]
  items: readonly BattleItem[]
  newId: () => string
  random?: () => number
}

export function tryAppear(s: BattleStore, ctx: AppearContext): BattleStore {
  const random = ctx.random ?? Math.random
  if (s.current || s.nextAt === 0 || s.opened < s.nextAt || ctx.present.length === 0) return s
  if (ctx.items.filter((i) => i.name).length < MIN_ITEMS) return s
  const lead = pick(ctx.present, random)
  return {
    ...s,
    current: {
      id: ctx.newId(),
      leadId: lead.id,
      leadName: lead.name,
      form: pick(FOE_FORM_IDS, random),
      weak: drawWeak(random),
      rounds: [],
      rerollUsed: false
    }
  }
}

/** 主角離開了：已有專屬內容或已開打就照打，否則換一位同行的；沒人就先留著。 */
export function keepLead(s: BattleStore, present: readonly Person[], random: () => number = Math.random): BattleStore {
  const b = s.current
  if (!b || b.hand || present.length === 0 || present.some((p) => p.id === b.leadId)) return s
  if (s.foes[b.leadId]?.list[b.form]) return s
  const lead = pick(present, random)
  return { ...s, current: { ...b, leadId: lead.id, leadName: lead.name } }
}

function cleared(s: BattleStore): BattleStore {
  const next = { ...s, opened: 0, nextAt: 0 }
  delete next.current
  return next
}

/** 「繞過它」：不留紀錄。開打後不能繞。 */
export function bypassBattle(s: BattleStore, battleId: string): BattleStore {
  return s.current?.id === battleId && !s.current.hand ? cleared(s) : s
}

// ── 打一場 ───────────────────────────────────────────

/** 發牌；連同休息中的都不到 3 件時回空陣列。 */
export function dealHand(
  items: readonly BattleItem[],
  weak: readonly Approach[],
  now: number,
  random: () => number = Math.random
): HandItem[] {
  const usable = items.flatMap((i) => {
    const kind = findItemKind(i.kindId)
    return i.name && kind ? [{ item: i, name: i.name, kind }] : []
  })
  if (usable.length < MIN_ITEMS) return []
  const pool = usable.filter((u) => restLeft(u.item.lastBattleAt, now) === 0)
  if (pool.length < MIN_ITEMS) {
    const resting = usable
      .filter((u) => !pool.includes(u))
      .sort((a, b) => (a.item.lastBattleAt ?? 0) - (b.item.lastBattleAt ?? 0) || (a.item.id < b.item.id ? -1 : 1))
    pool.push(...resting.slice(0, MIN_ITEMS - pool.length))
  }

  // 品項不重複的先發，不夠才用重複的補
  const kinds = new Set<string>()
  const first: typeof pool = []
  const repeat: typeof pool = []
  for (const u of shuffled(pool, random)) {
    if (kinds.has(u.kind.id)) repeat.push(u)
    else first.push(u)
    kinds.add(u.kind.id)
  }
  const order = [...first, ...repeat]
  const hand = order.slice(0, HAND_SIZE)
  const matches = (u: (typeof pool)[number]): boolean => weak.includes(approachOf(u.kind.category))
  if (!hand.some(matches)) {
    const spare = order.slice(HAND_SIZE).find(matches)
    if (spare) hand[hand.length - 1] = spare
  }
  return hand.map((u) => ({
    itemId: u.item.id,
    name: u.name,
    category: u.kind.category,
    finderId: u.item.finderId,
    finderName: u.item.finderName
  }))
}

/** 開打：發牌並定案敵人文字，之後不重發。物品不足就原樣回傳。 */
export function startBattle(
  s: BattleStore,
  battleId: string,
  items: readonly BattleItem[],
  now: number,
  random: () => number = Math.random
): BattleStore {
  const b = s.current
  if (!b || b.id !== battleId || b.hand) return s
  const hand = dealHand(items, b.weak, now, random)
  if (hand.length === 0) return s
  const text = s.foes[b.leadId]?.list[b.form] ?? FOE_FORMS[b.form].fallback
  return { ...s, current: { ...b, hand, text } }
}

/** 擲 `count` 顆六面骰，回傳全部點數。 */
export type BattleRoller = (count: 1 | 2) => number[]

const defaultRoller: BattleRoller = (count) => {
  const r = computeRandomResult({ tool: 'dice', faces: 6, count, keepHighest: 1 })
  return r.tool === 'dice' ? r.rolls : []
}

export const roundFace = (r: BattleRound): number => Math.max(0, ...r.rolls)
export const roundWon = (r: BattleRound): boolean => roundFace(r) >= WIN_FACE

export interface PlayInput {
  battleId: string
  /** 畫面以為的回合；對不上就不動 */
  round: number
  itemId: string
  present: readonly Person[]
  now: number
  roll?: BattleRoller
}

export function playRound(s: BattleStore, p: PlayInput): BattleStore {
  const b = s.current
  if (!b?.hand || b.id !== p.battleId || b.rounds.length !== p.round || p.round >= ROUND_COUNT) return s
  const card = b.hand.find((h) => h.itemId === p.itemId)
  if (!card || b.rounds.some((r) => r.itemId === p.itemId)) return s
  // 找到它的角色拿出來；不在場就由主角代打
  const finder = p.present.find((c) => c.id === card.finderId)
  const round: BattleRound = {
    at: p.now,
    itemId: card.itemId,
    rolls: (p.roll ?? defaultRoller)(approachOf(card.category) === b.weak[p.round] ? 2 : 1),
    actorId: finder?.id ?? b.leadId,
    actorName: finder?.name ?? b.leadName,
    byFinder: !!finder
  }
  return { ...s, current: { ...b, rounds: [...b.rounds, round] } }
}

/** 剛打完、沒贏的那一回合，而且這場還沒重擲過。 */
export function canReroll(b: Battle): boolean {
  const last = b.rounds[b.rounds.length - 1]
  return !!last && !b.rerollUsed && last.byFinder && !roundWon(last)
}

export function rerollRound(s: BattleStore, battleId: string, round: number, roll: BattleRoller = defaultRoller): BattleStore {
  const b = s.current
  if (!b || b.id !== battleId || b.rounds.length - 1 !== round || !canReroll(b)) return s
  const last = b.rounds[round]
  const rounds = [...b.rounds.slice(0, -1), { ...last, rolls: roll(last.rolls.length === 2 ? 2 : 1) }]
  return { ...s, current: { ...b, rounds, rerollUsed: true } }
}

export function outcomeOf(rounds: readonly BattleRound[]): BattleOutcome {
  const wins = rounds.filter(roundWon).length
  return wins === ROUND_COUNT ? 'perfect' : wins === ROUND_COUNT - 1 ? 'win' : 'draw'
}

/** 三回合打完後收尾：記錄、點亮圖鑑、清掉對手。 */
export function finishBattle(s: BattleStore, battleId: string, now: number): BattleStore {
  const b = s.current
  if (!b?.hand || b.id !== battleId || b.rounds.length !== ROUND_COUNT) return s
  const outcome = outcomeOf(b.rounds)
  const text = b.text ?? FOE_FORMS[b.form].fallback
  const names = new Map(b.hand.map((h) => [h.itemId, h.name]))
  const record: BattleRecord = {
    id: b.id,
    at: now,
    leadId: b.leadId,
    leadName: b.leadName,
    form: b.form,
    text,
    outcome,
    rounds: b.rounds.map((r) => ({ itemName: names.get(r.itemId) ?? '', actorName: r.actorName, won: roundWon(r) }))
  }
  const key = dexKey(b.leadId, b.form)
  const old = s.dex[key]
  return {
    ...cleared(s),
    log: [...s.log, record].slice(-LOG_LIMIT),
    dex: {
      ...s.dex,
      [key]: {
        met: (old?.met ?? 0) + 1,
        won: !!old?.won || outcome !== 'draw',
        perfect: !!old?.perfect || outcome === 'perfect',
        text,
        leadName: b.leadName
      }
    }
  }
}

export const OUTCOME_TITLE: Record<BattleOutcome, string> = {
  perfect: '大獲全勝',
  win: '打跑了',
  draw: '平手，它溜走了'
}

/** 「聊聊這場戰鬥」送進對話的文字；不含骰面。 */
export function buildBattleTalkMessage(r: BattleRecord): string {
  return [
    '聊聊這場戰鬥吧。',
    `【${r.text.name}】（${r.leadName}在路上遇到的）`,
    ...r.rounds.map((x, i) => `第 ${i + 1} 回合，${x.actorName}拿出「${x.itemName}」，${x.won ? '成功了' : '它閃過了'}。`),
    `結果：${OUTCOME_TITLE[r.outcome]}。${r.text[r.outcome]}`
  ].join('\n')
}

// ── 讀取 ─────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const entries = (v: unknown): [string, unknown][] => (isObject(v) ? Object.entries(v) : [])
const asForm = (v: unknown): FoeFormId | undefined => FOE_FORM_IDS.find((f) => f === v)
const isApproach = (v: unknown): v is Approach => APPROACH_IDS.some((a) => a === v)
const isCategory = (v: unknown): v is ItemCategory => typeof v === 'string' && Object.keys(APPROACH_OF).includes(v)
const isFace = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6

function normalizeText(raw: unknown): FoeText | undefined {
  if (!isObject(raw)) return undefined
  const t = { name: str(raw.name), intro: str(raw.intro), perfect: str(raw.perfect), win: str(raw.win), draw: str(raw.draw) }
  return Object.values(t).every(Boolean) ? t : undefined
}

function normalizeHand(raw: unknown): HandItem[] | undefined {
  const hand = list(raw).flatMap((h): HandItem[] =>
    isObject(h) && str(h.itemId) && str(h.name) && isCategory(h.category)
      ? [{ itemId: str(h.itemId), name: str(h.name), category: h.category, finderId: str(h.finderId), finderName: str(h.finderName) }]
      : []
  )
  return hand.length >= MIN_ITEMS ? hand.slice(0, HAND_SIZE) : undefined
}

function normalizeBattle(raw: unknown): Battle | undefined {
  if (!isObject(raw)) return undefined
  const form = asForm(raw.form)
  const weak = list(raw.weak).filter(isApproach)
  if (!str(raw.id) || !str(raw.leadId) || !form || weak.length !== ROUND_COUNT) return undefined
  const hand = normalizeHand(raw.hand)
  const rounds: BattleRound[] = []
  for (const r of hand ? list(raw.rounds).slice(0, ROUND_COUNT) : []) {
    const rolls = isObject(r) ? list(r.rolls).filter(isFace) : []
    // 中間壞一回合，後面的弱點就對不上了
    if (!isObject(r) || rolls.length < 1 || rolls.length > 2) break
    const itemId = str(r.itemId)
    if (!hand?.some((h) => h.itemId === itemId) || rounds.some((x) => x.itemId === itemId)) break
    rounds.push({ at: num(r.at), itemId, rolls, actorId: str(r.actorId), actorName: str(r.actorName), byFinder: r.byFinder === true })
  }
  return {
    id: str(raw.id),
    leadId: str(raw.leadId),
    leadName: str(raw.leadName),
    form,
    weak,
    hand,
    text: hand ? (normalizeText(raw.text) ?? FOE_FORMS[form].fallback) : undefined,
    rounds,
    rerollUsed: raw.rerollUsed === true
  }
}

function normalizeRecord(raw: unknown): BattleRecord[] {
  if (!isObject(raw)) return []
  const form = asForm(raw.form)
  const text = normalizeText(raw.text)
  const outcome = (['perfect', 'win', 'draw'] as const).find((o) => o === raw.outcome)
  if (!str(raw.id) || !form || !text || !outcome) return []
  return [
    {
      id: str(raw.id),
      at: num(raw.at),
      leadId: str(raw.leadId),
      leadName: str(raw.leadName),
      form,
      text,
      outcome,
      rounds: list(raw.rounds)
        .filter(isObject)
        .map((r) => ({ itemName: str(r.itemName), actorName: str(r.actorName), won: r.won === true }))
    }
  ]
}

export function normalizeBattleStore(raw: unknown): BattleStore {
  const s = defaultBattleStore()
  if (!isObject(raw)) return s
  for (const [id, f] of entries(raw.foes)) {
    if (!isObject(f)) continue
    const texts: CharacterFoes['list'] = {}
    for (const [k, v] of entries(f.list)) {
      const form = asForm(k)
      const text = normalizeText(v)
      if (form && text) texts[form] = text
    }
    if (Object.keys(texts).length > 0) s.foes[id] = { name: str(f.name), madeAt: num(f.madeAt), list: texts }
  }
  for (const [key, d] of entries(raw.dex)) {
    const text = isObject(d) ? normalizeText(d.text) : undefined
    if (!isObject(d) || !text || !asForm(key.slice(key.lastIndexOf(':') + 1))) continue
    s.dex[key] = { met: num(d.met), won: d.won === true, perfect: d.perfect === true, text, leadName: str(d.leadName) }
  }
  const nextAt = Math.min(APPEAR_MAX, num(raw.nextAt))
  return {
    ...s,
    consented: raw.consented === true,
    declined: raw.declined === true,
    nextAt,
    opened: Math.min(nextAt, num(raw.opened)),
    current: normalizeBattle(raw.current),
    log: list(raw.log).flatMap(normalizeRecord).slice(-LOG_LIMIT)
  }
}
