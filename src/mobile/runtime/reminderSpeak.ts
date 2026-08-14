import { chatWithLLM } from '@core/llm'
import type { PlatformAdapters } from '@core/adapters'
import { stripOtherCharacterSpeakerLines } from '@core/group/dialogueCleanup'
import { normalizeCharacterDialogue } from '@core/prompt/dialogue'
import { hasUsableApiKey, messageLlmMeta } from '@core/prompt/promptUtils'
import {
  offlineFallbackAllowed as allowOfflineFallback,
  plainReminderNotice
} from '@core/reminder/gate'
import { getWeatherContextString } from '@core/weather'
import { getNewsInjectionForSpeak } from '@core/news/injection'
import type { Lorebook } from '@core/lore'
import type {
  Character,
  Conversation,
  Message,
  PersonaPreset,
  Reminder,
  ScenePreset,
  WorldPreset
} from '@core/types'
import type { LocalEventSource } from '../events/localEventSource'
import { buildLoreBlockFor, newsInjectionDepsFor, newsLinkFromInjection } from './chat'
import { newId } from './id'
import { contextMessages } from './messages'

/**
 * 提醒觸發時的「角色發話」（獨立模式）。
 *
 * ⚠️ **提醒不是行事曆通知**。桌面版
 * （`ipcHandlers.ts` 的 `triggerReminderSpeak`）從來就是把提醒內容當成
 * **給角色的指令**餵進 LLM，讓角色用自己的口吻講出來；使用者要的是
 * 「角色提醒我」而不是「一則寫著我自己打的字的通知」。
 * 這支就是那條路徑的獨立版，措辭刻意與桌面逐字對齊 ——
 * 同一則提醒在兩台裝置聽起來不一樣的話，就等於兩套人格。
 *
 * 獨立版沒有的注入（便利貼／日曆／新聞）直接略過，不是 bug；
 * 天氣兩邊共用 `core/weather`，所以有接。
 *
 * 回傳實際講出來的那句話給排程器當通知內容；
 * 沒有可發話的角色時回 `null`（呼叫端就不要發通知）。
 */
export interface ReminderSpeakResult {
  characterId: string
  characterName: string
  text: string
  /**
   * 這句話怎麼來的：現場生成成功／退回快取台詞／
   * 連快取都沒有時的樸素提醒（`offline_plain`）。
   */
  status: 'success' | 'offline_fallback' | 'offline_plain'
  /**
   * 樸素提醒時的通知標題（`offline_plain` 才有）。
   * 那不是角色在講話，通知標題不該掛角色名字。
   */
  plainTitle?: string
  /**
   * 降級的原因（`status === 'offline_fallback'` 時才有）。
   *
   * 會一路寫進提醒紀錄給使用者看。沒有這個的話，「現場生成一直失敗」
   * 與「本來就沒網路」在畫面上長得一模一樣，只能去翻 logcat——
   * owner 2026-08-11 就是卡在這裡查不出為什麼每次都是舊句子。
   */
  fallbackReason?: string
}

