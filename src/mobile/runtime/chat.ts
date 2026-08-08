import { chatWithLLM } from '@core/llm'
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
import type { Character, Conversation, Message } from '@core/types'
import type { SendMessageInput } from '@core/data'
import type { LocalEventSource } from '../events/localEventSource'
import { newId } from './id'
import { contextMessages } from './messages'

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
        world: opts.getWorld(),
        desktopCharacterNames,
        memorySummary: conv.summary,
        extraSystemContext: weatherContext ?? undefined,
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
            world: opts.getWorld(),
            desktopCharacterNames,
            memorySummary: conv.summary,
            extraSystemContext: weatherContext ?? undefined,
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
