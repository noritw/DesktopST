import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ITEM_RARITIES,
  ITEM_SORTS,
  ITEM_SORT_IDS,
  JOURNEY_MAPS,
  JOURNEY_MAP_IDS,
  buildItemTalkMessage,
  discardItem,
  findItemKind,
  useItem as applyItemUse,
  journeyMapFor,
  sortItems,
  type ItemRarity,
  type ItemSort,
  type JourneyMapId,
  type WalkCollection,
  type WalkItem
} from '@core/walk/items'
import { APPROACHES, APPROACH_IDS, FOE_FORMS, approachOf, defaultBattleStore, restText, type Approach, type BattleStore } from '@core/walk/battle'
import { prepareReveal } from '@core/walk/treasureDraw'
import { partyOf, roadAt, slotOrder, tripBetween } from '@core/walk/journey'
import { newId } from '../../runtime/id'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import { loadWalkSettings, loadWalkState, localDay } from '../../runtime/walk'
import { lastWidgetSteps } from '../../runtime/walkBridge'
import { loadCollection, updateCollection, type RevealResult } from '../../runtime/walkItems'
import { openJourney, simulateJourney, stayInJourney } from '../../runtime/walkJourney'
import { forceEncounter, syncBattles } from '../../runtime/walkBattle'
import { addTestPoints, lureFoe, markPointsSeen } from '../../runtime/walkPoints'
import { POINT_COSTS, defaultPoints, weekStats, type PointsState } from '@core/walk/points'
import { PointsPill, WeekPanel } from './StepsPoints'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from '../characters/Avatar'
import { BattleView } from './BattleView'
import { Companion, type PartyTrip } from './Companion'
import { FOE_ART } from './foeArt'
import { isWalkTestBuild } from './testBuild'
import { MAP_ROUTES, buildRoad, slotsOn, type MapRoute, type Point } from './road'
import { APPROACH_ICONS, MAP_ART, boxIconFor } from './art'

/** 今日旅途（`docs/walk-items-design.md` §5.1）。 */

const PRIMARY = 'w-full rounded-full bg-[var(--mint2)] px-4 py-3 text-[15px] font-medium text-[var(--text)] disabled:opacity-45'
const SECONDARY = 'w-full rounded-full bg-[var(--bg)] px-4 py-2.5 text-[14px] text-[var(--text)] disabled:opacity-45'
const TEST_BTN = 'rounded-[16px] bg-[var(--bg)] px-1 py-2 text-[12px] leading-snug text-[var(--text)] disabled:opacity-45'
const SUB = 'text-[12px] leading-relaxed text-[var(--text-sub)]'

const SLOT_COUNT = 5

/** `null`＝收走了、`undefined`＝還沒放過 */
type Slots = (string | null | undefined)[]

/** 只補沒用過的位置；收走的位置這次不再補，免得看起來像「點了沒消失」。 */
function fillSlots(slots: Slots, ids: readonly string[], order: readonly number[]): Slots {
  const next: Slots = Array.from({ length: SLOT_COUNT }, (_, i) => slots[i])
  const free = order.filter((i) => next[i] === undefined)
  for (const id of ids) {
    if (next.includes(id)) continue
    const i = free.shift()
    if (i === undefined) break
    next[i] = id
  }
  return next.map((id) => (id && !ids.includes(id) ? null : id))
}

const FAIL_TEXT: Record<Extract<RevealResult, { ok: false }>['reason'], string> = {
  not_found: '找不到這件物品',
  no_key: '要先設定 API Key 才能聽故事，物品會留著',
  no_character: '找不到可以說故事的角色，物品會留著',
  no_points: `點數不夠，打開一個要 ${POINT_COSTS.openBox} 點，箱子會留著`,
  failed: '這次沒說成，物品會留著，稍後再試'
}

