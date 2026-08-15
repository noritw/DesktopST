import {
  convActionFor,
  defaultConvChoice,
  type ConvAction,
  type ConvChoiceMap,
  type ConvFieldChoiceMap,
  type ConvRow
} from '@core/sync/convPair'
import { mergeMessages, pickSummary } from '@core/sync/convHash'
import type { Conversation, Message } from '@core/types'
import { newId } from './id'
import type { IdMap } from './syncApply'
import type { StandaloneSession } from './session'
import { getJson, postJson, type FetchImpl, type SyncSource } from './syncTransport'

/**
 * S2 對話同步：把對話比對畫面上的決定真的執行掉。
 *
 * ## 跟其他資料的差別
 *
 * 角色／情境那些是**整份覆蓋**，一邊贏另一邊。對話是**聯集**——`merge` 的
 * 一列會同時往兩個方向搬東西：手機獨有的訊息推過去、電腦獨有的帶回來。
 * 所以這裡沒有「方向」這個概念，只有「補齊」。
 *
 * ## 為什麼要分批
 *
 * 訊息帶圖片 data URI，整則送會在 CapacitorHttp 的 base64 bridge 上爆掉
 * （`/api/sync-pack` 與 `/api/message-image` 都為了同一個理由拆過）。
 * 切塊依**累計位元組**而不是則數：單則帶三張圖就可能自己超過上限，
 * 照則數切的話那一塊照樣爆，而症狀是「大部分對話同步得好好的，唯獨
 * 帶圖那幾則永遠過不去」。
 *
 * ## 這一版不刪任何東西
 *
 * 某一邊少了幾則訊息一律當成「還沒收到」，補過去而不是刪掉對面。
 * 刪除同步不在這一版範圍內。
 */

/**
 * 單一請求的訊息位元組上限。
 *
 * 電腦端的 body 上限是 24 MB（`MEDIA_MAX_BODY`），這裡取一半當安全邊際：
 * 估算是照 JSON 字串長度算的，實際傳輸還要加上 base64 與標頭的膨脹。
 */
const CHUNK_MAX_BYTES = 12 * 1024 * 1024

/** 單一請求的則數上限。位元組才是主要限制，這個只是防止極端多的小訊息。 */
const CHUNK_MAX_MESSAGES = 200

export interface ConvApplyOptions {
  rows: ConvRow[]
  choices: ConvChoiceMap
  fieldChoices?: ConvFieldChoiceMap
  /** 角色 id 對應表，**必須是 `applySync()` 回傳的那一份**（見 `ApplyResult.idMaps`）。 */
  characterIds: { l2r: IdMap; r2l: IdMap }
  onProgress?: (message: string) => void
}

export interface ConvApplyResult {
  /** 補到電腦的則數（依對話計）。 */
  pushed: string[]
  /** 補回手機的則數。 */
  pulled: string[]
  /** 雙向補齊的對話標題。 */
  merged: string[]
  /** 總共補了多少則訊息到電腦／手機。 */
  messagesToRemote: number
  messagesToLocal: number
  /**
   * 被判重略過的則數（送過去／拉回來時對面已經有同一個 id）。
   *
   * ⚠️ **這不是「編輯衝突的則數」。** 正常路徑下永遠是 0：推送前先用
   * `?idsOnly=1` 算出電腦缺哪幾則、拉取也只拉本機缺的，同 id 的訊息
   * 根本不會被傳輸，所以**偵測不到某一邊把它編輯過**——要偵測就得比對
   * 內容，而那正是分批與 `idsOnly` 想避免的整份傳輸。
   *
   * 結果仍然符合規格（§6.2 ② 規則 2：兩邊各自保留自己那份），只是這件事
   * 是靜默發生的、也無從回報。這個計數的實際用途是**重試與重送**：
   * 分批推到一半斷線後重跑時，已經落地的那幾塊會被計進來，讓完成訊息
   * 不會誤報成「又補了 N 則」。
   */
  keptOwnVersion: number
  failed: { title: string; error: string }[]
}

