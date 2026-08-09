import { chatWithLLM } from '@core/llm'
import { countUncoveredMessages, summarizeConversation } from '@core/llm/summarizer'
import type { PlatformAdapters } from '@core/adapters'
import {
  isAddressed,
  pickPrimaryResponderId,
  shuffleIds,
  sortRespondersByKeywordMatch
} from '@core/group/responders'
import { stripOtherCharacterSpeakerLines } from '@core/group/dialogueCleanup'
import { normalizeCharacterDialogue } from '@core/prompt/dialogue'
import { formatRandomResultForPrompt } from '@core/prompt/randomResult'
import { messageLlmMeta, resolveModel } from '@core/prompt/promptUtils'
import { getWeatherContextString } from '@core/weather'
import {
  buildScanText,
  formatLoreBlock,
  orderLorebooks,
  resolveLorebookIds,
  resolveScanDepth,
  selectLoreEntries,
  type Lorebook
} from '@core/lore'
import type { AppSettings, Character, Conversation, Message, PersonaPreset, ScenePreset } from '@core/types'
import type { SendMessageInput } from '@core/data'
import type { LocalEventSource } from '../events/localEventSource'
import { newId } from './id'
import { contextMessages } from './messages'

/** 摘要進行中的對話 id（防止同一本對話重複觸發，比照桌面 `summarizingConvIds`） */
const summarizingConvIds = new Set<string>()

/**
 * 自動記憶摘要（fire-and-forget）：對齊桌面 `ipcHandlers.ts` 的 `maybeAutoSummarize`。
 * 獨立版聊天送完訊息之後從沒呼叫過這個 —— `conv.summary` 永遠停在初始值，
 * 舊訊息被 `keepRecentN` 視窗切掉後就此從 prompt 消失，看起來像角色失憶。
 */
function maybeAutoSummarize(opts: {
  adapters: PlatformAdapters
  events: LocalEventSource
  settings: AppSettings
  conv: Conversation
  persona: PersonaPreset | null
  speakerNameById: Record<string, string>
  saveConversation: (conv: Conversation) => Promise<void>
}): void {
  const { settings, conv } = opts
  if (!settings.memory.autoSummarizeEnabled) return
  if (!settings.llm.apiKeys[settings.llm.provider]?.trim()) return
  if (summarizingConvIds.has(conv.id)) return
  const threshold = Math.max(1, Number(settings.memory.autoSummarizeAfter) || 50)
  if (countUncoveredMessages(conv) < threshold) return

  summarizingConvIds.add(conv.id)
  void summarizeConversation(
    { settings, conv, persona: opts.persona, speakerNameById: opts.speakerNameById },
    { http: opts.adapters.http }
  )
    .then(async (result) => {
      if (!result) return
      conv.summary = result.summary
      conv.summaryCoversTs = result.coversTs
      conv.updatedAt = Date.now()
      await opts.saveConversation(conv)
      opts.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    })
    .catch((e) => console.warn('[standalone] auto summarize failed', e))
    .finally(() => summarizingConvIds.delete(conv.id))
}

/**
 * 組出這一輪的 `[Glossary]` 注入區塊；沒有命中任何條目時回傳 `undefined`
 * （連空標籤都不出現，規格 §6.1）。比照桌面 `buildLoreBlockFor()`，只是
 * 獨立版沒有情境模組總開關（資料為空本來就不影響 prompt，視為預設開啟）。
 *
 * `cache` 由呼叫端傳入、整輪訊息共用——群組回覆時每個角色都會呼叫一次，
 * 同一本書不必重複讀檔。
 */
export async function buildLoreBlockFor(
  char: Character | null | undefined,
  world: import('@core/types').WorldPreset | null | undefined,
  scene: ScenePreset | null | undefined,
  scan: { summary?: string; recentContents?: string[]; currentInput?: string },
  loadLorebook: (id: string) => Promise<Lorebook | null>,
  cache: Map<string, Lorebook | null>
): Promise<string | undefined> {
  const ids = resolveLorebookIds({
    characterIds: char?.lorebookIds,
    worldIds: world?.lorebookIds,
    sceneIds: scene?.lorebookIds
  })
  if (ids.length === 0) return undefined

  const loaded = new Map<string, Lorebook>()
  for (const id of ids) {
    if (!cache.has(id)) cache.set(id, await loadLorebook(id).catch(() => null))
    const book = cache.get(id)
    if (book) loaded.set(id, book)
  }
  const books = orderLorebooks(ids, loaded)
  if (books.length === 0) return undefined

  const scanText = buildScanText(scan, resolveScanDepth(books))
  const block = formatLoreBlock(selectLoreEntries(books, scanText))
  return block || undefined
}