function RarityRing({ rarity, children, size }: { rarity: ItemRarity; children: ReactNode; size: number }): JSX.Element {
  // 不只靠顏色：尋常單圈、罕見雙圈、奇珍點圈
  const border =
    rarity === 'rare' ? 'border-[4px] border-dotted' : rarity === 'uncommon' ? 'border-[5px] border-double' : 'border-[1.5px]'
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border-[var(--text-sub)] bg-[#FFFDF4] ${border}`}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  )
}

const approachOfItem = (i: WalkItem): Approach => approachOf(findItemKind(i.kindId)!.category)

function ItemIcon({ item, size }: { item: WalkItem; size: number }): JSX.Element {
  const kind = findItemKind(item.kindId)!
  return (
    <RarityRing rarity={kind.rarity} size={size}>
      <img src={APPROACH_ICONS[approachOf(kind.category)]} alt="" style={{ width: size * 0.84, height: size * 0.84 }} />
    </RarityRing>
  )
}

function KindTags({ item }: { item: WalkItem }): JSX.Element {
  const kind = findItemKind(item.kindId)!
  const r = kind.rarity
  // 稀有度的邊框與圖示外圈一致
  const border = r === 'rare' ? 'border-2 border-dotted' : r === 'uncommon' ? 'border-[3px] border-double' : 'border'
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-[13px] text-[#3D5A52]">
      <span className="rounded-full bg-[#CDEBDD] px-3 py-1 font-medium">過招：{APPROACHES[approachOf(kind.category)]}</span>
      {item.map && <span className="rounded-full bg-[#FFFDF4] px-3 py-1">{JOURNEY_MAPS[item.map]}</span>}
      <span className={`rounded-full border-[#3D5A52] bg-[#FFFDF4] px-3 py-1 ${border}`}>稀有度：{ITEM_RARITIES[r].label}</span>
    </div>
  )
}

/** 休息時間到了會自己消失。 */
function RestNote({ at, brief }: { at?: number; brief?: boolean }): JSX.Element | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!at) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [at])
  const text = restText(at, now)
  if (!text) return null
  return <span className={brief ? 'text-[12px] text-[var(--text-sub)]' : 'text-[13px] text-[var(--text-sub)]'}>{brief ? '休息中' : text}</span>
}

/** 對手站在最近那個箱子的另一側，不佔箱子的位置。 */
const foeSpot = (r: MapRoute): Point => ({ x: r.slots[0].x < 195 ? 320 : 70, y: 492 })