/** 電腦端 `?idsOnly=1` 的回應形狀。 */
interface RemoteConvIds {
  id: string
  title: string
  updatedAt: number
  summary?: string
  summaryCoversTs?: number
  participantIds: string[]
  messageIds: string[]
}

export async function applyConversationSync(
  src: SyncSource,
  session: StandaloneSession,
  opts: ConvApplyOptions,
  fetchImpl: FetchImpl = globalThis.fetch
): Promise<ConvApplyResult> {
  const result: ConvApplyResult = {
    pushed: [],
    pulled: [],
    merged: [],
    messagesToRemote: 0,
    messagesToLocal: 0,
    keptOwnVersion: 0,
    failed: []
  }

  let touched = false
  for (const row of opts.rows) {
    const choice = opts.choices[row.key] ?? defaultConvChoice(row)
    const action = convActionFor(row, choice)
    const fieldPicks = opts.fieldChoices?.[row.key]
    const hasFieldWork = !!fieldPicks && Object.values(fieldPicks).some((c) => c === 'local' || c === 'remote')
    if (action === 'none' && !hasFieldWork) continue

    try {
      opts.onProgress?.(`同步對話「${row.title}」⋯⋯`)
      const did = await runOne(src, session, row, action, fieldPicks, opts.characterIds, result, fetchImpl)
      if (did) touched = true
    } catch (err) {
      // 單則失敗不中斷整趟——十則做到第七則斷線時，前六則不該一起白做
      result.failed.push({ title: row.title, error: err instanceof Error ? err.message : String(err) })
    }
  }

  /*
   * 改完資料一定要推事件，否則畫面停在舊清單（CLAUDE.md §5）。
   * 正在看的那則如果被合併過，`activeConversation` 也要重讀——
   * 它是同一個物件參照，但訊息陣列被換掉了，React 那邊不重讀不會更新。
   */
  if (touched) {
    session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }
  return result
}

async function runOne(
  src: SyncSource,
  session: StandaloneSession,
  row: ConvRow,
  action: ConvAction,
  fieldPicks: ConvFieldChoiceMap[string] | undefined,
  charIds: { l2r: IdMap; r2l: IdMap },
  result: ConvApplyResult,
  fetchImpl: FetchImpl
): Promise<boolean> {
  // ── 整則帶回手機（電腦獨有）──
  if (action === 'pull') {
    const { conversation } = await getJson<{ conversation?: Conversation }>(
      src,
      `/api/sync-conversation?id=${encodeURIComponent(row.remoteId!)}`,
      fetchImpl
    )
    if (!conversation) throw new Error('電腦上找不到這則對話')
    await session.addImportedConversation({
      ...conversation,
      id: newId(),
      participantIds: translateIds(conversation.participantIds, charIds.r2l),
      messages: (conversation.messages ?? []).map((m) => translateMessage(m, charIds.r2l)),
      importedFrom: {
        sourceId: conversation.id,
        sourceUpdatedAt: conversation.updatedAt,
        importedAt: Date.now()
      }
    })
    result.pulled.push(row.title)
    result.messagesToLocal += (conversation.messages ?? []).length
    return true
  }

  const local = row.localId ? session.getConversation(row.localId) : null
  if (!local) throw new Error('本機找不到這則對話')

  // ── 整則推到電腦（手機獨有）──
  if (action === 'push') {
    const remoteId = await pushMessages(src, local, undefined, local.messages ?? [], charIds.l2r, result, fetchImpl)
    result.pushed.push(row.title)
    await session.linkConversationToRemote(local.id, remoteId, Date.now())
    return true
  }

  // ── 雙向補齊 ──
  const remote = await getJson<{ conversation?: RemoteConvIds }>(
    src,
    `/api/sync-conversation?id=${encodeURIComponent(row.remoteId!)}&idsOnly=1`,
    fetchImpl
  ).then((r) => r.conversation)
  if (!remote) throw new Error('電腦上找不到這則對話')

  let changed = false

  // ① 手機 → 電腦：只送電腦沒有的那幾則
  const remoteHas = new Set(remote.messageIds)
  const missingOnRemote = (local.messages ?? []).filter((m) => !remoteHas.has(m.id))
  if (missingOnRemote.length > 0) {
    await pushMessages(src, local, remote.id, missingOnRemote, charIds.l2r, result, fetchImpl)
    changed = true
  }

  // ② 電腦 → 手機：本機缺的才拉，全部相同時連內容都不必抓
  const localHas = new Set((local.messages ?? []).map((m) => m.id))
  const missingOnLocal = remote.messageIds.filter((id) => !localHas.has(id))
  if (missingOnLocal.length > 0) {
    const { conversation: full } = await getJson<{ conversation?: Conversation }>(
      src,
      `/api/sync-conversation?id=${encodeURIComponent(remote.id)}`,
      fetchImpl
    )
    if (!full) throw new Error('電腦上找不到這則對話')
    const wanted = new Set(missingOnLocal)
    const incoming = (full.messages ?? [])
      .filter((m) => wanted.has(m.id))
      .map((m) => translateMessage(m, charIds.r2l))
    const { merged, written, skipped } = mergeMessages(local.messages ?? [], incoming)
    local.messages = merged
    result.messagesToLocal += written
    result.keptOwnVersion += skipped
    local.participantIds = [...new Set([...(local.participantIds ?? []), ...translateIds(full.participantIds, charIds.r2l)])]

    // 摘要：涵蓋範圍較大的那份贏（不能看 updatedAt，推送會把接收端設成現在）
    if (pickSummary(local, { summary: full.summary, summaryCoversTs: full.summaryCoversTs }) === 'incoming') {
      local.summary = full.summary ?? ''
      local.summaryCoversTs = full.summaryCoversTs
    }
    changed = true
  }

  // ③ 單值欄位的二選一（標題／摘要），跟訊息的聯集是兩套規則
  if (await applyFieldPicks(src, row, local, fieldPicks, fetchImpl)) changed = true

  if (changed) {
    local.updatedAt = Date.now()
    await session.saveConversation(local)
    // 這一趟確認了對應關係，記下來讓下一次切換直接靠 id 配對
    await session.linkConversationToRemote(local.id, remote.id, remote.updatedAt)
    if (action === 'merge') result.merged.push(row.title)
  }
  return changed
}