/**
 * 獨立模式「說點什麼」（強制發話）：對齊桌面 `forceSpeakDirect` 的主幹，
 * 砍掉新聞／Spotify／日曆等獨立版還沒接的素材，天氣兩邊共用 `core/weather` 所以有留。
 *
 * 不是在回一則使用者訊息，所以不新增 user Message；直接把既有對話當 context
 * 餵給 LLM，用 `[發話重點]` 指令引導它主動開口而不是等著回覆。
 */
export async function forceSpeakStandalone(opts: {
  adapters: PlatformAdapters
  events: LocalEventSource
  settings: import('@core/types').AppSettings
  characters: Character[]
  getActiveConversation: () => Conversation | null
  saveConversation: (conv: Conversation) => Promise<void>
  getPersona: () => import('@core/types').PersonaPreset | null
  getWorld: () => import('@core/types').WorldPreset | null
  getActiveScene: () => ScenePreset | null
  loadLorebook: (id: string) => Promise<Lorebook | null>
  characterId: string
  /** 停止生成時 abort；沒有使用者訊息可撤回，中止就單純不落話 */
  signal?: AbortSignal
}): Promise<void> {
  const conv = opts.getActiveConversation()
  const char = opts.characters.find((c) => c.id === opts.characterId)
  if (!conv || !char) throw new Error('Not found')

  const hasApiKey = !!opts.settings.llm.apiKeys[opts.settings.llm.provider]?.trim()
  if (!hasApiKey) {
    const noKeyText = '（系統提示：尚未設定 API Key，我沒辦法回應你喔。請到設定填入 API Key，就可以開始聊天囉！）'
    const msg: Message = {
      id: newId(),
      role: 'character',
      characterId: char.id,
      content: noKeyText,
      timestamp: Date.now()
    }
    conv.messages.push(msg)
    conv.updatedAt = Date.now()
    await opts.saveConversation(conv)
    opts.events.push({ kind: 'message', message: msg })
    return
  }

  const world = opts.getWorld()
  const activeScene = opts.getActiveScene()
  const recentMessages = contextMessages(conv.messages, opts.settings.memory.keepRecentN)
  const desktopCharacterNames = opts.settings.ui.desktopCharacters
    .map((d) => opts.characters.find((c) => c.id === d.characterId)?.name ?? '')
    .filter(Boolean)

  const ctxParts: string[] = []
  if (conv.messages.length === 0 && char.firstMessage?.trim()) {
    ctxParts.push(`[角色開場白]\n${char.firstMessage.trim()}\n\n請基於這個開場白的人格和語氣，自由發揮回應。`)
  }
  opts.events.push({ kind: 'thinking', characterId: char.id })

  const weatherContext = await getWeatherContextString(opts.settings, { http: opts.adapters.http })
  if (opts.signal?.aborted) {
    opts.events.push({ kind: 'thinking-done', characterId: char.id })
    return
  }
  if (weatherContext) ctxParts.push(weatherContext)
  ctxParts.push(
    '[發話重點]\n這是你主動找使用者聊聊，不是在回覆訊息；換個新鮮的開場，別跟你最近說過的雷同。'
  )
  if (desktopCharacterNames.length > 0) {
    ctxParts.push(
      ['[Desktop Characters]', `- ${char.name} (you)`, ...desktopCharacterNames.filter((n) => n !== char.name).map((n) => `- ${n}`)].join('\n')
    )
  }
  const extraSystemContext = ctxParts.join('\n\n') || undefined

  try {
    const { content, emotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM(
      {
        settings: opts.settings,
        character: char,
        messages: recentMessages,
        speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
        persona: opts.getPersona(),
        world,
        desktopCharacterNames,
        extraSystemContext,
        memorySummary: conv.summary,
        loreBlock: await buildLoreBlockFor(
          char,
          world,
          activeScene,
          { summary: conv.summary, recentContents: recentMessages.map((m) => m.content ?? '') },
          opts.loadLorebook,
          new Map()
        ),
        omitEmotionTag: true,
        signal: opts.signal
      },
      { http: opts.adapters.http }
    )

    const reply = stripOtherCharacterSpeakerLines(normalizeCharacterDialogue(content, char), char.id, opts.characters)
    if (!reply) {
      opts.events.push({ kind: 'thinking-done', characterId: char.id })
      return
    }

    const llm = messageLlmMeta(debugPrompt, opts.settings)
    const msg: Message = {
      id: newId(),
      role: 'character',
      characterId: char.id,
      content: reply,
      llmProvider: llm.provider,
      llmModel: llm.model,
      debugPrompt,
      emotion,
      inputTokens,
      outputTokens,
      hasDebugPrompt: !!debugPrompt,
      timestamp: Date.now()
    }
    conv.messages.push(msg)
    conv.updatedAt = Date.now()
    await opts.saveConversation(conv)
    opts.events.push({ kind: 'thinking-done', characterId: char.id })
    opts.events.push({ kind: 'message', message: msg })
    maybeAutoSummarize({
      adapters: opts.adapters,
      events: opts.events,
      settings: opts.settings,
      conv,
      persona: opts.getPersona(),
      speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
      saveConversation: opts.saveConversation
    })
  } catch (e) {
    opts.events.push({ kind: 'thinking-done', characterId: char.id })
    // 中止是使用者主動按停止；不落話、不當錯誤處理（沒有使用者訊息需要撤回）
    if (opts.signal?.aborted) return
    throw e
  }
}

/**
 * 獨立模式精簡聊天：對齊桌面 `sendMsgBody` 的主幹，
 * 砍掉桌寵泡泡、Spotify／日曆／新聞斜線、災害補搜等平台專屬枝節。
 */
export async function sendStandaloneMessage(opts: {
  adapters: PlatformAdapters
  events: LocalEventSource
  settings: import('@core/types').AppSettings
  characters: Character[]
  getActiveConversation: () => Conversation | null
  saveConversation: (conv: Conversation) => Promise<void>
  getPersona: () => import('@core/types').PersonaPreset | null
  getWorld: () => import('@core/types').WorldPreset | null
  getActiveScene: () => ScenePreset | null
  /** 讀失敗（檔案損壞／不存在）一律回 `null`，靜默略過該本（規格 §6.6） */
  loadLorebook: (id: string) => Promise<Lorebook | null>
  input: SendMessageInput
  /** 停止生成時 abort；中止後會撤回尚未得到回覆的使用者訊息 */
  signal?: AbortSignal
}): Promise<void> {
  const conv = opts.getActiveConversation()
  if (!conv) throw new Error('No active conversation')

  const charById = (id: string) => opts.characters.find((c) => c.id === id)

  let userContentForPrompt = opts.input.content
  if (opts.input.randomResults?.length) {
    for (const rr of opts.input.randomResults) {
      const label = formatRandomResultForPrompt(rr)
      userContentForPrompt = `${userContentForPrompt}${userContentForPrompt ? '\n' : ''}（${label}）`
    }
  }

  // 發話當下的身分名字要跟訊息一起存（`Message.personaName`）：之後改名或刪掉身分，
  // 舊記錄仍該顯示當時是誰說的。顯示名優先、其次暱稱，都空才退回設定組名稱 ——
  // 與輸入框上方 `PersonaIdentity` 的取名規則一致。
  const persona = opts.getPersona()
  const personaName =
    persona && (persona.displayName.trim() || persona.nickname.trim() || persona.name)

  const userMsg: Message = {
    id: newId(),
    role: 'user',
    personaName: personaName || undefined,
    content: opts.input.content,
    images: opts.input.images,
    randomResults: opts.input.randomResults,
    newsLink: opts.input.newsLink ?? undefined,
    timestamp: Date.now()
  }
  conv.messages.push(userMsg)
  conv.updatedAt = Date.now()
  await opts.saveConversation(conv)
  opts.events.push({ kind: 'message', message: userMsg })

  if (opts.input.skipLlm) return

  const desktopAll = opts.settings.ui.desktopCharacters.map((d) => d.characterId)
  const desktopResponders = opts.settings.ui.desktopCharacters
    .filter((d) => !d.muted)
    .map((d) => d.characterId)
  const desktopCharacterNames = desktopAll.map((id) => charById(id)?.name ?? '').filter(Boolean)

  const mentionedAll = desktopAll.filter((id) => {
    const c = charById(id)
    return c !== undefined && isAddressed(opts.input.content, c)
  })
  const mentionedIds = mentionedAll.filter((id) => desktopResponders.includes(id))

  const respondingIds =
    mentionedIds.length > 0
      ? [...shuffleIds(mentionedIds), ...shuffleIds(desktopResponders.filter((id) => !mentionedIds.includes(id)))]
      : sortRespondersByKeywordMatch(desktopResponders, opts.input.content, charById)

  if (respondingIds.length === 0) {
    if (desktopAll.length > 0) {
      const hinted =
        mentionedAll.length > 0
          ? `你點名的角色目前在禁言狀態（${mentionedAll.map((id) => charById(id)?.name ?? '角色').join('、')}）。`
          : '所有桌面角色目前都在禁言狀態。'
      conv.messages.push({
        id: newId(),
        role: 'system',
        content: `[提示] ${hinted} 請在角色旁邊點「🔊」解除禁言後再試。`,
        llmProvider: opts.settings.llm.provider,
        llmModel: resolveModel(opts.settings),
        timestamp: Date.now()
      })
      conv.updatedAt = Date.now()
      await opts.saveConversation(conv)
      opts.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    }
    return
  }

  const primaryId = pickPrimaryResponderId(respondingIds, mentionedIds)
  if (!primaryId) return
  const primaryChar = charById(primaryId)
  if (!primaryChar) return

  const hasApiKey = !!opts.settings.llm.apiKeys[opts.settings.llm.provider]?.trim()
  if (!hasApiKey) {
    const noKeyText =
      '（系統提示：尚未設定 API Key，我沒辦法回應你喔。請到設定填入 API Key，就可以開始聊天囉！）'
    const noKeyMsg: Message = {
      id: newId(),
      role: 'character',
      characterId: primaryId,
      content: noKeyText,
      timestamp: Date.now()
    }
    conv.messages.push(noKeyMsg)
    conv.updatedAt = Date.now()
    await opts.saveConversation(conv)
    opts.events.push({ kind: 'message', message: noKeyMsg })
    return
  }

  opts.events.push({ kind: 'thinking', characterId: primaryId })

  const undoUserMessage = async (): Promise<void> => {
    opts.events.push({ kind: 'thinking-done', characterId: primaryId })
    conv.messages = conv.messages.filter((m) => m.id !== userMsg.id)
    conv.updatedAt = Date.now()
    await opts.saveConversation(conv)
    opts.events.push({ kind: 'state-invalidated', reason: 'desktop' })
  }

  const userMsgForPrompt: Message = { ...userMsg, content: userContentForPrompt }
  const recentMessagesBase = contextMessages(
    [...conv.messages.slice(0, -1), userMsgForPrompt],
    opts.settings.memory.keepRecentN
  )

  const world = opts.getWorld()
  const activeScene = opts.getActiveScene()
  const loreCache = new Map<string, Lorebook | null>()

  /*
   * 天氣（`[Weather]`）。附 30 分鐘快取，所以不是每則訊息都真的打外部服務。
   *
   * 抓失敗一律回 `null` 而不是拋 —— 使用者是來聊天的，不該因為氣象服務
   * 掛掉就收不到回覆。桌面另有的新聞／日曆／Spotify 注入獨立版還沒接。
   */
  const weatherContext = await getWeatherContextString(opts.settings, { http: opts.adapters.http })
  if (opts.signal?.aborted) {
    await undoUserMessage()
    return
  }

  // `omitEmotionTag`：獨立版是單張主圖、不做表情差分，沒有東西會用到情緒標籤。
  // 角色卡若帶著表情圖，情緒合約會把每張圖的 id 與用途逐條寫進 system prompt
  // （id 取自圖檔檔名），每則對話都白付這筆 token。
  try {
    const { content, emotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM(
      {
        settings: opts.settings,
        character: primaryChar,
        messages: recentMessagesBase,
        images: opts.input.images,
        speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
        persona: opts.getPersona(),
        world,
        desktopCharacterNames,
        memorySummary: conv.summary,
        extraSystemContext: weatherContext ?? undefined,
        loreBlock: await buildLoreBlockFor(
          primaryChar,
          world,
          activeScene,
          { summary: conv.summary, recentContents: recentMessagesBase.map((m) => m.content ?? '') },
          opts.loadLorebook,
          loreCache
        ),
        omitEmotionTag: true,
        signal: opts.signal
      },
      { http: opts.adapters.http }
    )

    const primaryReply = stripOtherCharacterSpeakerLines(
      normalizeCharacterDialogue(content, primaryChar),
      primaryChar.id,
      opts.characters
    )
    if (!primaryReply) throw new Error('模型輸出包含其他角色台詞，已拒絕這次回覆。')

    const llm = messageLlmMeta(debugPrompt, opts.settings)
    const charMsg: Message = {
      id: newId(),
      role: 'character',
      characterId: primaryId,
      content: primaryReply,
      llmProvider: llm.provider,
      llmModel: llm.model,
      debugPrompt,
      emotion,
      inputTokens,
      outputTokens,
      hasDebugPrompt: !!debugPrompt,
      timestamp: Date.now()
    }
    conv.messages.push(charMsg)
    conv.updatedAt = Date.now()
    await opts.saveConversation(conv)
    opts.events.push({ kind: 'thinking-done', characterId: primaryId })
    opts.events.push({ kind: 'message', message: charMsg })

    // 群組：其餘在場角色最多再回 maxGroupRounds-1 輪（精簡版，無串流）
    const maxRounds = Math.max(1, opts.settings.llm.maxGroupRounds ?? 1)
    const others = respondingIds.filter((id) => id !== primaryId).slice(0, maxRounds - 1)
    for (const oid of others) {
      const och = charById(oid)
      if (!och) continue
      opts.events.push({ kind: 'thinking', characterId: oid })
      try {
        const recent = contextMessages(conv.messages, opts.settings.memory.keepRecentN)
        if (opts.signal?.aborted) {
          opts.events.push({ kind: 'thinking-done', characterId: oid })
          break
        }
        const sec = await chatWithLLM(
          {
            settings: opts.settings,
            character: och,
            messages: recent,
            speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
            persona: opts.getPersona(),
            world,
            desktopCharacterNames,
            memorySummary: conv.summary,
            extraSystemContext: weatherContext ?? undefined,
            loreBlock: await buildLoreBlockFor(
              och,
              world,
              activeScene,
              { summary: conv.summary, recentContents: recent.map((m) => m.content ?? '') },
              opts.loadLorebook,
              loreCache
            ),
            omitEmotionTag: true,
            signal: opts.signal
          },
          { http: opts.adapters.http }
        )
        const reply = stripOtherCharacterSpeakerLines(
          normalizeCharacterDialogue(sec.content, och),
          och.id,
          opts.characters
        )
        if (!reply) {
          opts.events.push({ kind: 'thinking-done', characterId: oid })
          continue
        }
        const meta = messageLlmMeta(sec.debugPrompt, opts.settings)
        const msg: Message = {
          id: newId(),
          role: 'character',
          characterId: oid,
          content: reply,
          llmProvider: meta.provider,
          llmModel: meta.model,
          debugPrompt: sec.debugPrompt,
          emotion: sec.emotion,
          inputTokens: sec.inputTokens,
          outputTokens: sec.outputTokens,
          hasDebugPrompt: !!sec.debugPrompt,
          timestamp: Date.now()
        }
        conv.messages.push(msg)
        conv.updatedAt = Date.now()
        await opts.saveConversation(conv)
        opts.events.push({ kind: 'thinking-done', characterId: oid })
        opts.events.push({ kind: 'message', message: msg })
      } catch (e) {
        opts.events.push({ kind: 'thinking-done', characterId: oid })
        if (opts.signal?.aborted) break
        console.warn('[standalone] secondary reply failed', oid, e)
      }
    }

    maybeAutoSummarize({
      adapters: opts.adapters,
      events: opts.events,
      settings: opts.settings,
      conv,
      persona: opts.getPersona(),
      speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
      saveConversation: opts.saveConversation
    })
  } catch (e) {
    if (opts.signal?.aborted) {
      await undoUserMessage()
      return
    }
    opts.events.push({ kind: 'thinking-done', characterId: primaryId })
    const errText = e instanceof Error ? e.message : String(e)
    const errMsg: Message = {
      id: newId(),
      role: 'system',
      content: `[錯誤] 回應失敗：${errText}`,
      timestamp: Date.now()
    }
    conv.messages.push(errMsg)
    conv.updatedAt = Date.now()
    await opts.saveConversation(conv)
    opts.events.push({ kind: 'message', message: errMsg })
    /*
     * **這裡刻意不 rethrow。**
     * 使用者那則訊息在呼叫 LLM 之前就已經寫檔並上畫面了 —— 獨立模式沒有
     * 「伺服器沒收到」這種狀態。若往上拋，`appStore.send` 會當成送出失敗，
     * `Composer` 跟著跳「訊息送出失敗」並把圖片倒回附件列，使用者照提示重送
     * 就會產生重複訊息＋重複圖片。回應失敗已經以系統泡泡呈現在對話裡了。
     *
     * 使用者訊息**寫檔之前**的錯誤仍會自然往上拋（不在這個 try 裡）。
     */
  }
}
