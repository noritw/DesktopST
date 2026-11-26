import { useEffect, useRef, useState } from 'react'
import {
  APPROACHES,
  FOE_FORMS,
  MIN_ITEMS,
  OUTCOME_TITLE,
  ROUND_COUNT,
  KNOWN_ROUNDS,
  approachOf,
  battlePool,
  buildBattleTalkMessage,
  bypassBattle,
  canReroll,
  knownWeak,
  roundWon,
  type Approach,
  type Battle,
  type BattleRecord,
  type BattleStore,
  type FoeText,
  type HandItem,
  type Person
} from '@core/walk/battle'
import { type JourneyMapId, type WalkCollection } from '@core/walk/items'
import { BATTLE_REWARDS, POINT_COSTS } from '@core/walk/points'
import { ITEM_RARITIES } from '@core/walk/items'
import { newId } from '../../runtime/id'
import { loadPoints, summonWalkItem } from '../../runtime/walkPoints'
import type { StorageAdapter } from '@core/adapters'
import { getStandaloneSession } from '../../runtime/sessionHolder'
import {
  beginBattle,
  endBattle,
  playBattleRound,
  rerollBattleRound,
  updateBattles,
  type WriteFoesResult
} from '../../runtime/walkBattle'
import { loadCollection } from '../../runtime/walkItems'
import { Avatar } from '../characters/Avatar'
import { BattlePicker } from './BattlePicker'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { APPROACH_ICONS } from './art'
import { FOE_ART } from './foeArt'

/** 三回合過招（`docs/walk-battle-design.md` §4）。 */

const PRIMARY = 'w-full rounded-full bg-[var(--mint2)] px-4 py-3 text-[15px] font-medium text-[var(--text)] disabled:opacity-45'
const SECONDARY = 'w-full rounded-full bg-[var(--bg)] px-4 py-2.5 text-[14px] text-[var(--text)] disabled:opacity-45'
const ROLL_MS = 1400

const WRITE_FAIL: Record<Extract<WriteFoesResult, { ok: false }>['reason'], string> = {
  no_key: '還沒設定 API Key，這次先用普通的對手',
  no_character: '找不到這位角色，這次先用普通的對手',
  failed: '這次沒寫成，先用普通的對手'
}
/** 這一場已經試著寫過，失敗也不自動重試 */
const triedBattles = new Set<string>()

const reducedMotion = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function WeakTag({ index, weak, state }: { index: number; weak: Approach | null; state: 'done' | 'missed' | 'now' | 'later' }): JSX.Element {
  return (
    <div
      className={`flex flex-col items-center gap-1 rounded-[16px] border-2 bg-[#FFFDF4] px-1 py-2 text-center text-[#3D5A52] ${
        state === 'now' ? 'border-[#3D5A52]' : 'border-transparent'
      } ${state === 'done' || state === 'missed' ? 'opacity-60' : ''}`}
    >
      <span className="text-[12px]">第 {index + 1} 回合怕</span>
      <span className="text-[15px] font-bold">{weak ? APPROACHES[weak] : '？'}</span>
      <span className="flex gap-1">
        {weak && <img src={APPROACH_ICONS[weak]} alt="" className="h-6 w-6" />}
      </span>
      <span className="text-[12px]">{state === 'done' ? '○ 贏了' : state === 'missed' ? '－ 閃過了' : ''}</span>
    </div>
  )
}

function Die({ face, rolling, dim }: { face: number; rolling: boolean; dim: boolean }): JSX.Element {
  const [shown, setShown] = useState(face)
  useEffect(() => {
    if (!rolling) {
      setShown(face)
      return
    }
    const t = setInterval(() => setShown(1 + Math.floor(Math.random() * 6)), 90)
    return () => clearInterval(t)
  }, [face, rolling])
  return (
    <span
      className={`flex h-14 w-14 items-center justify-center rounded-[16px] border-2 border-[#3D5A52] bg-[#FFFDF4] text-[26px] font-bold text-[#3D5A52] ${
        rolling ? 'anim-journey-shake' : ''
      } ${dim ? 'opacity-40' : ''}`}
    >
      {shown}
    </span>
  )
}

function HandCard({ card, hit, disabled, onPick }: { card: HandItem; hit: boolean; disabled: boolean; onPick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className={`flex items-center gap-3 rounded-[18px] border-2 bg-[var(--bg)] px-3 py-2 text-left text-[var(--text)] disabled:opacity-45 ${
        hit ? 'border-[var(--mint2)]' : 'border-transparent'
      }`}
    >
      <img src={APPROACH_ICONS[approachOf(card.category)]} alt="" className="h-10 w-10 shrink-0 rounded-full bg-[#FFFDF4] p-1" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug">{card.name}</span>
        <span className="block text-[12px] text-[var(--text-sub)]">{card.finderName}找到的</span>
      </span>
      <span className="shrink-0 rounded-full bg-[var(--surface)] px-3 py-1 text-[13px]">{APPROACHES[approachOf(card.category)]}</span>
    </button>
  )
}

