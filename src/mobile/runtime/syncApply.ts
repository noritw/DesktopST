import * as keys from '@core/store/keys'
import { KINDS, actionFor, type ChoiceMap, type PairAction, type PairKind, type PairRow, type PairTable } from '@core/sync/pair'
import type { Character, PersonaPreset, Reminder, ScenePreset, WorldPreset } from '@core/types'
import type { Lorebook } from '@core/lore/types'
import type { CharacterDisplayConfigMap } from '@core/character/displayImage'
import { importCharactersFromDstPack } from './seedDefaults'
import type { StandaloneSession } from './session'
import { getJson, postJson, type FetchImpl, type SyncSource } from './syncTransport'

/**
 * S2 M4：把逐項比對畫面上的決定真的執行掉。
 *
 * ## 和 M3 的差別
 *
 * M3 是「整包帶過去」：算一份 diff、整批推或整批拉，方向由「切去哪個模式」
 * 決定。M4 是**逐列**的——同一趟裡可能有些列往電腦推、有些列往手機拉，
 * 由使用者在畫面上一項項選。
 *
 * ## 執行順序不能改
 *
 * 情境（scene）**參照**使用者設定／世界觀／角色／用語解說的 id，而那些 id
 * 在兩台機器上不一樣。所以必須先把被參照的東西處理完、記下「這一邊的 id
 * 對應到那一邊的哪個 id」，最後才處理情境並把參照翻譯過去。
 *
 * 漏掉這一步的後果是實際發生過的：M3 推情境時原樣送出手機的
 * `activePersonaId`，電腦上根本沒有那個 id，於是電腦上一堆情境指向不存在的
 * 使用者設定與世界觀（owner 2026-08-13 的電腦上有 10 處這種死參照）。
 * 畫面不會報錯，只是套用情境時該有的設定沒被套上。
 */

/** 一邊的 id → 另一邊的 id。 */
export type IdMap = Map<string, string>

export interface Maps {
  /** 手機 id → 電腦 id */
  l2r: Record<PairKind, IdMap>
  /** 電腦 id → 手機 id */
  r2l: Record<PairKind, IdMap>
}

function buildMaps(table: PairTable): Maps {
  const l2r = {} as Record<PairKind, IdMap>
  const r2l = {} as Record<PairKind, IdMap>
  for (const kind of KINDS) {
    l2r[kind] = new Map()
    r2l[kind] = new Map()
    for (const row of table[kind]) {
      if (row.localId && row.remoteId) {
        l2r[kind].set(row.localId, row.remoteId)
        r2l[kind].set(row.remoteId, row.localId)
      }
    }
  }
  return { l2r, r2l }
}

export interface ApplyResult {
  /** 推到電腦的名字（依 collection）。 */
  pushed: Record<PairKind, string[]>
  /** 拉回手機的名字。 */
  pulled: Record<PairKind, string[]>
  /** 從手機刪掉的名字。 */
  deletedLocal: Record<PairKind, string[]>
  /** 從電腦刪掉的名字。 */
  deletedRemote: Record<PairKind, string[]>
  /** 個別失敗的項目——**單筆失敗不中斷整趟**，最後一起回報。 */
  failed: { kind: PairKind; name: string; error: string }[]
  /**
   * 這一趟結束時的 id 對應表。
   *
   * **對話同步一定要拿這一份，不能自己重算。** 表裡的角色對應有一部分是
   * 這趟推送當下才由電腦端回應決定的（新建角色時電腦會發新 uuid），
   * 只看比對畫面上那張表的話，剛推過去的角色一律查不到 —— 對話裡那些訊息
   * 的 `characterId` 就會翻不出來。
   */
  idMaps: Maps
}

export interface ApplyOptions {
  table: PairTable
  choices: ChoiceMap
  onProgress?: (message: string) => void
}

const KIND_LABEL: Record<PairKind, string> = {
  characters: '角色',
  personas: '使用者設定',
  worlds: '世界觀',
  scenes: '情境',
  lorebooks: '用語解說',
  reminders: '提醒',
  characterDisplay: '角色顯示裁切'
}