export function JourneyView(): JSX.Element {
  const session = getStandaloneSession()
  const ui = useUiStore()
  const present = useAppStore((s) => s.snapshot?.presentCharacters) ?? []
  const [tab, setTab] = useState<'road' | 'bag'>('road')
  const [col, setCol] = useState<WalkCollection | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [steps, setSteps] = useState<{ day: string; n?: number } | null>(null)
  const [points, setPoints] = useState<PointsState>(defaultPoints)
  const [credited, setCredited] = useState<Record<string, number>>({})
  const [showWeek, setShowWeek] = useState(false)
  const [buying, setBuying] = useState(false)
  const stepsRef = useRef<HTMLButtonElement>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [revealingId, setRevealingId] = useState<string | null>(null)
  /** 最近打開過的那件：分類與稀有度先亮出來，失敗時也留著 */
  const [triedId, setTriedId] = useState<string | null>(null)
  /** 測試按鈕只給開發伺服器與手機測試版 */
  const [test, setTest] = useState(false)
  /** 剛用出來的那件，才播動畫並捲到籤語 */
  const [justUsed, setJustUsed] = useState<string | null>(null)
  const [choosingMap, setChoosingMap] = useState(false)
  const [slots, setSlots] = useState<Slots>([])
  /** 正跳到面前的箱子 */
  const [focusId, setFocusId] = useState<string | null>(null)
  /** 發現者正走過去拿（到了才跳出來） */
  const [pickup, setPickup] = useState<{ itemId: string; seq: number } | null>(null)
  const [battles, setBattles] = useState<BattleStore>(defaultBattleStore)
  const [fighting, setFighting] = useState(false)
  const focusRef = useRef<string | null>(null)
  const [syncing, setSyncing] = useState(0)
  /** 物品頁只看某種過招效果 */
  const [filter, setFilter] = useState<Approach | null>(null)
  const [today, setToday] = useState(() => localDay(Date.now()))
  /** 隊伍這一趟怎麼走 */
  const [trip, setTrip] = useState<(PartyTrip & { map: JourneyMapId; day: string; phase: number; leadId?: string }) | null>(null)
  const [played, setPlayed] = useState(0)
  const seqRef = useRef(0)
  const busy = !!focusId || !!pickup || !!revealingId
  const busyRef = useRef(false)
  busyRef.current = busy

  const reload = useCallback(async (): Promise<void> => {
    if (!session) return
    const on = (await loadWalkSettings(session.walkStorage)).enabled
    setEnabled(on)
    const { creditedByDay, points: pts } = await loadWalkState(session.walkStorage)
    setCredited(creditedByDay)
    setPoints(pts)
    // 小工具可能比記帳新，畫面用大的那個；關閉時小工具不會更新
    const widget = on ? await lastWidgetSteps(today).catch(() => undefined) : undefined
    const shown = Math.max(creditedByDay[today] ?? -1, widget ?? -1)
    setSteps({ day: today, n: shown >= 0 ? shown : undefined })
    // 先同步過招：上次中斷的出場時間會補寫到物品上
    const people = (useAppStore.getState().snapshot?.presentCharacters ?? []).map((c) => ({ id: c.id, name: c.name }))
    setBattles(await syncBattles(session.walkStorage, { present: people, newId }).catch((e) => {
      console.warn('[Walk] 載入對手失敗:', e)
      return defaultBattleStore()
    }))
    setCol(await loadCollection(session.walkStorage))
  }, [session, today])

  /** 先用手上的資料畫出來，再去讀新的步數；讀不到也要看得到既有的東西。 */
  const refresh = useCallback(async (): Promise<void> => {
    setSyncing((n) => n + 1)
    try {
      await reload()
      await session?.syncWalkNow().catch(() => {})
      await reload()
    } catch (e) {
      console.warn('[Walk] 載入今日旅途失敗:', e)
    } finally {
      setSyncing((n) => n - 1)
    }
  }, [reload, session])

  useEffect(() => {
    void isWalkTestBuild().then(setTest)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 開著 App 走路或跨日
  useEffect(() => {
    const tick = (): void => {
      if (!busyRef.current) setToday(localDay(Date.now()))
    }
    const wake = (): void => {
      if (document.visibilityState !== 'visible') return
      tick()
      void refresh()
    }
    const timer = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [refresh])

  const map = col ? journeyMapFor(col.map, today) : null
  const road = useMemo(() => buildRoad(MAP_ROUTES[map ?? 'dream']), [map])
  const stepsToday = steps?.day === today ? steps.n : undefined

  // 正在看箱子或過招時不移動，結束才把新走的補上
  useEffect(() => {
    if (!session || !map || steps?.day !== today || busy || fighting) return
    let live = true
    void openJourney(session.walkStorage, { day: today, map, steps: stepsToday })
      .then(({ from, journey }) => {
        if (!live) return
        setTrip((cur) => {
          const same = cur?.map === map && cur.day === today
          if (same && cur.phase === journey.phase) return cur
          const way = tripBetween(same ? cur.phase : from, journey.phase)
          return { seq: ++seqRef.current, map, day: today, phase: journey.phase, leadId: journey.leadId, ...way }
        })
      })
      .catch((e) => console.warn('[Walk] 載入旅途位置失敗:', e))
    return () => {
      live = false
    }
  }, [session, map, today, steps, stepsToday, busy, fighting])

  const order = (): number[] => slotOrder(slotsOn(road), trip?.phase ?? 0)
  const placed = trip !== null

  useEffect(() => {
    if (!col || !placed) return
    const ids = col.items.filter((i) => i.status === 'unopened').map((i) => i.id)
    setSlots((cur) => fillSlots(cur, ids, order()))
    // 只在物品變動時補，隊伍移動不重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col, placed])

  if (!session) return <p className={SUB}>這個功能只在本機模式可用。</p>
  if (!col || enabled === null || !map) return <p className={SUB}>讀取中…</p>

  const scene = MAP_ROUTES[map]
  const waiting = col.items.filter((i) => i.status === 'unopened')
  const owned = col.items.filter((i) => i.status !== 'unopened')
  const focus = focusId ? waiting.find((i) => i.id === focusId) : undefined
  const ahead = waiting.filter((i) => !slots.includes(i.id)).length
  focusRef.current = focusId
  const party = partyOf(present, trip?.leadId, battles.current?.leadId)

  const putBack = (): void => {
    setFocusId(null)
    setPickup(null)
  }

  const pickUp = (item: WalkItem, slot: number): void => {
    // 發現者不在畫面上（離席、已刪除）就直接跳出來
    if (!trip || !present.some((c) => c.id === item.finderId)) {
      setFocusId(item.id)
      return
    }
    const at = slotsOn(road)[slot]
    // 先擋住畫面再存，連點或同時讀到新步數才不會插隊
    const seq = ++seqRef.current
    setPickup({ itemId: item.id, seq })
    void stayInJourney(session.walkStorage, at, item.finderId)
      .then((j) => {
        if (!j) throw new Error('沒有旅途位置')
        setTrip({ seq, map, day: today, phase: j.phase, leadId: j.leadId, start: roadAt(trip.phase), stops: [at] })
      })
      .catch((e) => {
        console.warn('[Walk] 儲存旅途位置失敗:', e)
        setPickup(null)
        setFocusId(item.id)
      })
  }

  const open = openId ? col.items.find((i) => i.id === openId) : undefined

  const reveal = async (item: WalkItem): Promise<void> => {
    if (!col.consented) {
      const ok = await ui.confirm({
        title: '讓角色說故事',
        message:
          '揭曉時，會把這件物品的類型、稀有程度、天氣，與角色、世界觀設定送到你設定的 AI 服務，由角色寫出名稱和故事。步數不會送出。',
        confirmLabel: '同意並揭曉'
      })
      if (!ok) return
      await updateCollection(session.walkStorage, (c) => ({ ...c, consented: true }))
    }
    if (points.balance < POINT_COSTS.openBox) {
      ui.toast(FAIL_TEXT.no_points)
      return
    }
    setRevealingId(item.id)
    // 先定下是哪一種，亮出來的分類才不會中途換掉
    await change((c) => prepareReveal(c, item.id, map))
    setTriedId(item.id)
    try {
      const r = await session.revealWalkItem(item.id, map)
      if (!r.ok) ui.toast(FAIL_TEXT[r.reason], 'error')
      else if (focusRef.current === item.id) {
        // 使用者可能已經先放著去看別的，只在還盯著這件時才翻到道具卡
        await reload()
        putBack()
        setOpenId(item.id)
      }
    } catch {
      ui.toast(FAIL_TEXT.failed, 'error')
    } finally {
      setRevealingId((id) => (id === item.id ? null : id))
      await reload()
    }
  }

  const spendOn = async (what: 'findBox' | 'lureFoe'): Promise<void> => {
    const ok = await ui.confirm({
      title: what === 'findBox' ? '在附近找一個箱子' : '引來一個對手',
      message: `會用掉 ${POINT_COSTS[what].toLocaleString()} 點（現在有 ${points.balance.toLocaleString()} 點）。點數只能靠走路和過招拿到。`,
      confirmLabel: '用點數'
    })
    if (!ok) return
    setBuying(true)
    try {
      if (what === 'findBox') {
        const r = await session.findWalkBox()
        if (!r.ok) ui.toast(r.reason === 'no_points' ? '點數不夠' : r.reason === 'no_character' ? '要有同行的角色才找得到' : '這次沒找到，點數沒有扣')
      } else {
        const people = present.map((c) => ({ id: c.id, name: c.name }))
        const r = await lureFoe(session.walkStorage, { present: people, newId })
        if (!r.ok) {
          ui.toast(
            r.reason === 'no_points' ? '點數不夠'
              : r.reason === 'no_character' ? '要有同行的角色才會遇到'
              : r.reason === 'not_now' ? '要先打開 3 件物品，而且路上沒有對手在等'
              : '這次沒引來，點數已退回'
          )
        }
      }
    } catch {
      ui.toast('儲存失敗', 'error')
    } finally {
      setBuying(false)
      await reload()
    }
  }

  const change = async (fn: (c: WalkCollection) => WalkCollection): Promise<void> => {
    try {
      setCol(await updateCollection(session.walkStorage, fn))
    } catch {
      ui.toast('儲存失敗', 'error')
    }
  }

  const discard = async (item: WalkItem): Promise<void> => {
    const ok = await ui.confirm({
      title: '丟掉這件物品',
      message: '丟掉就找不回來了。已經聊過的對話會留著。',
      confirmLabel: '丟掉',
      destructive: true
    })
    if (!ok) return
    setOpenId(null)
    await change((c) => discardItem(c, item.id))
  }

  const use = async (item: WalkItem): Promise<void> => {
    await change((c) => applyItemUse(c, item.id, Date.now()))
    setJustUsed(item.id)
  }

  const talk = (item: WalkItem): void => {
    ui.popAll()
    void useAppStore.getState().send({ content: buildItemTalkMessage(item) })
  }

  // ── 道具卡 ──
  if (open?.name) {
    const fortune = open.fortune
    const fresh = justUsed === open.id
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        <div className="anim-pop-in flex flex-col items-center gap-3 rounded-[24px] bg-[var(--bg)] px-5 py-6 text-center text-[var(--text)]">
          <ItemIcon item={open} size={112} />
          <p className="text-[24px] font-bold leading-snug">{open.name}</p>
          <KindTags item={open} />
          <RestNote at={open.lastBattleAt} />
          <p className="w-full text-left text-[16px] leading-[1.8]">{open.story}</p>
          {open.look && (
            <div className="w-full rounded-[16px] bg-[var(--surface)] px-4 py-3 text-left">
              <p className="text-[12px] text-[var(--text-sub)]">說明</p>
              <p className="pt-1 text-[15px] leading-relaxed">{open.look}</p>
            </div>
          )}
          {open.why && (
            <div className="w-full rounded-[16px] bg-[var(--surface)] px-4 py-3 text-left">
              <p className="text-[12px] text-[var(--text-sub)]">為什麼留著</p>
              <p className="pt-1 text-[15px] leading-relaxed">{open.why}</p>
            </div>
          )}
          {open.move && (
            <div className="w-full rounded-[16px] bg-[var(--surface)] px-4 py-3 text-left">
              <p className="text-[12px] text-[var(--text-sub)]">絕招</p>
              <p className="pt-1 text-[15px] leading-relaxed">{open.move}</p>
            </div>
          )}
          {open.effect && !open.why && (
            <p className="w-full rounded-[16px] bg-[var(--surface)] px-4 py-3 text-left text-[14px] leading-relaxed">{open.effect}</p>
          )}
          {fortune && (
            <div
              role="status"
              ref={(el) => {
                if (fresh) el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
              }}
              className={`${fresh ? 'anim-pop-in ' : ''}w-full rounded-[18px] bg-[#FFF3CF] px-4 py-5 text-center text-[#3D5A52]`}
            >
              <p className="text-[13px]">{fortune.reaction}</p>
              <p className="pt-2 text-[19px] font-bold leading-snug">{fortune.text}</p>
            </div>
          )}
          <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-2 text-left text-[13px]">
            <div><dt className="text-[var(--text-sub)]">發現者</dt><dd>{open.finderName}</dd></div>
            <div>
              <dt className="text-[var(--text-sub)]">找到的日子</dt>
              <dd>{open.day}{open.weather ? ` ${open.weather.description}` : ''}</dd>
            </div>
            {open.place && <div><dt className="text-[var(--text-sub)]">在角色的世界</dt><dd>{open.place}</dd></div>}
            {open.stepsToday > 0 && (
              <div><dt className="text-[var(--text-sub)]">那天走到</dt><dd>{open.stepsToday.toLocaleString()} 步</dd></div>
            )}
          </dl>
        </div>
        <div className={fortune ? '' : 'grid grid-cols-2 gap-2'}>
          {!fortune && <button type="button" className={PRIMARY} onClick={() => void use(open)}>使用</button>}
          <button type="button" className={PRIMARY} onClick={() => talk(open)}>聊聊這個</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={SECONDARY} onClick={() => setOpenId(null)}>返回</button>
          <button type="button" className={SECONDARY} onClick={() => void discard(open)}>丟掉</button>
        </div>
      </div>
    )
  }

  if (choosingMap) {
    const choices: (JourneyMapId | undefined)[] = [undefined, ...JOURNEY_MAP_IDS]
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className={`${SUB} pb-3`}>選了就固定走這張。每張地圖能找到的物品都不一樣。</p>
          <div className="grid grid-cols-2 gap-2.5">
            {choices.map((id) => {
              const on = col.map === id
              return (
                <button
                  key={id ?? 'daily'}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setChoosingMap(false)
                    void change((c) => ({ ...c, map: id }))
                  }}
                  className={`overflow-hidden rounded-[20px] border-[3px] bg-[var(--bg)] text-[14px] text-[var(--text)] ${
                    on ? 'border-[var(--mint2)] font-bold' : 'border-transparent'
                  }`}
                >
                  {id ? (
                    <img src={MAP_ART[id]} alt="" className="h-28 w-full object-cover object-[center_25%]" />
                  ) : (
                    <span className="grid h-28 grid-cols-7">
                      {JOURNEY_MAP_IDS.map((m) => (
                        <img key={m} src={MAP_ART[m]} alt="" className="h-28 w-full object-cover" />
                      ))}
                    </span>
                  )}
                  <span className="block py-2.5">{id ? JOURNEY_MAPS[id] : '每天輪替'}{on ? '（目前）' : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
        <button type="button" className={`${SECONDARY} shrink-0`} onClick={() => setChoosingMap(false)}>返回</button>
      </div>
    )
  }

  if (fighting) {
    return (
      <BattleView
        store={battles}
        present={present.map((c) => ({ id: c.id, name: c.name }))}
        storage={session.walkStorage}
        map={map}
        onChange={setBattles}
        onClose={() => {
          setFighting(false)
          void reload().catch((e) => console.warn('[Walk] 載入今日旅途失敗:', e))
        }}
      />
    )
  }

  const foe = battles.current
  const spot = foeSpot(scene)
  const drawn = !!focus && triedId === focus.id
  const revealing = !!focus && revealingId === focus.id

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {tab === 'road' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative isolate w-full overflow-hidden rounded-[24px]" style={{ aspectRatio: '390 / 560' }}>
            <img
              src={MAP_ART[map]}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute left-3 top-2 z-[600] text-[#3D5A52]">
              <button
                ref={stepsRef}
                type="button"
                aria-expanded={showWeek}
                onClick={() => setShowWeek((v) => !v)}
                className="rounded-[18px] bg-[#FFFDF4]/85 px-3.5 py-1.5 text-left"
              >
                <span className="block text-[12px]">今天{showWeek ? '' : '・看本週'}</span>
                {stepsToday !== undefined ? (
                  <span className="block leading-none">
                    <span className="text-[34px] font-bold tabular-nums">{stepsToday.toLocaleString()}</span>
                    <span className="pl-1 text-[14px]">步</span>
                  </span>
                ) : (
                  <span className="block text-[14px] font-medium">{syncing > 0 ? '讀取中' : '還沒讀到步數'}</span>
                )}
              </button>
              {syncing > 0 && (
                <span role="status" className="block px-2 pt-1 text-[12px]">
                  正在看路上有什麼
                  <span className="journey-dots" aria-hidden="true"><span /><span /><span /></span>
                </span>
              )}
            </div>
            <div className="absolute right-3 top-[60px] z-[600]">
              <PointsPill
                balance={points.balance}
                unseen={points.unseen}
                fromRef={stepsRef}
                onSeen={(n) => void markPointsSeen(session.walkStorage, n).catch(() => {})}
              />
            </div>
            {showWeek && (
              <WeekPanel stats={weekStats(credited, today, stepsToday)} today={today} onClose={() => setShowWeek(false)} />
            )}
            <button
              type="button"
              disabled={!!focusId || !!pickup}
              onClick={() => setChoosingMap(true)}
              className="absolute right-3 top-2 z-[600] rounded-full bg-[#FFFDF4] px-4 py-2.5 text-[13px] font-medium text-[#3D5A52]"
            >
              換地圖
            </button>
            {trip?.map === map && trip.day === today && party.map((c, i) => (
              <Companion
                key={`${today}-${map}-${c.id}`}
                id={c.id}
                name={c.name}
                road={road}
                rank={i}
                trip={trip}
                played={played}
                onArrive={(seq) => {
                  setPlayed((n) => Math.max(n, seq))
                  if (pickup?.seq === seq) setFocusId(pickup.itemId)
                }}
              />
            ))}
            {foe && !focusId && (
              <button
                type="button"
                disabled={!!pickup}
                onClick={() => setFighting(true)}
                className="anim-fade-in absolute z-[600] flex w-32 flex-col items-center"
                style={{ left: `${(spot.x / 390) * 100}%`, top: `${(spot.y / 560) * 100}%`, transform: 'translate(-50%, -50%)' }}
              >
                <img src={FOE_ART[foe.form]} alt="" className="anim-journey-nod h-[76px] w-[76px]" />
                <span className="max-w-full rounded-[14px] bg-[#FFFDF4] px-3 py-1.5 text-center text-[13px] font-medium leading-snug text-[#3D5A52]">
                  {foe.hand ? `繼續對付${(foe.text ?? FOE_FORMS[foe.form].fallback).name}` : `${foe.leadName}遇到了什麼？`}
                </span>
              </button>
            )}
            {focus && <div className="anim-fade-in absolute inset-0 z-[700] bg-[#F7FFFC]/75" />}
            {slots.map((id, i) => {
              const item = id ? waiting.find((w) => w.id === id) : undefined
              if (!item) return null
              const focused = item.id === focusId
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!!focusId || !!pickup}
                  aria-label={`打開${item.finderName}找到的箱子`}
                  onClick={() => pickUp(item, i)}
                  className={`journey-parcel absolute flex h-20 w-20 items-center justify-center ${
                    focusId && !focused ? 'opacity-0' : ''
                  }`}
                  style={{
                    // 遠近跟角色的腳一起比
                    zIndex: focused ? 710 : scene.slots[i].y + 30,
                    left: focused ? '50%' : `${(scene.slots[i].x / 390) * 100}%`,
                    top: focused ? '42%' : `${(scene.slots[i].y / 560) * 100}%`,
                    transform: `translate(-50%, -50%) scale(${focused ? 2.3 : 1})`
                  }}
                >
                  {focused && drawn ? (
                    <span className="anim-pop-in">
                      <span className={`block ${revealingId === item.id ? 'anim-journey-nod' : ''}`}><ItemIcon item={item} size={62} /></span>
                    </span>
                  ) : (
                    <img src={boxIconFor(item.id)} alt="" className={`h-[76px] w-[76px] ${focused ? 'anim-journey-shake' : 'anim-journey-nod'}`} />
                  )}
                </button>
              )
            })}
            {focus && (
              <div className="anim-fade-in absolute inset-x-4 bottom-4 z-[720] space-y-2 rounded-[22px] bg-[#FFFDF4] px-4 pb-1 pt-4 text-center text-[#3D5A52]">
                {/* 發現者可能已經離席，看得到是誰在說話才不會認錯 */}
                <span className="flex justify-center"><Avatar characterId={focus.finderId} size={44} /></span>
                <p className="text-[17px] font-medium">
                  {revealing ? (
                    <span role="status">
                      {focus.finderName}正在想怎麼跟你說
                      <span className="journey-dots" aria-hidden="true"><span /><span /><span /></span>
                    </span>
                  ) : drawn
                      ? '還沒聽到故事'
                      : `${focus.finderName}找到了什麼寶物？`}
                </p>
                {drawn && <KindTags item={focus} />}
                {!revealing && (
                  <button type="button" className={PRIMARY} disabled={points.balance < POINT_COSTS.openBox} onClick={() => void reveal(focus)}>
                    {drawn ? '再試一次' : '打開看看'}・{POINT_COSTS.openBox} 點
                  </button>
                )}
                {!revealing && points.balance < POINT_COSTS.openBox && (
                  <p className="text-[13px]">點數不夠，再走 {(POINT_COSTS.openBox - points.balance).toLocaleString()} 步就能打開</p>
                )}
                <button type="button" className="w-full py-2 text-[14px]" onClick={putBack}>先放著</button>
              </div>
            )}
          </div>
          {!focus && (
            <p className="pt-2 text-center text-[14px] text-[var(--text)]">
              {waiting.length === 0 ? (syncing > 0 ? '正在看路上有什麼' : '路上還沒有物品，走走看吧') : `路上有 ${waiting.length} 個物品`}
            </p>
          )}
          {!focus && ahead > 0 && slots.every((id) => !id) && (
            <button type="button" className={`${PRIMARY} mt-2`} onClick={() => setSlots(fillSlots([], waiting.map((w) => w.id), order()))}>
              往前走
            </button>
          )}
          {!focus && enabled && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={SECONDARY}
                disabled={busy || buying || points.balance < POINT_COSTS.findBox}
                onClick={() => void spendOn('findBox')}
              >
                找一個箱子・{POINT_COSTS.findBox.toLocaleString()} 點
              </button>
              <button
                type="button"
                className={SECONDARY}
                disabled={busy || buying || !!foe || points.balance < POINT_COSTS.lureFoe}
                onClick={() => void spendOn('lureFoe')}
              >
                引來對手・{POINT_COSTS.lureFoe.toLocaleString()} 點
              </button>
            </div>
          )}
          {!enabled && (
            <button type="button" className={`${PRIMARY} mt-2`} onClick={() => ui.push('walk')}>先開啟陪伴同行</button>
          )}
          {test && (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                className={TEST_BTN}
                disabled={busy}
                onClick={() =>
                  void session
                    .simulateWalk(2000)
                    .then(reload)
                    .then(() => simulateJourney(session.walkStorage, 2000))
                    .then((r) => {
                      if (!r) return
                      const { day, phase, leadId } = r.journey
                      setTrip({ seq: ++seqRef.current, map: r.journey.map, day, phase, leadId, ...tripBetween(r.from, phase) })
                    })
                    .catch(() => ui.toast('模擬失敗', 'error'))}
              >
                測試<br />走 2,000 步
              </button>
              <button
                type="button"
                className={TEST_BTN}
                onClick={() =>
                  void forceEncounter(session.walkStorage)
                    .then(reload)
                    .then(() => {
                      if (owned.length < 3) ui.toast('要先打開 3 件物品才會遇到')
                    })
                    .catch(() => ui.toast('模擬失敗', 'error'))
                }
              >
                測試<br />遇到對手
              </button>
              <button
                type="button"
                className={TEST_BTN}
                onClick={() =>
                  void addTestPoints(session.walkStorage, 3000)
                    .then(reload)
                    .catch(() => ui.toast('模擬失敗', 'error'))
                }
              >
                測試<br />＋3,000 點
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {owned.length === 0 && <p className="py-12 text-center text-[14px] text-[var(--text-sub)]">還沒有物品</p>}
          {owned.length > 1 && (
            <label className="flex items-center justify-end gap-2 pb-2.5 text-[13px] text-[var(--text-sub)]">
              排序
              <select
                value={col.sort ?? 'newest'}
                onChange={(e) => {
                  const sort = e.target.value as ItemSort
                  void change((c) => ({ ...c, sort }))
                }}
                className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--text)] outline-none"
              >
                {ITEM_SORT_IDS.map((id) => (
                  <option key={id} value={id}>{ITEM_SORTS[id]}</option>
                ))}
              </select>
            </label>
          )}
          {owned.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-2.5" role="group" aria-label="依過招效果篩選">
              {[null, ...APPROACH_IDS].map((a) => (
                <button
                  key={a ?? 'all'}
                  type="button"
                  aria-pressed={filter === a}
                  onClick={() => setFilter(a)}
                  className={`whitespace-nowrap rounded-full px-2.5 py-2 text-[12px] text-[var(--text)] ${filter === a ? 'bg-[var(--mint)] font-medium' : 'bg-[var(--bg)]'}`}
                >
                  {a ? APPROACHES[a] : '全部'} {a ? owned.filter((i) => approachOfItem(i) === a).length : owned.length}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {sortItems(filter ? owned.filter((i) => approachOfItem(i) === filter) : owned, col.sort).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setJustUsed(null)
                  setOpenId(item.id)
                }}
                className="flex min-w-0 flex-col items-center gap-1 rounded-[18px] bg-[var(--bg)] px-1.5 py-2.5 text-center text-[13px] leading-snug text-[var(--text)]"
              >
                <span className="rounded-full bg-[var(--surface)] px-2.5 py-0.5 text-[12px]">{APPROACHES[approachOfItem(item)]}</span>
                <ItemIcon item={item} size={44} />
                <span className="line-clamp-2 w-full">{item.name}</span>
                <RestNote at={item.lastBattleAt} brief />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid shrink-0 grid-cols-2 gap-2 rounded-full bg-[var(--bg)] p-1">
        {([['road', '旅途'], ['bag', `物品 ${owned.length}`]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => {
              putBack()
              setTab(id)
            }}
            className={`rounded-full py-2.5 text-[14px] text-[var(--text)] ${tab === id ? 'bg-[var(--mint)] font-medium' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