export async function speakStandaloneReminder(opts: {
  adapters: PlatformAdapters
  events: LocalEventSource
  settings: import('@core/types').AppSettings
  characters: Character[]
  getActiveConversation: () => Conversation | null
  saveConversation: (conv: Conversation) => Promise<void>
  getPersona: () => PersonaPreset | null
  getWorld: () => WorldPreset | null
  getActiveScene: () => ScenePreset | null
  loadLorebook: (id: string) => Promise<Lorebook | null>
  reminder: Reminder
  /**
   * 現場生成失敗時可用的快取台詞（見 §2.1 底線機制）。
   * 沒有可用快取時傳 undefined。
   *
   * ⚠️ **要連當初是誰講的一起帶**。只帶文字的話，降級時會把這句話掛到
   * 「這次重新隨機挑到的角色」身上——owner 2026-08-11 實機回報的
   * 「通知是 A 角色、點進 App 卻變成 B 角色說的」就是這個。
   */
  cached?: { text: string; characterId: string; characterName: string }
  /**
   * `'live'`（預設）＝真的要發話：訊息會進對話、會推 thinking 事件。
   * `'cache-refresh'` ＝只為了刷新快取而先生一句起來放，
   * **不進對話、不推事件**——否則使用者每次切走 App 都會憑空多一則訊息。
   */
  mode?: 'live' | 'cache-refresh'
  /**
   * 生成失敗時回報原因（即使最後回 `null`）。
   *
   * 回 `null` 的路徑本來什麼都沒留下，於是提醒紀錄只寫得出「跳過」，
   * 使用者與我們都看不出是沒網路、沒金鑰、還是 SDK 炸了
   * （owner 2026-08-11 第二輪實機：10:17 那筆就是一片空白）。
   */
  onFailure?: (reason: string) => void
}): Promise<ReminderSpeakResult | null> {
  const { reminder, settings } = opts
  const isLive = (opts.mode ?? 'live') === 'live'
  const charById = (id: string): Character | undefined => opts.characters.find((c) => c.id === id)

  /**
   * 現場生成失敗時的共同出口。
   *
   * ⚠️ **不要退回 `reminder.prompt` 原文**——那是「給角色的指令」
   * （例：「提醒我喝水」），不是要給使用者看的文案；直接照搬的話這功能
   * 就退化成普通行事曆。2026-08-11 起改成退回快取台詞，沒有快取就不發。
   */
  const useFallback = async (
    conv: Conversation | null,
    reason: string
  ): Promise<ReminderSpeakResult | null> => {
    opts.onFailure?.(reason)

    /*
     * 刷快取時**絕不降級**。
     *
     * 快取只該放「成功生成的角色台詞」——把降級結果存進去等於毒化它：
     * 之後真的要用底線時，拿到的是上一次的樸素通知（而且 characterId 是空的），
     * 狀態也會被誤記成 offline_fallback。
     * owner 2026-08-11 實機踩到：離線時按 HOME，刷快取失敗後把
     * 「（離線中，角色暫時說不了話）」存成快取，觸發時就用了它。
     */
    if (!isLive) return null

    if (!allowOfflineFallback(reminder)) return null

    const cached = opts.cached
    const text = cached?.text?.trim()
    if (!cached || !text) {
      /*
       * 沒有快取台詞可用。**不能就這樣沉默**——
       * 「連不上網時仍要提醒」這個開關是開著的，使用者勾了它就是要被提醒到；
       * 完全不響連「有件事該做」都丟了，比一則樸素通知更糟
       * （owner 2026-08-11：離線時提醒整個被吞掉）。
       *
       * 樸素通知刻意不裝成角色在講話，也不寫進對話——
       * 那是提醒事項，不是誰說的話。
       */
      const plain = plainReminderNotice(reminder)
      return {
        characterId: '',
        characterName: plain.title,
        plainTitle: plain.title,
        text: plain.body,
        status: 'offline_plain',
        fallbackReason: reason
      }
    }

    /*
     * 掛回**當初生成這句話的那個角色**，不是這次挑到的。
     * 角色被刪掉的話就沿用快取裡的名字（通知顯示得對），
     * 訊息則不進對話——沒有 id 可掛的訊息會變成一則幽靈發言。
     */
    const speaker = charById(cached.characterId)
    if (isLive && conv && speaker) {
      const msg = await appendReminderMessage(opts, conv, {
        characterId: speaker.id,
        content: text
      })
      return {
        characterId: speaker.id,
        characterName: speaker.name,
        text: msg.content,
        status: 'offline_fallback',
        fallbackReason: reason
      }
    }
    return {
      characterId: cached.characterId,
      characterName: speaker?.name ?? cached.characterName,
      text,
      status: 'offline_fallback',
      fallbackReason: reason
    }
  }

  // ── 挑發話角色 ─────────────────────────────────────────
  // 指定的角色還在 → 用它；被刪掉或沒指定 → 從未禁言的在場角色隨機挑。
  // （桌面另有「替補訊息」提示被刪角色的名字，但角色都刪了也拿不到名字，
  //   那段在桌面實際上也不會成立，這裡不照抄。）
  let charId = reminder.characterId
  if (charId && !charById(charId)) charId = undefined
  if (!charId) {
    const candidates = settings.ui.desktopCharacters
      .filter((d) => !d.muted)
      .map((d) => d.characterId)
      .filter((id) => charById(id))
    if (candidates.length === 0) {
      opts.onFailure?.('這次對話沒有可以發話的角色（都不在場或被禁言）')
      return null
    }
    charId = candidates[Math.floor(Math.random() * candidates.length)]
  }

  const char = charById(charId)
  const conv = opts.getActiveConversation()
  if (!char || !conv) {
    opts.onFailure?.(char ? '找不到要發話的對話' : '找不到要發話的角色')
    return null
  }

  // ── 組 context（順序與桌面一致）─────────────────────────
  const ctxParts: string[] = []

  if (conv.messages.length === 0 && char.firstMessage?.trim()) {
    ctxParts.push(`[角色開場白]\n${char.firstMessage.trim()}\n\n請基於這個開場白的人格和語氣，自由發揮回應。`)
  }
  if (reminder.prompt?.trim()) {
    ctxParts.push(`[提醒指令]\n${reminder.prompt.trim()}`)
  }

  if (reminder.injectWeather) {
    const weatherStr = await getWeatherContextString(settings, { http: opts.adapters.http })
    if (weatherStr) ctxParts.push(weatherStr)
  }

  // 新聞陪聊（缺口 #6，B1 抽 core 步驟⑦）：與桌面 `ipcHandlers.ts` 的提醒路線同一套
  // `getNewsInjectionForSpeak`，只是不做桌面才有的便利貼併選（survey）與回饋 debug。
  let newsInjection: Awaited<ReturnType<typeof getNewsInjectionForSpeak>> = null
  if (reminder.injectNews) {
    try {
      const activeScene = opts.getActiveScene()
      newsInjection = await getNewsInjectionForSpeak(newsInjectionDepsFor(opts.adapters), {
        force: true,
        ctx: { sceneGroupId: activeScene?.newsKeywordGroupId, characterKeywords: char.newsKeywords },
        appSettings: settings
      })
      if (newsInjection) ctxParts.push(newsInjection.text)
    } catch (e) {
      console.warn('[Reminder] news inject failed:', e)
    }
  }

  const reminderMessages = reminder.injectConversationContext
    ? contextMessages(conv.messages, settings.memory.keepRecentN)
    : []
  if (reminder.injectConversationContext && reminderMessages.length > 0) {
    ctxParts.push('[近期對話紀錄]\n以下僅供參考語境；不要長篇接續聊天。')
  }

  // 發話重點：有提醒內容＝優先；沒有內容但抽到新聞＝直接用新聞指令（和「說點什麼」一致）。
  if (reminder.prompt?.trim()) {
    ctxParts.push(
      '[發話重點]\n這次主要是要把上面的「提醒指令」用你自己的個性講出來；天氣／新聞如果有，只是順帶提及、別喧賓奪主。換個新鮮的開場，別跟你最近說過的雷同。'
    )
  } else if (newsInjection) {
    ctxParts.push(`[發話重點]\n${newsInjection.directive}`)
  }

  const presentNames = settings.ui.desktopCharacters
    .map((d) => charById(d.characterId)?.name ?? '')
    .filter(Boolean)
  if (presentNames.length > 0) {
    ctxParts.push(
      ['[Desktop Characters]', `- ${char.name} (you)`, ...presentNames.filter((n) => n !== char.name).map((n) => `- ${n}`)].join('\n')
    )
  }

  const extraSystemContext = ctxParts.join('\n\n') || undefined
  const hasApiKey = hasUsableApiKey(settings)

  // ── 沒有 API Key：生不出東西，走底線 ──
  if (!hasApiKey) return useFallback(conv, '沒有可用的 API Key')

  if (isLive) opts.events.push({ kind: 'thinking', characterId: char.id })
  try {
    const world = opts.getWorld()
    const { content, emotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM(
      {
        settings,
        character: char,
        messages: reminderMessages,
        speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
        persona: opts.getPersona(),
        world,
        desktopCharacterNames: [],
        extraSystemContext,
        memorySummary: reminder.injectConversationContext ? conv.summary : undefined,
        loreBlock: await buildLoreBlockFor(
          char,
          world,
          opts.getActiveScene(),
          {
            summary: reminder.injectConversationContext ? conv.summary : undefined,
            recentContents: reminderMessages.map((m) => m.content ?? '')
          },
          opts.loadLorebook,
          new Map()
        ),
        isReminder: true,
        omitEmotionTag: true
      },
      { http: opts.adapters.http }
    )

    const reply = stripOtherCharacterSpeakerLines(
      normalizeCharacterDialogue(content, char),
      char.id,
      opts.characters
    )
    if (!reply) {
      if (isLive) opts.events.push({ kind: 'thinking-done', characterId: char.id })
      opts.onFailure?.('模型回了空訊息')
      return null
    }

    // 只是刷快取：拿到句子就好，不進對話也不推事件
    if (!isLive) {
      return { characterId: char.id, characterName: char.name, text: reply, status: 'success' }
    }

    const llm = messageLlmMeta(debugPrompt, settings)
    const msg = await appendReminderMessage(opts, conv, {
      characterId: char.id,
      content: reply,
      llmProvider: llm.provider,
      llmModel: llm.model,
      debugPrompt,
      emotion,
      inputTokens,
      outputTokens,
      hasDebugPrompt: !!debugPrompt,
      newsLink: newsLinkFromInjection(newsInjection)
    })
    opts.events.push({ kind: 'thinking-done', characterId: char.id })
    return { characterId: char.id, characterName: char.name, text: msg.content, status: 'success' }
  } catch (e) {
    if (isLive) opts.events.push({ kind: 'thinking-done', characterId: char.id })
    console.error('[Reminder] 角色發話失敗:', e)
    /*
     * 走底線：有快取就用快取（帶離線標記），沒有就安靜略過。
     * `allowOfflineFallback === false` 的提醒連快取都不用——
     * 使用者明確選了「寧可不響也不要出戲」。
     */
    return useFallback(conv, e instanceof Error ? e.message : String(e))
  }
}

async function appendReminderMessage(
  opts: {
    events: LocalEventSource
    saveConversation: (conv: Conversation) => Promise<void>
  },
  conv: Conversation,
  fields: Omit<Message, 'id' | 'role' | 'timestamp'> & { characterId: string }
): Promise<Message> {
  const msg: Message = {
    id: newId(),
    role: 'character',
    timestamp: Date.now(),
    ...fields
  }
  conv.messages.push(msg)
  conv.updatedAt = Date.now()
  await opts.saveConversation(conv)
  opts.events.push({ kind: 'message', message: msg })
  return msg
}
