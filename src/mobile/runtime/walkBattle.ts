import type { StorageAdapter } from '@core/adapters'
import {
  countOpened,
  finishBattle,
  keepLead,
  markBattled,
  normalizeBattleStore,
  playRound,
  rerollRound,
  startBattle,
  tryAppear,
  type AppearContext,
  type BattleStore,
  type PlayInput
} from '@core/walk/battle'
import { buildFoePrompt, parseFoeReply } from '@core/walk/foes'
import { loadCollection, updateCollection } from './walkItems'
import { walkBattlesKey } from './walkKeys'

/** 過招的手機 runtime（`docs/walk-battle-design.md`）。 */

export async function loadBattles(storage: StorageAdapter): Promise<BattleStore> {
  return normalizeBattleStore(await storage.readJson<unknown>(walkBattlesKey))
}

let queue: Promise<unknown> = Promise.resolve()

export function updateBattles(
  storage: StorageAdapter,
  fn: (s: BattleStore) => BattleStore | Promise<BattleStore>
): Promise<BattleStore> {
  const run = queue.then(async () => {
    const before = await loadBattles(storage)
    const after = await fn(before)
    if (after !== before) await storage.writeJson(walkBattlesKey, after)
    return after
  })
  queue = run.catch(() => {})
  return run
}

/** 出場時間補寫到物品上；回合先存、這裡後存，中斷時重做結果相同。 */
async function markItems(storage: StorageAdapter, s: BattleStore): Promise<void> {
  const rounds = s.current?.rounds ?? []
  if (rounds.length === 0) return
  await updateCollection(storage, (c) => {
    const items = markBattled(c.items, rounds)
    return items === c.items ? c : { ...c, items }
  })
}

/** 打開箱子成功一次。 */
export async function countOpenedBox(storage: StorageAdapter): Promise<void> {
  await updateBattles(storage, (s) => countOpened(s))
}

/** 進旅途時：補寫上次中斷的、主角離開就換人、該出現就出現。 */
export async function syncBattles(
  storage: StorageAdapter,
  ctx: Pick<AppearContext, 'present' | 'newId'>
): Promise<BattleStore> {
  const s = await updateBattles(storage, async (cur) =>
    keepLead(tryAppear(cur, { ...ctx, items: (await loadCollection(storage)).items }), ctx.present)
  )
  await markItems(storage, s)
  return s
}

export function beginBattle(
  storage: StorageAdapter,
  battleId: string,
  itemIds: readonly string[],
  now: number = Date.now()
): Promise<BattleStore> {
  return updateBattles(storage, async (s) => startBattle(s, battleId, (await loadCollection(storage)).items, itemIds, now))
}

export async function playBattleRound(storage: StorageAdapter, input: PlayInput): Promise<BattleStore> {
  const s = await updateBattles(storage, (cur) => playRound(cur, input))
  await markItems(storage, s)
  return s
}

export function rerollBattleRound(storage: StorageAdapter, battleId: string, round: number): Promise<BattleStore> {
  return updateBattles(storage, (s) => rerollRound(s, battleId, round))
}

export async function endBattle(storage: StorageAdapter, battleId: string, now: number = Date.now()): Promise<BattleStore> {
  // 收尾會清掉回合，先確定出場時間都寫到物品上
  await markItems(storage, await loadBattles(storage))
  return updateBattles(storage, (s) => finishBattle(s, battleId, now))
}

export type WriteFoesResult = { ok: true; store: BattleStore } | { ok: false; reason: 'no_key' | 'no_character' | 'failed' }

export interface WriteFoesDeps<C extends { id: string; name: string }> {
  storage: StorageAdapter
  character: C | null
  hasApiKey: boolean
  generate: (character: C, prompt: string, signal: AbortSignal) => Promise<string>
  timeoutMs?: number
}

const writing = new Map<string, Promise<WriteFoesResult>>()

/** 為角色寫一批敵人；成功才換掉舊的，同一角色同時只呼叫一次。 */
export function writeFoes<C extends { id: string; name: string }>(deps: WriteFoesDeps<C>): Promise<WriteFoesResult> {
  const { character } = deps
  if (!character) return Promise.resolve({ ok: false, reason: 'no_character' })
  if (!deps.hasApiKey) return Promise.resolve({ ok: false, reason: 'no_key' })
  const running = writing.get(character.id)
  if (running) return running
  const p = doWriteFoes(deps, character).finally(() => writing.delete(character.id))
  writing.set(character.id, p)
  return p
}

async function doWriteFoes<C extends { id: string; name: string }>(deps: WriteFoesDeps<C>, character: C): Promise<WriteFoesResult> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort()
        reject(new Error('timeout'))
      }, deps.timeoutMs ?? 90_000)
    })
    const list = parseFoeReply(await Promise.race([deps.generate(character, buildFoePrompt(character.name), abort.signal), expired]))
    if (!list) return { ok: false, reason: 'failed' }
    const store = await updateBattles(deps.storage, (s) => ({
      ...s,
      foes: {
        ...s.foes,
        // 這次沒寫成的形，留著上一批的
        [character.id]: { name: character.name, madeAt: Date.now(), list: { ...s.foes[character.id]?.list, ...list } }
      }
    }))
    return { ok: true, store }
  } catch (e) {
    console.warn('[Walk] 寫敵人失敗:', e)
    return { ok: false, reason: 'failed' }
  } finally {
    clearTimeout(timer)
  }
}

/** 測試版用：讓下一個對手立刻可以出現。 */
export function forceEncounter(storage: StorageAdapter): Promise<BattleStore> {
  return updateBattles(storage, (s) => (s.current ? s : { ...s, opened: 3, nextAt: 3 }))
}
