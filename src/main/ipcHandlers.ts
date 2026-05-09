import { ipcMain, shell, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, Message } from './types'
import * as fileStore from './fileStore'
import { chatWithOpenAI } from './llm/openaiAdapter'
import {
  createCharacterWindow, closeCharacterWindow, getCharacterWindow,
  toggleInputWindow, toggleLogWindow, openSettingsWindow,
  broadcastToAll, getAllCharacterWindows, setCharacterWindowClickThrough,
  restoreAuxWindowsFromRememberedState, bringCharacterToFront, raiseAuxAboveCharacters, raiseAuxWindowToFront,
  showSpeechBubble, hideSpeechBubble, updateSpeechBubbleSize, syncSpeechBubblePosition, setCharacterHitRects,
  beginCharacterDrag, endCharacterDrag, suppressAuxAutoHide
} from './windowManager'

// ── In-memory state ───────────────────────────────────────

let settings: AppSettings
let characters: Character[]
let activeConversationId: string | null = null
let conversations: Map<string, Conversation> = new Map()
let lastPrimaryResponderId: string | null = null

function formatSystemTimeLabel(d: Date): string {
  const hours = d.getHours()
  return hours < 5 ? '凌晨'
    : hours < 8 ? '清晨'
    : hours < 12 ? '上午'
    : hours < 13 ? '中午'
    : hours < 18 ? '下午'
    : hours < 19 ? '傍晚'
    : hours < 23 ? '晚上'
    : '深夜'
}