/**
 * 依累計位元組把訊息切塊送出去，回傳電腦端**實際落地的對話 id**。
 *
 * ⚠️ **回傳的 id 一定要用**。新建時電腦會自己發 uuid（`createNewConversation`），
 * 拿手機自己的 id 當對應記回去的話，下一趟配不起來、每次切換都多推一份 ——
 * 這正是 S2 M3 重複增生的死因（`docs/mobile-sync-m4-compare.md` §1.1）。
 * 所以第一塊送完就要接住 id，後面幾塊都帶著它走。
 */
async function pushMessages(
  src: SyncSource,
  local: Conversation,
  targetId: string | undefined,
  messages: Message[],
  l2r: IdMap,
  result: ConvApplyResult,
  fetchImpl: FetchImpl
): Promise<string> {
  const translated = messages.map((m) => translateMessage(m, l2r))
  const chunks = chunkByBytes(translated)
  let current = targetId

  for (let i = 0; i < chunks.length; i++) {
    const out = await postJson<{ id?: string; written?: number; skipped?: number }>(
      src,
      '/api/sync-conversation-merge',
      {
        ...(current ? { targetId: current } : {}),
        title: local.title,
        participantIds: translateIds(local.participantIds, l2r),
        messages: chunks[i],
        // 摘要只跟著第一塊走；後面幾塊重送只是白費頻寬
        ...(i === 0 ? { summary: local.summary, summaryCoversTs: local.summaryCoversTs } : {}),
        chunkIndex: i,
        chunkTotal: chunks.length
      },
      fetchImpl
    )
    if (!out.id) throw new Error('電腦沒有回傳對話 id')
    // 第一塊建好之後，後續塊一律帶著電腦那顆 id，否則每一塊都會建一則新對話
    current = out.id
    result.messagesToRemote += out.written ?? 0
    result.keptOwnVersion += out.skipped ?? 0
  }

  if (!current) throw new Error('沒有送出任何內容')
  return current
}