/**
 * 執行順序：被參照的先做，情境最後。
 * 用語解說排最前面是因為角色與世界觀都會參照它。
 * 提醒排在最後：它的 `characterId`／`sceneId` 要靠這一趟累積出來的
 * `maps.l2r.characters`／`maps.l2r.scenes` 翻譯，必須等角色與情境都處理完。
 * `characterDisplay` 也排在 `characters` 之後：它的「id」本身就是
 * characterId，第一次推送（本地獨有）時要靠 `maps.l2r.characters`／
 * `maps.r2l.characters` 把 id 換成對面的角色 id，見下面 `pushOne`/`pullOne`。
 */
const ORDER: PairKind[] = ['lorebooks', 'characters', 'personas', 'worlds', 'scenes', 'reminders', 'characterDisplay']

export async function applySync(
  src: SyncSource,
  session: StandaloneSession,
  opts: ApplyOptions,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<ApplyResult> {
  const maps = buildMaps(opts.table)
  const empty = (): Record<PairKind, string[]> => ({
    characters: [], personas: [], worlds: [], scenes: [], lorebooks: [], reminders: [], characterDisplay: []
  })
  const result: ApplyResult = {
    pushed: empty(),
    pulled: empty(),
    deletedLocal: empty(),
    deletedRemote: empty(),
    failed: [],
    idMaps: maps
  }

  /** 這一趟要做的事，先全部算出來再執行——刪除必須排到最後（見下面）。 */
  const jobs: { kind: PairKind; row: PairRow; action: PairAction }[] = []
  for (const kind of ORDER) {
    for (const row of opts.table[kind]) {
      const action = actionFor(row, opts.choices[kind]?.[row.key] ?? 'keep')
      if (action !== 'none') jobs.push({ kind, row, action })
    }
  }

  const run = async (job: { kind: PairKind; row: PairRow; action: PairAction }): Promise<void> => {
    const { kind, row, action } = job
    const label = `${KIND_LABEL[kind]}「${row.name}」`
    try {
      switch (action) {
        case 'push':
          opts.onProgress?.(`推送${label}⋯⋯`)
          await pushOne(src, session, kind, row, maps, fetchImpl)
          result.pushed[kind].push(row.name)
          break
        case 'pull':
          opts.onProgress?.(`帶回${label}⋯⋯`)
          await pullOne(src, session, kind, row, maps, fetchImpl)
          result.pulled[kind].push(row.name)
          break
        case 'delete-local':
          opts.onProgress?.(`從手機刪除${label}⋯⋯`)
          await deleteLocal(session, kind, row.localId!)
          result.deletedLocal[kind].push(row.name)
          break
        case 'delete-remote':
          opts.onProgress?.(`從電腦刪除${label}⋯⋯`)
          await deleteRemote(src, kind, row.remoteId!, fetchImpl)
          result.deletedRemote[kind].push(row.name)
          break
      }
    } catch (err) {
      // 單筆失敗不能讓整趟停下——十筆做到第七筆斷線時，前六筆不該一起白做。
      result.failed.push({ kind, name: row.name, error: err instanceof Error ? err.message : String(err) })
    }
  }

  // ① 先做所有複製（ORDER：被參照的先做，情境最後）
  for (const job of jobs.filter((j) => j.action === 'push' || j.action === 'pull')) await run(job)

  /*
   * ② 刪除全部排到最後，而且**順序反過來**（情境 → 世界觀 → 人設 → 角色 → 用語解說）。
   *
   * 兩個理由：
   * - 複製要用得到被刪的那些東西。同一趟裡可能「推情境」又「刪角色」，
   *   情境推送要靠 id 對應表翻譯角色參照——先刪掉的話那一項會被當成翻不出來而丟掉。
   * - 刪除本身也有依賴：先刪情境再刪它引用的角色，才不會中間出現一個指向
   *   剛消失的角色的情境。
   */
  const deleteOrder = [...ORDER].reverse()
  const deletions = jobs.filter((j) => j.action === 'delete-local' || j.action === 'delete-remote')
  for (const kind of deleteOrder) {
    for (const job of deletions.filter((j) => j.kind === kind)) await run(job)
  }

  // 落地後畫面要重讀，否則清單還停在舊資料（CLAUDE.md §5：改完資料一定要推事件）
  await session.reloadPresets()
  await session.reloadCharacters()
  session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  return result
}

// ── 推：手機 → 電腦 ────────────────────────────────────────

async function pushOne(
  src: SyncSource,
  session: StandaloneSession,
  kind: PairKind,
  row: PairRow,
  maps: Maps,
  fetchImpl: FetchImpl
): Promise<void> {
  const localId = row.localId!

  if (kind === 'characters') {
    const { bytes } = await session.exportPack([localId], {
      includeGlobalSettings: false,
      includeLorebooks: false,
      // 用語解說在上面那一輪已經處理完，這裡把卡片上的參照換成電腦端的 id
      remapLorebookIds: (id) => maps.l2r.lorebooks.get(id)
    })
    /*
     * `targetId` 有值時電腦端直接蓋在那一隻上，不再靠 id／名稱猜（見
     * `ipcHandlers.ts` 的 `DstPackImportResolvers.targetId`）。沒有值＝
     * 電腦上真的沒有這隻，讓它照原本規則建新的。
     */
    const q = new URLSearchParams({ onConflict: row.remoteId ? 'overwrite' : 'new' })
    if (row.remoteId) q.set('targetId', row.remoteId)
    const res = await postBinary(src, `/api/characters/import-pack?${q}`, bytes, fetchImpl)
    const realId = res.ids?.[0]
    if (realId) recordPair(maps, kind, localId, realId)
    return
  }

  if (kind === 'lorebooks') {
    const book = await session.getLorebook(localId)
    if (!book) throw new Error('本機找不到這本用語解說')
    const out = await postJson<{ book?: Lorebook }>(
      src,
      '/api/lorebooks/save',
      { book: { ...book, id: row.remoteId ?? book.id } },
      fetchImpl
    )
    recordPair(maps, kind, localId, out.book?.id ?? row.remoteId ?? book.id)
    return
  }

  if (kind === 'personas' || kind === 'worlds') {
    const list = kind === 'personas' ? session.personas : session.worlds
    const item = list.find((x) => x.id === localId)
    if (!item) throw new Error('本機找不到這一筆')
    const preset: Record<string, unknown> = { ...item, id: row.remoteId ?? '' }
    if (kind === 'worlds') {
      preset.lorebookIds = translateIds((item as WorldPreset).lorebookIds, maps.l2r.lorebooks)
    }
    const out = await postJson<{ preset?: { id: string } }>(
      src,
      `/api/presets/${kind === 'personas' ? 'persona' : 'world'}/save`,
      { preset },
      fetchImpl
    )
    // 電腦端可能發了一顆新 id（送空 id 時必然如此），一定要用回應裡那個
    if (out.preset?.id) recordPair(maps, kind, localId, out.preset.id)
    return
  }

  if (kind === 'characterDisplay') {
    /*
     * 這個種類的「id」本身就是 characterId。row 已配對到時 `row.remoteId`
     * 直接就是對面的角色 id；第一次推送（本地獨有）時沒有這個，要靠角色本身
     * 那趟同步累積出來的 `maps.l2r.characters` 翻譯——翻不到代表角色還沒
     * 同步過去，帶框選範圍過去沒有意義。
     */
    const remoteCharId = row.remoteId ?? maps.l2r.characters.get(localId)
    if (!remoteCharId) throw new Error('角色還沒同步到電腦，無法帶框選範圍過去')
    const rect = await session.getFaceCrop(localId)
    await postJson(src, '/api/character-display-config/save', { characterId: remoteCharId, faceCrop: rect }, fetchImpl)
    return
  }

  if (kind === 'reminders') {
    const local = session.reminders.find((r) => r.id === localId)
    if (!local) throw new Error('本機找不到這個提醒')

    /*
     * `notificationDevice`／`wakeMode`／`inactiveBehavior`／`allowOfflineFallback`／
     * `lastTriggeredAt` 是裝置本地設定或衍生狀態（`docs/reminder-sync-kickoff.md` §3），
     * 已存在電腦上的那筆先讀出來，把這些欄位蓋回去，不能整包覆蓋。
     */
    let existingRemote: Reminder | undefined
    if (row.remoteId) {
      const list = await getJson<{ reminders?: Reminder[] }>(src, '/api/reminders', fetchImpl)
      existingRemote = list.reminders?.find((r) => r.id === row.remoteId)
    }

    const reminder: Reminder = {
      ...local,
      id: row.remoteId ?? local.id,
      characterId: local.characterId ? maps.l2r.characters.get(local.characterId) : undefined,
      sceneId: local.sceneId ? maps.l2r.scenes.get(local.sceneId) : undefined,
      // 對話同步是完全獨立的一套配對，這裡沒有對照表可翻——對不到就整欄位不推，
      // 死參照比「這筆提醒暫時沒綁對話」糟得多（`docs/reminder-sync-kickoff.md` §5）
      conversationId: undefined,
      notificationDevice: existingRemote?.notificationDevice ?? local.notificationDevice,
      wakeMode: existingRemote?.wakeMode ?? local.wakeMode,
      inactiveBehavior: existingRemote?.inactiveBehavior ?? local.inactiveBehavior,
      allowOfflineFallback: existingRemote?.allowOfflineFallback ?? local.allowOfflineFallback,
      lastTriggeredAt: existingRemote?.lastTriggeredAt
    }
    const out = await postJson<{ reminder?: Reminder }>(src, '/api/reminders/save', { reminder }, fetchImpl)
    recordPair(maps, kind, localId, out.reminder?.id ?? reminder.id)
    return
  }

  // ── 情境 ──
  const scene = session.scenes.find((s) => s.id === localId)
  if (!scene) throw new Error('本機找不到這個情境')

  /*
   * 座標／大小／翻面／視窗位置是**電腦專屬**的（手機沒有桌寵），一律沿用電腦
   * 上原本那份，不要用手機的值覆蓋——手機端這些欄位多半是匯入時給的預設值，
   * 推過去等於把使用者精心擺好的桌面洗掉。
   */
  let existingRemote: ScenePreset | null = null
  if (row.remoteId) {
    // ⚠️ 端點回的是 `{ preset }` 外層，不是裸物件。漏拆的話 `desktopCharacters`
    // 是 undefined，於是每次推送都用手機的預設座標蓋掉電腦的桌寵配置——
    // 而且完全不會報錯（測試「推情境時沿用電腦上原本的座標」就是抓這個）。
    existingRemote = await getJson<{ preset?: ScenePreset }>(src, `/api/presets/scene/${encodeURIComponent(row.remoteId)}`, fetchImpl)
      .then((r) => r.preset ?? null)
      .catch(() => null)
  }
  const remoteLayout = new Map((existingRemote?.desktopCharacters ?? []).map((dc) => [dc.characterId, dc]))

  const desktopCharacters = (scene.desktopCharacters ?? []).flatMap((dc) => {
    const remoteCharId = maps.l2r.characters.get(dc.characterId)
    // 對不到電腦上的角色就整項不推——推一個死參照過去比少推一個角色糟糕得多
    if (!remoteCharId) return []
    const layout = remoteLayout.get(remoteCharId)
    return [{
      ...(layout ?? { position: { x: 200, y: 300 }, size: 1, flipped: false, zIndex: 1 }),
      characterId: remoteCharId,
      muted: !!dc.muted
    }]
  })

  const preset = {
    ...scene,
    id: row.remoteId ?? '',
    activePersonaId: maps.l2r.personas.get(scene.activePersonaId) ?? existingRemote?.activePersonaId ?? '',
    activeWorldId: maps.l2r.worlds.get(scene.activeWorldId) ?? existingRemote?.activeWorldId ?? '',
    desktopCharacters,
    lorebookIds: scene.lorebookIds === undefined ? undefined : translateIds(scene.lorebookIds, maps.l2r.lorebooks),
    // 視窗狀態是電腦專屬；對話指標**兩邊都有**但是裝置本地狀態（對話 id 各自不同，
    // 搬過去會指到不存在的對話），跟座標同一類：一律保留接收端原值、不跟著搬。
    // ⚠️ 這是刻意的，不是漏翻譯——情境切換後「使用者設定會換、對話不會換」即為預期行為。
    lastActiveConversationId: existingRemote?.lastActiveConversationId,
    inputWindowBounds: existingRemote?.inputWindowBounds,
    logWindowBounds: existingRemote?.logWindowBounds
  }
  const out = await postJson<{ preset?: { id: string } }>(src, '/api/presets/scene/save', { preset }, fetchImpl)
  if (out.preset?.id) recordPair(maps, kind, localId, out.preset.id)
}

// ── 拉：電腦 → 手機 ────────────────────────────────────────

async function pullOne(
  src: SyncSource,
  session: StandaloneSession,
  kind: PairKind,
  row: PairRow,
  maps: Maps,
  fetchImpl: FetchImpl
): Promise<void> {
  const remoteId = row.remoteId!

  if (kind === 'characters') {
    const out = await postJson<{ data?: string }>(
      src,
      '/api/characters/export-pack',
      { ids: [remoteId], includeGlobalSettings: false, includeLorebooks: false },
      fetchImpl
    )
    if (!out.data) throw new Error('電腦沒有回傳角色包')
    const bytes = base64ToBytes(out.data)
    const oldLocalId = row.localId
    // 解壓後的角色沿用電腦端的 id，所以本機舊那份要先刪，避免變成兩隻
    if (oldLocalId) {
      await session.adapters.storage.remove(keys.characterDirKey(oldLocalId))
      session.characters = session.characters.filter((c) => c.id !== oldLocalId)
    }
    const { chars } = await importCharactersFromDstPack(session.adapters.storage, bytes)
    const landed = chars[0]
    if (!landed) throw new Error('角色包裡沒有角色')
    if (oldLocalId && oldLocalId !== landed.id) {
      await remapLocalCharacterId(session, oldLocalId, landed.id)
    }
    // 包裡的卡片掛的是電腦端的用語解說 id，換成本機的（換不到的拿掉，別留死參照）
    if (landed.lorebookIds?.length) {
      const next = translateIds(landed.lorebookIds, maps.r2l.lorebooks)
      if (next.join() !== landed.lorebookIds.join()) {
        await session.saveCharacter({ ...landed, lorebookIds: next })
      }
    }
    recordPair(maps, kind, landed.id, remoteId)
    return
  }

  if (kind === 'lorebooks') {
    // `/api/lorebooks` 只回 {id,name} 摘要，要整本得逐本讀（端點就是為此存在的）
    const { book } = await getJson<{ book?: Lorebook }>(src, `/api/lorebooks/${encodeURIComponent(remoteId)}`, fetchImpl)
    if (!book) throw new Error('電腦上找不到這本用語解說')
    const targetId = row.localId ?? book.id
    await session.saveLorebook({ ...book, id: targetId })
    recordPair(maps, kind, targetId, remoteId)
    return
  }

  if (kind === 'personas' || kind === 'worlds') {
    const path = kind === 'personas' ? 'persona' : 'world'
    const out = await getJson<{ preset?: PersonaPreset | WorldPreset }>(
      src,
      `/api/presets/${path}/${encodeURIComponent(remoteId)}`,
      fetchImpl
    )
    const preset = out.preset ?? (out as unknown as PersonaPreset | WorldPreset)
    if (!preset?.name) throw new Error('電腦回的資料不完整')
    const targetId = row.localId ?? preset.id
    const next: Record<string, unknown> = { ...preset, id: targetId, updatedAt: Date.now() }
    if (kind === 'worlds') {
      next.lorebookIds = translateIds((preset as WorldPreset).lorebookIds, maps.r2l.lorebooks)
    }
    const key = kind === 'personas' ? keys.personaKey(targetId) : keys.worldKey(targetId)
    await session.adapters.storage.writeJson(key, next)
    recordPair(maps, kind, targetId, remoteId)
    return
  }

  if (kind === 'characterDisplay') {
    const localCharId = row.localId ?? maps.r2l.characters.get(remoteId)
    if (!localCharId) throw new Error('角色還沒同步到手機，無法帶框選範圍回來')
    const { config } = await getJson<{ config?: CharacterDisplayConfigMap }>(src, '/api/character-display-config', fetchImpl)
    const rect = config?.[remoteId]?.faceCrop ?? null
    await session.setFaceCrop(localCharId, rect)
    return
  }

  if (kind === 'reminders') {
    const list = await getJson<{ reminders?: Reminder[] }>(src, '/api/reminders', fetchImpl)
    const remote = list.reminders?.find((r) => r.id === remoteId)
    if (!remote) throw new Error('電腦上找不到這個提醒')
    const targetId = row.localId ?? remote.id
    const existingLocal = session.reminders.find((r) => r.id === targetId)

    const next: Reminder = {
      ...remote,
      id: targetId,
      characterId: remote.characterId ? maps.r2l.characters.get(remote.characterId) : undefined,
      sceneId: remote.sceneId ? maps.r2l.scenes.get(remote.sceneId) : undefined,
      conversationId: undefined,
      notificationDevice: existingLocal?.notificationDevice ?? remote.notificationDevice,
      wakeMode: existingLocal?.wakeMode ?? remote.wakeMode,
      inactiveBehavior: existingLocal?.inactiveBehavior ?? remote.inactiveBehavior,
      allowOfflineFallback: existingLocal?.allowOfflineFallback ?? remote.allowOfflineFallback,
      lastTriggeredAt: existingLocal?.lastTriggeredAt
    }
    await session.saveReminder(next)
    recordPair(maps, kind, targetId, remoteId)
    return
  }

  // ── 情境 ──
  const out = await getJson<{ preset?: ScenePreset }>(src, `/api/presets/scene/${encodeURIComponent(remoteId)}`, fetchImpl)
  const remote = out.preset ?? (out as unknown as ScenePreset)
  if (!remote?.name) throw new Error('電腦回的資料不完整')
  const targetId = row.localId ?? remote.id
  const existingLocal = session.scenes.find((s) => s.id === targetId)

  const next: ScenePreset = {
    ...remote,
    id: targetId,
    activePersonaId: maps.r2l.personas.get(remote.activePersonaId) ?? existingLocal?.activePersonaId ?? '',
    activeWorldId: maps.r2l.worlds.get(remote.activeWorldId) ?? existingLocal?.activeWorldId ?? '',
    desktopCharacters: (remote.desktopCharacters ?? []).flatMap((dc) => {
      const localCharId = maps.r2l.characters.get(dc.characterId)
      if (!localCharId) return []
      return [{ ...dc, characterId: localCharId }]
    }),
    lorebookIds: remote.lorebookIds === undefined ? undefined : translateIds(remote.lorebookIds, maps.r2l.lorebooks),
    // 對話指標是各自裝置的，不跟著搬（同上：刻意保留接收端原值，非漏翻譯）
    lastActiveConversationId: existingLocal?.lastActiveConversationId,
    updatedAt: Date.now()
  }
  await session.adapters.storage.writeJson(keys.sceneKey(targetId), next)
  recordPair(maps, kind, targetId, remoteId)
}

// ── 刪除 ──────────────────────────────────────────────────

/**
 * 從手機刪掉一筆（使用者在比對畫面選了「電腦」，而電腦上沒有這筆）。
 *
 * 一律走 `session` 既有的 `remove*` 方法，不要自己 `storage.remove()`：
 * 那些方法還負責清掉參照、處理「刪到正在用的那一組」、以及**「最後一組不給刪」**
 * 的保護。繞過去的話會刪出一個沒有任何使用者設定的狀態，prompt 組不出來
 * 而且畫面上沒地方加回來。保護擋下來時會丟錯，由呼叫端記進 `failed` 回報。
 */
async function deleteLocal(session: StandaloneSession, kind: PairKind, id: string): Promise<void> {
  switch (kind) {
    case 'characters': return session.removeCharacter(id)
    case 'personas': return session.removePersona(id)
    case 'worlds': return session.removeWorld(id)
    case 'scenes': return session.removeScene(id)
    case 'lorebooks': return session.removeLorebook(id)
    case 'reminders': return session.removeReminder(id)
    // 「刪除」對這個種類的意思是清除框選，不是刪角色本身——見 `setFaceCrop(id, null)`
    // 那條「清除也要留痕跡」的設計決策。
    case 'characterDisplay': return session.setFaceCrop(id, null)
  }
}

/** 從電腦刪掉一筆（使用者選了「手機」，而手機上沒有這筆）。 */
async function deleteRemote(src: SyncSource, kind: PairKind, id: string, fetchImpl: FetchImpl): Promise<void> {
  if (kind === 'characterDisplay') {
    await postJson<unknown>(src, '/api/character-display-config/save', { characterId: id, faceCrop: null }, fetchImpl)
    return
  }
  const path =
    kind === 'characters' ? '/api/characters/delete'
      : kind === 'lorebooks' ? '/api/lorebooks/delete'
        : kind === 'reminders' ? '/api/reminders/delete'
          : `/api/presets/${kind === 'personas' ? 'persona' : kind === 'worlds' ? 'world' : 'scene'}/delete`
  await postJson<unknown>(src, path, { id }, fetchImpl)
}

// ── 小工具 ────────────────────────────────────────────────

function recordPair(maps: Maps, kind: PairKind, localId: string, remoteId: string): void {
  maps.l2r[kind].set(localId, remoteId)
  maps.r2l[kind].set(remoteId, localId)
}

/** 翻譯一串 id；對不到的直接丟掉（留著就是死參照）。 */
function translateIds(ids: string[] | undefined, map: IdMap): string[] {
  return (ids ?? []).map((id) => map.get(id)).filter((id): id is string => !!id)
}

/**
 * 角色被電腦那份取代時，本機所有指向舊 id 的地方要跟著改。
 *
 * 漏掉的話症狀是「角色還在，但情境套用後它不出現、舊對話認不得它」——
 * 資料沒有不見，只是沒有人指得到它了。
 */
async function remapLocalCharacterId(session: StandaloneSession, oldId: string, newId: string): Promise<void> {
  session.settings.ui.desktopCharacters = session.settings.ui.desktopCharacters.map((d) =>
    d.characterId === oldId ? { ...d, characterId: newId } : d
  )
  await session.saveSettings()

  for (const scene of session.scenes) {
    const dcs = scene.desktopCharacters ?? []
    if (!dcs.some((dc) => dc.characterId === oldId)) continue
    const next = { ...scene, desktopCharacters: dcs.map((dc) => (dc.characterId === oldId ? { ...dc, characterId: newId } : dc)) }
    await session.adapters.storage.writeJson(keys.sceneKey(scene.id), next)
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * 二進位上傳。包成 `File` 的理由見 `syncPush.ts` 的 `pushBinary`：CapacitorHttp
 * 的 Android 橋接只有 `File` 這個 body 型別走 base64，其餘會被 UTF-8 往返弄壞。
 */
async function postBinary(
  src: SyncSource,
  path: string,
  data: Uint8Array,
  fetchImpl: FetchImpl
): Promise<{ ids?: string[] }> {
  const body = new File([new Uint8Array(data).slice().buffer as ArrayBuffer], 'push.bin', {
    type: 'application/octet-stream'
  })
  const res = await fetchImpl(`${src.baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${src.token}`, 'X-DesktopST-Token': src.token, 'Content-Type': 'application/octet-stream' },
    body
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  return (await res.json().catch(() => ({}))) as { ids?: string[] }
}

/** 型別工具：確保上面用到的 Character 型別有被參照到（避免 lint 認定未使用）。 */
export type { Character }