function formatSystemTimeStamp(d: Date): string {
  const timeLabel = formatSystemTimeLabel(d)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${timeLabel}`
}

function normalizeText(s: string): string {
  return s.toLowerCase()
}

function characterAliases(char: Character): string[] {
  const nn = Array.isArray(char.nicknames) ? char.nicknames : []
  return [char.name, ...nn].map(s => String(s ?? '').trim()).filter(Boolean)
}

function isAddressed(content: string, char: Character): boolean {
  const text = normalizeText(content)
  for (const a of characterAliases(char)) {
    const aa = normalizeText(a)
    if (!aa) continue
    if (text.includes(`@${aa}`) || text.includes(aa)) return true
  }
  return false
}

function pickPrimaryResponderId(respondingIds: string[], mentionedIds: string[]): string | null {
  if (respondingIds.length === 0) return null
  if (mentionedIds.length > 0) return mentionedIds[0]
  if (lastPrimaryResponderId && respondingIds.includes(lastPrimaryResponderId)) {
    const idx = respondingIds.indexOf(lastPrimaryResponderId)
    return respondingIds[(idx + 1) % respondingIds.length]
  }
  return respondingIds[0]
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    const match = String(s ?? '').match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }
}

function normalizeForCompare(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[，、。！？!?,.]+/g, '')
    .toLowerCase()
}

export function initState(
  s: AppSettings,
  chars: Character[],
  desktopState: { characterId: string; position: { x: number; y: number }; size: number; muted: boolean; zIndex: number }[]
) {
  settings = s
  characters = chars

  // Ensure desktop characters are set
  if (desktopState.length > 0 && s.ui.desktopCharacters.length === 0) {
    settings.ui.desktopCharacters = desktopState
    fileStore.saveSettings(settings)
  }

  // Load or create active conversation
  const ids = fileStore.listConversationIds()
  if (ids.length > 0) {
    activeConversationId = ids[ids.length - 1]
    const conv = fileStore.loadConversation(activeConversationId)
    if (conv) conversations.set(conv.id, conv)
  } else {
    createNewConversation()
  }
}

function getActiveConversation(): Conversation | null {
  if (!activeConversationId) return null
  return conversations.get(activeConversationId) ?? null
}

function createNewConversation(): Conversation {
  const id = uuidv4()
  const conv: Conversation = {
    id,
    title: '新對話',
    participantIds: settings.ui.desktopCharacters.map(d => d.characterId),
    messages: [],
    summary: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  conversations.set(id, conv)
  activeConversationId = id
  fileStore.saveConversation(conv)
  return conv
}

function getCharacter(id: string): Character | undefined {
  return characters.find(c => c.id === id)
}

function getSpeakerNameById(): Record<string, string> {
  return Object.fromEntries(characters.map(c => [c.id, c.name]))
}

function getOrLoadConversation(id: string): Conversation | null {
  const cached = conversations.get(id)
  if (cached) return cached
  const loaded = fileStore.loadConversation(id)
  if (!loaded) return null
  conversations.set(loaded.id, loaded)
  return loaded
}

function pickNextConversationId(excludingId?: string): string | null {
  const ids = fileStore.listConversationIds().filter(id => id !== excludingId)
  const candidates: Array<{ id: string; updatedAt: number; hasMessages: boolean }> = []
  for (const id of ids) {
    const conv = getOrLoadConversation(id)
    if (!conv) continue
    candidates.push({ id, updatedAt: conv.updatedAt ?? 0, hasMessages: (conv.messages?.length ?? 0) > 0 })
  }
  // Prefer conversations with messages, newest first
  candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  const withMessages = candidates.find(c => c.hasMessages)
  return withMessages?.id ?? (candidates[0]?.id ?? null)
}

// ── IPC handlers ──────────────────────────────────────────

export function registerIpcHandlers() {

  // Store: get initial snapshot for any renderer
  ipcMain.handle('store:get-all', () => ({
    settings,
    characters,
    desktopCharacters: settings.ui.desktopCharacters,
    activeConversationId,
    conversation: getActiveConversation()
  }))

  // Settings
  ipcMain.handle('settings:get', () => settings)

  ipcMain.handle('settings:save', (_, s: AppSettings) => {
    settings = s
    fileStore.saveSettings(s)
    broadcastToAll('settings:updated', settings)
    return true
  })

  // Characters
  ipcMain.handle('characters:list', () => characters)

  ipcMain.handle('character:save', (_, char: Character) => {
    char.updatedAt = Date.now()
    const idx = characters.findIndex(c => c.id === char.id)
    if (idx >= 0) characters[idx] = char
    else characters.push(char)
    fileStore.saveCharacter(char)
    broadcastToAll('characters:updated', characters)
    return true
  })

  ipcMain.handle('character:delete', (_, id: string) => {
    characters = characters.filter(c => c.id !== id)
    fileStore.deleteCharacter(id)
    // Remove from desktop if present
    settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== id)
    fileStore.saveSettings(settings)
    closeCharacterWindow(id)
    broadcastToAll('characters:updated', characters)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  // Desktop characters
  ipcMain.handle('desktop:add-character', (_, characterId: string) => {
    if (settings.ui.desktopCharacters.some(d => d.characterId === characterId)) return false
    const state = { characterId, position: { x: 100, y: 400 }, size: 1, muted: false, zIndex: Date.now() }
    settings.ui.desktopCharacters.push(state)
    fileStore.saveSettings(settings)
    createCharacterWindow(characterId, state.position, state.size)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('desktop:remove-character', (_, characterId: string) => {
    if (settings.ui.desktopCharacters.length <= 1) return false
    settings.ui.desktopCharacters = settings.ui.desktopCharacters.filter(d => d.characterId !== characterId)
    fileStore.saveSettings(settings)
    closeCharacterWindow(characterId)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return true
  })

  ipcMain.handle('desktop:update-position', (_, characterId: string, pos: { x: number; y: number }) => {
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (d) {
      d.position = pos
      fileStore.saveSettings(settings)
    }
    const win = getCharacterWindow(characterId)
    if (win && !win.isDestroyed()) {
      win.setPosition(Math.round(pos.x), Math.round(pos.y))
    }
    // Pass pos directly so syncSpeechBubblePosition doesn't read stale getBounds() after setPosition.
    syncSpeechBubblePosition(characterId, pos)
    return true
  })

  ipcMain.handle('desktop:drag-start', (_, characterId: string) => {
    const ok = beginCharacterDrag(characterId, pos => {
      const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
      if (d) d.position = pos
    })
    return ok
  })

  ipcMain.handle('desktop:drag-end', (_, characterId: string) => {
    const pos = endCharacterDrag(characterId)
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (d && pos) {
      d.position = pos
      fileStore.saveSettings(settings)
      broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    }
    return true
  })

  // Mouse hit-test IPC removed — click-through is handled via CSS pointer-events
  ipcMain.handle('desktop:set-click-through', (_, characterId: string, clickThrough: boolean) => {
    return setCharacterWindowClickThrough(characterId, clickThrough)
  })

  ipcMain.handle('desktop:update-hit-rects', (_, characterId: string, rects: {
    sprite: { x: number; y: number; w: number; h: number } | null
    buttons: { x: number; y: number; w: number; h: number } | null
  } | null) => {
    return setCharacterHitRects(characterId, rects)
  })

  ipcMain.handle('ui:character-activated', (_, characterId: string) => {
    bringCharacterToFront(characterId)
    return true
  })

  ipcMain.handle('ui:aux-activated', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) return raiseAuxWindowToFront(win)
    raiseAuxAboveCharacters()
    return false
  })

  ipcMain.handle('bubble:set-size', (_, characterId: string, size: { width: number; height: number }) => {
    return updateSpeechBubbleSize(characterId, size)
  })

  ipcMain.handle('bubble:close', (_, characterId: string) => {
    return hideSpeechBubble(characterId)
  })

  ipcMain.handle('bubble:debug-show', (_, payload: { characterId: string; speakerName: string; text: string }) => {
    const { characterId, speakerName, text } = payload ?? { characterId: '', speakerName: '', text: '' }
    if (!characterId) return false
    showSpeechBubble(characterId, speakerName || (getCharacter(characterId)?.name ?? '角色'), String(text ?? ''))
    return true
  })

  // Window controls
  ipcMain.handle('window:toggle-input', () => {
    toggleInputWindow()
    return true
  })

  ipcMain.handle('window:toggle-log', () => {
    toggleLogWindow()
    return true
  })

  ipcMain.handle('window:open-settings', (_, tab?: string) => {
    openSettingsWindow(tab)
    return true
  })

  ipcMain.handle('window:close-self', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed()) {
      suppressAuxAutoHide()
      win.setOpacity(1)
      win.hide()
    }
    return true
  })

  ipcMain.handle('window:open-data-folder', () => {
    shell.openPath(fileStore.getDataDir())
    return true
  })

  // Conversation
  ipcMain.handle('conversation:get', () => getActiveConversation())

  ipcMain.handle('conversation:list', () => {
    const ids = fileStore.listConversationIds()
    const list = ids.map(id => {
      const conv = getOrLoadConversation(id)
      return conv
        ? { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, createdAt: conv.createdAt }
        : { id, title: '對話', updatedAt: 0, createdAt: 0 }
    })
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    return list
  })

  ipcMain.handle('conversation:new', () => {
    const conv = createNewConversation()
    broadcastToAll('conversation:updated', conv)
    return conv
  })

  ipcMain.handle('conversation:load', (_, id: string) => {
    const conv = getOrLoadConversation(id)
    if (!conv) return { error: 'Not found' }
    activeConversationId = id
    broadcastToAll('conversation:updated', conv)
    return conv
  })

  ipcMain.handle('conversation:rename', (_, title: string) => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.title = String(title || '').trim() || '新對話'
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastToAll('conversation:updated', conv)
    return true
  })

  ipcMain.handle('conversation:clear', () => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.messages = []
    conv.summary = ''
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastToAll('conversation:updated', conv)
    return true
  })

  ipcMain.handle('conversation:delete-current', () => {
    const conv = getActiveConversation()
    if (!conv) return false
    const deletingId = conv.id
    // Remove file + cache
    fileStore.deleteConversation(deletingId)
    conversations.delete(deletingId)
    activeConversationId = null

    // Jump to next conversation with messages (or newest); otherwise create a new one.
    const nextId = pickNextConversationId(deletingId)
    if (nextId) {
      activeConversationId = nextId
      const next = getOrLoadConversation(nextId)
      if (next) {
        broadcastToAll('conversation:updated', next)
        return true
      }
    }

    const fresh = createNewConversation()
    broadcastToAll('conversation:updated', fresh)
    return true
  })

  ipcMain.handle('conversation:delete-message', (_, messageId: string) => {
    const conv = getActiveConversation()
    if (!conv) return false
    conv.messages = conv.messages.filter(m => m.id !== messageId)
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastToAll('conversation:updated', conv)
    return true
  })

  ipcMain.handle('conversation:edit-message', (_, payload: { messageId: string; content: string }) => {
    const conv = getActiveConversation()
    if (!conv) return false
    const msg = conv.messages.find(m => m.id === payload.messageId)
    if (!msg) return false
    msg.content = String(payload.content ?? '')
    conv.updatedAt = Date.now()
    fileStore.saveConversation(conv)
    broadcastToAll('conversation:updated', conv)
    return true
  })

  // Messaging
  ipcMain.handle('message:send', async (_, payload: { content: string; images?: string[] }) => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }

    const userContentForPrompt = settings.injectSystemTime
      ? `${payload.content}\n\n【目前時間】${formatSystemTimeStamp(new Date())}`
      : payload.content

    // Add user message
    const userMsg: Message = {
      id: uuidv4(),
      role: 'user',
      content: payload.content,
      images: payload.images,
      timestamp: Date.now()
    }
    conv.messages.push(userMsg)
    broadcastToAll('conversation:updated', conv)
    const userMsgForPrompt: Message = { ...userMsg, content: userContentForPrompt }

    const desktopAll = settings.ui.desktopCharacters.map(d => d.characterId)
    const desktopResponders = settings.ui.desktopCharacters.filter(d => !d.muted).map(d => d.characterId)

    // If user mentioned a name/nickname, that character should respond first (and definitely respond if not muted).
    const mentionedAll = desktopAll.filter(id => {
      const c = getCharacter(id)
      return c ? isAddressed(payload.content, c) : false
    })
    const mentionedIds = mentionedAll.filter(id => desktopResponders.includes(id))

    const respondingIds = mentionedIds.length > 0
      ? [...mentionedIds, ...desktopResponders.filter(id => !mentionedIds.includes(id))]
      : desktopResponders

    if (respondingIds.length === 0) {
      // If there are desktop characters but all are muted, surface a hint in conversation.
      if (desktopAll.length > 0) {
        const hinted = mentionedAll.length > 0
          ? `你點名的角色目前在禁言狀態（${mentionedAll.map(id => getCharacter(id)?.name ?? '角色').join('、')}）。`
          : '所有桌面角色目前都在禁言狀態。'
        const hintMsg: Message = {
          id: uuidv4(),
          role: 'system',
          content: `[提示] ${hinted} 請在角色旁邊點「🔊」解除禁言後再試。`,
          llmProvider: settings.llm.provider,
          llmModel: settings.llm.model,
          timestamp: Date.now()
        }
        conv.messages.push(hintMsg)
        broadcastToAll('conversation:updated', conv)
      }
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    const primaryId = pickPrimaryResponderId(respondingIds, mentionedIds)
    if (!primaryId) return { ok: true }
    lastPrimaryResponderId = primaryId

    const primaryChar = getCharacter(primaryId)
    if (!primaryChar) return { ok: true }

    const recentMessagesBase = [...conv.messages.slice(0, -1), userMsgForPrompt].slice(-(settings.memory.keepRecentN))
    let lastReplyText = ''

    // 1) Primary responder always replies
    try {
      broadcastToAll('character:thinking', { characterId: primaryId, thinking: true })
      const { content, emotion, debugPrompt } = await chatWithOpenAI({
        settings,
        character: primaryChar,
        messages: recentMessagesBase,
        images: payload.images,
        speakerNameById: getSpeakerNameById()
      })
      userMsg.debugPrompt = debugPrompt
      lastReplyText = content
      const charMsg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId: primaryId,
        content,
        llmProvider: settings.llm.provider,
        llmModel: settings.llm.model,
        debugPrompt,
        emotion,
        timestamp: Date.now()
      }
      conv.messages.push(charMsg)
      conv.updatedAt = Date.now()
      broadcastToAll('conversation:updated', conv)
      broadcastToAll('character:new-message', { characterId: primaryId, message: charMsg })
      showSpeechBubble(primaryId, primaryChar.name, content)
      broadcastToAll('character:thinking', { characterId: primaryId, thinking: false })
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e)
      const errMsg2: Message = {
        id: uuidv4(),
        role: 'system',
        content: `[錯誤] ${errMsg}`,
        llmProvider: settings.llm.provider,
        llmModel: settings.llm.model,
        timestamp: Date.now()
      }
      conv.messages.push(errMsg2)
      broadcastToAll('conversation:updated', conv)
      broadcastToAll('character:thinking', { characterId: primaryId, thinking: false })
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    // 2) Others: only reply if they have a distinct thought
    const others = respondingIds.filter(id => id !== primaryId)
    for (const charId of others) {
      const char = getCharacter(charId)
      if (!char) continue

      const guardChar = {
        ...char,
        systemPromptOverride: [
          `你是${char.name}，正在群組對話中。`,
          `規則：你「不一定要回覆」。只有在你真的有新觀點、補充、不同情緒反應、或被點名時才回覆。`,
          `如果只是重複上一位角色的內容、或沒有要補充，請回覆：[neutral] {"respond":false}`,
          `如果要回覆，請只輸出 JSON（仍需以情緒標記開頭），格式如下：`,
          `[neutral] {"respond":true,"emotion":"neutral","content":"你的回覆內容（簡短，不要重複上一位）"}`,
          `注意：不要輸出任何 JSON 以外的多餘文字。`
        ].join('\n'),
      }
      const secondaryGuardChar = {
        ...char,
        systemPromptOverride: [
          `你正在判斷「${char.name}」是否要接續目前對話發言。`,
          '如果使用者明確要求大家聊天、某位角色點名你、或你能提供不同角度，請回應。',
          '如果你只是要重複上一位角色的意思、沒有新反應、或角色個性上會保持沉默，才選擇不回應。',
          '請只輸出一個 JSON 物件，不要加解釋，不要使用 Markdown。',
          '格式：{"respond":true,"emotion":"neutral","content":"要說的話"}',
          '不回應格式：{"respond":false}'
        ].join('\n'),
      }

      try {
        broadcastToAll('character:thinking', { characterId: charId, thinking: true })
        const recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
        const { content: jsonText, debugPrompt } = await chatWithOpenAI({
          settings,
          character: secondaryGuardChar,
          messages: recentMessages,
          speakerNameById: getSpeakerNameById()
        })
        const parsed = safeJsonParse<{ respond?: boolean; emotion?: string; content?: string }>(jsonText)
        const fallbackReply = !parsed && jsonText && !/^\s*(false|no|不|不用|沉默)/i.test(jsonText)
          ? String(jsonText).trim()
          : ''
        const respond = parsed ? !!parsed.respond : !!fallbackReply
        const reply = String(parsed?.content ?? fallbackReply).trim()
        const replyNorm = normalizeForCompare(reply)
        const lastNorm = normalizeForCompare(lastReplyText)

        if (!respond || !reply) {
          broadcastToAll('character:thinking', { characterId: charId, thinking: false })
          continue
        }
        // Skip near-duplicates
        if (replyNorm && lastNorm && (replyNorm === lastNorm || replyNorm.includes(lastNorm) || lastNorm.includes(replyNorm))) {
          broadcastToAll('character:thinking', { characterId: charId, thinking: false })
          continue
        }

        const charMsg: Message = {
          id: uuidv4(),
          role: 'character',
          characterId: charId,
          content: reply,
          llmProvider: settings.llm.provider,
          llmModel: settings.llm.model,
          debugPrompt,
          emotion: parsed?.emotion || 'neutral',
          timestamp: Date.now()
        }
        lastReplyText = reply
        conv.messages.push(charMsg)
        conv.updatedAt = Date.now()
        broadcastToAll('conversation:updated', conv)
        broadcastToAll('character:new-message', { characterId: charId, message: charMsg })
        showSpeechBubble(charId, char.name, reply)
        broadcastToAll('character:thinking', { characterId: charId, thinking: false })
      } catch (e: unknown) {
        // If a secondary decision fails, don't break the whole send flow.
        broadcastToAll('character:thinking', { characterId: charId, thinking: false })
      }
    }

    fileStore.saveConversation(conv)
    return { ok: true }
  })

  // Force speak: one character speaks now
  ipcMain.handle('character:force-speak', async (_, characterId: string) => {
    const conv = getActiveConversation()
    const char = getCharacter(characterId)
    if (!conv || !char) return { error: 'Not found' }

    broadcastToAll('character:thinking', { characterId, thinking: true })
    try {
      const recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
      const forceInstruction: Message = {
        id: uuidv4(),
        role: 'system',
        content: [
          `Ask ${char.name} to continue the current conversation naturally.`,
          'Use the full recent conversation as context, especially the latest message.',
          'Do not repeat what the previous speaker already said, and do not answer the earliest question again unless it is still relevant.',
          'Speak in this character voice, personality, stance, and current mood.',
          'Add a fresh reaction, opinion, action, or follow-up that moves the conversation forward.',
          'Do not mention prompts, system instructions, or that you are reading context.'
        ].join('\n'),
        timestamp: Date.now()
      }
      const { content, emotion, debugPrompt } = await chatWithOpenAI({
        settings,
        character: char,
        messages: [...recentMessages, forceInstruction],
        speakerNameById: getSpeakerNameById()
      })
      const msg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId,
        content,
        llmProvider: settings.llm.provider,
        llmModel: settings.llm.model,
        debugPrompt,
        emotion,
        timestamp: Date.now()
      }
      conv.messages.push(msg)
      conv.updatedAt = Date.now()
      fileStore.saveConversation(conv)
      broadcastToAll('conversation:updated', conv)
      broadcastToAll('character:new-message', { characterId, message: msg })
      showSpeechBubble(characterId, char.name, content)
      return { ok: true }
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) }
    } finally {
      broadcastToAll('character:thinking', { characterId, thinking: false })
    }
  })

  // Mute toggle
  ipcMain.handle('desktop:toggle-mute', (_, characterId: string) => {
    const d = settings.ui.desktopCharacters.find(d => d.characterId === characterId)
    if (!d) return false
    d.muted = !d.muted
    fileStore.saveSettings(settings)
    broadcastToAll('desktop:updated', settings.ui.desktopCharacters)
    return d.muted
  })

  // Import ST character card (JSON)
  ipcMain.handle('character:import-json', (_, jsonStr: string) => {
    try {
      const raw = JSON.parse(jsonStr)
      const data = raw.data ?? raw
      const id = uuidv4()
      const char: Character = {
        id,
        name: data.name ?? raw.name ?? 'Unknown',
        avatar: '',
        description: data.description ?? '',
        personality: data.personality ?? '',
        firstMessage: data.first_mes ?? raw.first_mes ?? '',
        exampleDialogue: data.mes_example ?? raw.mes_example ?? '',
        emotions: {},
        scenario: data.scenario ?? raw.scenario,
        systemPromptOverride: data.system_prompt ?? raw.system_prompt,
        creatorNotes: data.creator_notes ?? raw.creatorcomment,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      characters.push(char)
      fileStore.saveCharacter(char)
      broadcastToAll('characters:updated', characters)
      return char
    } catch (e) {
      return { error: String(e) }
    }
  })
}