/**
 * 單值欄位的二選一。
 *
 * 標題兩邊不同時**沒有客觀正確答案**（都是使用者自己取的），所以預設不動、
 * 由使用者逐則指定。摘要同理，只在涵蓋範圍一樣時才會問。
 */
async function applyFieldPicks(
  src: SyncSource,
  row: ConvRow,
  local: Conversation,
  picks: ConvFieldChoiceMap[string] | undefined,
  fetchImpl: FetchImpl
): Promise<boolean> {
  if (!picks) return false
  let changed = false

  const titleConflict = row.conflicts.find((c) => c.field === 'title')
  if (titleConflict && picks.title === 'remote') {
    local.title = titleConflict.remoteValue
    changed = true
  } else if (titleConflict && picks.title === 'local' && row.remoteId) {
    await postJson<unknown>(src, '/api/conversations/rename', { id: row.remoteId, title: local.title }, fetchImpl)
    changed = true
  }

  /*
   * 摘要選「電腦」時要把電腦那份抓回來——清單端點只給雜湊與涵蓋範圍，
   * 本文從來不進清單（可能很長）。選「手機」則不必做事：推送那一步
   * 已經把手機的摘要一起送過去了。
   */
  if (row.conflicts.some((c) => c.field === 'summary') && picks.summary === 'remote' && row.remoteId) {
    const { conversation } = await getJson<{ conversation?: RemoteConvIds }>(
      src,
      `/api/sync-conversation?id=${encodeURIComponent(row.remoteId)}&idsOnly=1`,
      fetchImpl
    )
    if (conversation) {
      local.summary = conversation.summary ?? ''
      local.summaryCoversTs = conversation.summaryCoversTs
      changed = true
    }
  }

  return changed
}

/**
 * 依累計位元組切塊。至少會回一塊（空的也要送，那是「建立這則對話」的請求）。
 *
 * 單則自己就超過上限時仍然自成一塊送出去——切不下去了，讓它去撞電腦端的
 * 上限並回報失敗，比在這裡默默丟掉一則訊息好。
 */
function chunkByBytes(messages: Message[]): Message[][] {
  if (messages.length === 0) return [[]]
  const chunks: Message[][] = []
  let current: Message[] = []
  let size = 0
  for (const m of messages) {
    const bytes = estimateBytes(m)
    if (current.length > 0 && (size + bytes > CHUNK_MAX_BYTES || current.length >= CHUNK_MAX_MESSAGES)) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(m)
    size += bytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function estimateBytes(m: Message): number {
  // JSON 字串長度就夠準了——這是安全邊際的估算，不是精確計量
  return JSON.stringify(m).length
}

/**
 * 翻譯訊息的角色 id。
 *
 * ⚠️ **翻不出來時要原樣保留，不能丟掉這則訊息。** 這裡跟情境推送
 * （`syncApply.ts` 的 `desktopCharacters`）**方向剛好相反**：情境對不到角色時
 * 整項不推，因為推一個死參照過去比少一個角色糟；但訊息是內容本身，
 * 丟掉就是聊天記錄真的少了一段。角色查不到人時還有 `characterName` 當備援
 * （見 `core/types.ts` 那段註解記的 2026-08-13 事故：七隻角色 id 被同步重建之後，
 * 五月到八月的對話瞬間全部查不到人）。
 */
function translateMessage(m: Message, map: IdMap): Message {
  if (!m.characterId) return m
  const mapped = map.get(m.characterId)
  return mapped ? { ...m, characterId: mapped } : m
}

/**
 * 翻譯一串角色 id。**對不到的丟掉**——跟訊息剛好相反。
 *
 * 參與清單裡留一顆對面不存在的 id 沒有任何用處（沒有 `characterName` 那種
 * 備援可以接回去），只會在對面變成一處死參照，而 M4 就是為了清這種東西
 * 跑過一次一次性腳本。
 */
function translateIds(ids: string[] | undefined, map: IdMap): string[] {
  return (ids ?? []).map((id) => map.get(id)).filter((id): id is string => !!id)
}