export function BattleView({
  store,
  present,
  storage,
  map,
  onChange,
  onClose
}: {
  store: BattleStore
  present: readonly Person[]
  storage: StorageAdapter
  /** 應急拿道具時從這張地圖的道具表抽 */
  map: JourneyMapId
  onChange: (s: BattleStore) => void
  onClose: () => void
}): JSX.Element | null {
  const ui = useUiStore()
  const b = store.current
  /** 已經看過結果的回合數；續打時，還能重擲或已打完三回合的最後一回合要再看一次 */
  const [seen, setSeen] = useState(() => (b ? b.rounds.length - (canReroll(b) || b.rounds.length === ROUND_COUNT ? 1 : 0) : 0))
  const [rolling, setRolling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<BattleRecord | null>(null)
  const [picking, setPicking] = useState<WalkCollection | null>(null)
  const [points, setPoints] = useState<number | null>(null)

  const needsFoes = !!b && !b.hand && !store.foes[b.leadId] && !store.declined && !triedBattles.has(b.id)
  /** 敵人還沒定案時先不露出名稱 */
  const [writing, setWriting] = useState<'asking' | 'writing' | null>(needsFoes ? 'asking' : null)
  const started = useRef(false)
  const alive = useRef(true)

  /** `again`＝使用者自己按的。 */
  const writeFoes = async (battle: Battle, again: boolean): Promise<void> => {
    triedBattles.add(battle.id)
    setWriting('asking')
    try {
      if (again || !store.consented) {
        const ok = await ui.confirm({
          title: again && store.foes[battle.leadId] ? '換一批敵人' : `${battle.leadName}專屬的敵人`,
          message: `會把${battle.leadName}的角色卡與世界觀設定送到你設定的 AI 服務，一次寫好六個敵人，費用約等於一則較長的回覆。步數和使用者設定不會送出。不寫也可以打，會用普通的對手。`,
          confirmLabel: '同意並寫',
          cancelLabel: again ? '取消' : '用普通的'
        })
        onChange(await updateBattles(storage, (s) => (ok ? { ...s, consented: true, declined: false } : again ? s : { ...s, declined: true })))
        if (!ok) return
      }
      setWriting('writing')
      const r = await getStandaloneSession()?.writeWalkFoes(battle.leadId)
      if (r?.ok) onChange(r.store)
      else if (alive.current) ui.toast(again && store.foes[battle.leadId] ? '這次沒寫成，敵人沒有換' : WRITE_FAIL[r?.reason ?? 'failed'])
    } catch {
      if (alive.current) ui.toast(WRITE_FAIL.failed)
    } finally {
      setWriting(null)
    }
  }

  useEffect(() => {
    alive.current = true
    if (b && needsFoes && !started.current) {
      started.current = true
      void writeFoes(b, false)
    }
    return () => {
      alive.current = false
    }
    // 只在進場時判斷一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!rolling) return
    const t = setTimeout(() => setRolling(false), ROLL_MS)
    return () => clearTimeout(t)
  }, [rolling])

  const run = async (work: () => Promise<BattleStore>, after?: (s: BattleStore) => void): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const s = await work()
      after?.(s)
      onChange(s)
    } catch {
      ui.toast('儲存失敗，再試一次', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        <div className="anim-pop-in flex flex-col items-center gap-3 rounded-[24px] bg-[var(--bg)] px-5 py-4 text-center text-[var(--text)]">
          <img src={FOE_ART[result.form]} alt="" className="h-32 w-32" />
          <p className="text-[14px] text-[var(--text-sub)]">{result.text.name}</p>
          <p className="text-[24px] font-bold">{OUTCOME_TITLE[result.outcome]}</p>
          <p className="w-full text-left text-[16px] leading-[1.8]">{result.text[result.outcome]}</p>
          <p className="w-full rounded-[14px] bg-[var(--surface)] px-3 py-2 text-[15px] font-medium">
            ＋{BATTLE_REWARDS[result.outcome].points.toLocaleString()} 點
            {BATTLE_REWARDS[result.outcome].box &&
              `，還留下一個箱子${result.outcome === 'perfect' ? `（至少${ITEM_RARITIES[BATTLE_REWARDS[result.outcome].box!].label}）` : ''}`}
          </p>
          <ul className="w-full space-y-1.5 text-left text-[14px]">
            {result.rounds.map((r, i) => (
              <li key={i} className="rounded-[14px] bg-[var(--surface)] px-3 py-2">
                {r.actorName}拿出「{r.itemName}」
                <span className="text-[var(--text-sub)]">{r.won ? ' 這回合贏了' : ' 它閃過了'}</span>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          className={PRIMARY}
          onClick={() => {
            ui.popAll()
            void useAppStore.getState().send({ content: buildBattleTalkMessage(result) })
          }}
        >
          聊聊這場戰鬥
        </button>
        <button type="button" className={SECONDARY} onClick={onClose}>回到旅途</button>
      </div>
    )
  }

  if (!b) return null

  const text: FoeText = b.text ?? store.foes[b.leadId]?.list[b.form] ?? FOE_FORMS[b.form].fallback

  // ── 選物品 ──
  if (!b.hand && picking) {
    return (
      <BattlePicker
        collection={picking}
        known={knownWeak(b)}
        busy={busy}
        points={points}
        summonCost={POINT_COSTS.summonItem}
        onSummon={async (approach) => {
          const r = await summonWalkItem(storage, { approach, map, finder: { id: b.leadId, name: b.leadName }, newId })
          setPoints((await loadPoints(storage)).balance)
          if (!r.ok) {
            ui.toast(r.reason === 'no_points' ? `點數不夠，要 ${POINT_COSTS.summonItem.toLocaleString()} 點` : '這次沒拿出來，點數已退回', 'error')
            return null
          }
          ui.toast(`拿出了「${r.item.name}」`)
          setPicking(await loadCollection(storage))
          return r.item.id
        }}
        onBack={() => setPicking(null)}
        onStart={(ids) =>
          void run(
            () => beginBattle(storage, b.id, ids),
            (s) => {
              if (!s.current?.hand) {
                ui.toast('有物品不能出場了，請重新選')
                setPicking(null)
              }
            }
          )
        }
      />
    )
  }

  const openPicker = async (): Promise<void> => {
    try {
      const c = await loadCollection(storage)
      setPoints((await loadPoints(storage)).balance)
      // 不夠的話也讓人進去，可以花點數補
      if (battlePool(c.items, Date.now()).length < MIN_ITEMS) ui.toast(`能出場的不到 ${MIN_ITEMS} 件，可以花點數拿出道具`)
      setPicking(c)
    } catch {
      ui.toast('讀取物品失敗，再試一次', 'error')
    }
  }

  // ── 遇到 ──
  if (!b.hand) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
        <div className="anim-pop-in flex flex-col items-center gap-3 rounded-[24px] bg-[var(--bg)] px-5 py-4 text-center text-[var(--text)]">
          <img src={FOE_ART[b.form]} alt="" className="anim-journey-nod h-24 w-24" />
          {writing ? (
            <p role="status" className="py-3 text-[17px] font-medium leading-snug">
              {b.leadName}正在看清楚那是什麼
              <span className="journey-dots" aria-hidden="true"><span /><span /><span /></span>
            </p>
          ) : (
            <>
              <p className="text-[24px] font-bold leading-snug">{text.name}</p>
              <Speech lead={b} text={text.intro} />
            </>
          )}
          <div className="grid w-full grid-cols-3 gap-2">
            {b.weak.map((w, i) => (
              <WeakTag key={i} index={i} weak={i < KNOWN_ROUNDS ? w : null} state="later" />
            ))}
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--text-sub)]">
            選 3～5 件物品，每回合拿出一件。做法對了就擲兩顆骰子取高的，4 以上就贏。第 3 回合怕什麼，打完第 2 回合才知道。出場的物品會休息 24 小時。
          </p>
        </div>
        <button
          type="button"
          className={PRIMARY}
          disabled={busy || writing === 'asking'}
          onClick={() => void openPicker()}
        >
          {writing === 'writing' ? '不等了，先選物品' : '選物品'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={SECONDARY} onClick={onClose}>先不管它</button>
          <button
            type="button"
            className={SECONDARY}
            disabled={busy}
            onClick={() => void run(() => updateBattles(storage, (s) => bypassBattle(s, b.id)), onClose)}
          >
            繞過它
          </button>
        </div>
        {!writing && (
          <button type="button" className="w-full py-2 text-[14px] text-[var(--text-sub)]" onClick={() => void writeFoes(b, true)}>
            {store.foes[b.leadId] ? '換一批敵人' : `寫${b.leadName}專屬的敵人`}
          </button>
        )}
      </div>
    )
  }

  const round = Math.min(seen, ROUND_COUNT - 1)
  const played = b.rounds[round]
  const card = played ? b.hand.find((h) => h.itemId === played.itemId) : undefined
  const weakNow = b.weak[round]

  const pick = (h: HandItem): void => {
    void run(
      () => playBattleRound(storage, { battleId: b.id, round, itemId: h.itemId, present, now: Date.now() }),
      () => setRolling(!reducedMotion())
    )
  }

  const next = (): void => {
    if (round + 1 < ROUND_COUNT) {
      setSeen(round + 1)
      return
    }
    void run(
      () => endBattle(storage, b.id),
      (s) => {
        const record = s.log.find((r) => r.id === b.id) ?? null
        setResult(record)
        if (record) {
          void getStandaloneSession()
            ?.rewardWalkBattle(record.id, record.outcome, { id: record.leadId, name: record.leadName })
            .catch((e) => console.warn('[Walk] 發過招獎勵失敗:', e))
        }
      }
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-2">
      <div className="flex flex-col items-center gap-2 rounded-[24px] bg-[var(--bg)] px-4 py-4 text-center text-[var(--text)]">
        <img
          src={FOE_ART[b.form]}
          alt=""
          className={`h-20 w-20 ${rolling ? 'anim-journey-shake' : 'anim-journey-nod'} ${played && !rolling && roundWon(played) ? 'opacity-70' : ''}`}
        />
        <p className="text-[18px] font-bold">{text.name}</p>
        <div className="grid w-full grid-cols-3 gap-2">
          {b.weak.map((w, i) => {
            const r = b.rounds[i]
            const shown = r && (i < round || (i === round && !rolling))
            const known = i < KNOWN_ROUNDS || round >= KNOWN_ROUNDS
            return <WeakTag key={i} index={i} weak={known ? w : null} state={shown ? (roundWon(r) ? 'done' : 'missed') : i === round ? 'now' : 'later'} />
          })}
        </div>
      </div>

      {played && card ? (
        <>
          <div
            className="anim-pop-in flex flex-col items-center gap-3 rounded-[24px] bg-[var(--bg)] px-4 py-5 text-center text-[var(--text)]"
            onClick={() => setRolling(false)}
          >
            <Avatar characterId={played.actorId} size={64} />
            <p className="text-[16px] leading-relaxed">
              {played.actorId !== b.leadId && <span className="block font-medium">{played.actorName}來幫忙！</span>}
              {played.actorName}拿出「{card.name}」
            </p>
            <div className="flex gap-3">
              {played.rolls.map((f, i) => (
                <Die
                  key={i}
                  face={f}
                  rolling={rolling}
                  dim={!rolling && played.rolls.length === 2 && i === (played.rolls[0] >= played.rolls[1] ? 1 : 0)}
                />
              ))}
            </div>
            <p role="status" className="min-h-[28px] text-[18px] font-bold">
              {rolling ? '' : roundWon(played) ? `${APPROACHES[approachOf(card.category)]}成功！` : '它閃過了'}
            </p>
            {!rolling && roundWon(played) && card.move && <p className="text-[15px] leading-relaxed">{card.move}</p>}
          </div>
          {!rolling && (
            <div className={canReroll(b) ? 'grid grid-cols-2 gap-2' : ''}>
              {canReroll(b) && (
                <button
                  type="button"
                  className={PRIMARY}
                  disabled={busy}
                  onClick={() => void run(() => rerollBattleRound(storage, b.id, round), () => setRolling(!reducedMotion()))}
                >
                  再擲一次
                </button>
              )}
              <button type="button" className={canReroll(b) ? SECONDARY : PRIMARY} disabled={busy} onClick={next}>
                {round + 1 < ROUND_COUNT ? '下一回合' : '看結果'}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-center text-[14px] text-[var(--text)]">要拿出哪一件？</p>
          <div className="grid gap-2">
            {b.hand
              .filter((h) => !b.rounds.some((r) => r.itemId === h.itemId))
              .map((h) => (
                <HandCard
                  key={h.itemId}
                  card={h}
                  hit={approachOf(h.category) === weakNow}
                  disabled={busy}
                  onPick={() => pick(h)}
                />
              ))}
          </div>
          <button type="button" className={SECONDARY} onClick={onClose}>等一下再打</button>
        </>
      )}
    </div>
  )
}

function Speech({ lead, text }: { lead: Battle; text: string }): JSX.Element {
  return (
    <div className="flex w-full items-center gap-3 text-left">
      <Avatar characterId={lead.leadId} size={52} />
      <p className="min-w-0 flex-1 rounded-[18px] bg-[var(--surface)] px-4 py-3 text-[15px] leading-relaxed">{text}</p>
    </div>
  )
}
