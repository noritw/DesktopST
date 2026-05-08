import { ipcMain, shell, BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { AppSettings, Character, Conversation, Message } from './types'
import * as fileStore from './fileStore'
import { chatWithOpenAI } from './llm/openaiAdapter'
import {
  createCharacterWindow, closeCharacterWindow, getCharacterWindow,
  toggleInputWindow, toggleLogWindow, openSettingsWindow,
  broadcastToAll, getAllCharacterWindows
} from './windowManager'

// ── In-memory state ───────────────────────────────────────

let settings: AppSettings
let characters: Character[]
let activeConversationId: string | null = null
let conversations: Map<string, Conversation> = new Map()

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
    // Move the actual window
    const win = getCharacterWindow(characterId)
    if (win && !win.isDestroyed()) {
      win.setPosition(pos.x, pos.y)
    }
    return true
  })

  // Mouse hit-test: toggle click-through on character window
  ipcMain.on('mouse:set-ignore', (event, ignore: boolean) => {
    const win = getAllCharacterWindows().find(w => w.webContents === event.sender)
    if (win && !win.isDestroyed()) {
      win.setIgnoreMouseEvents(ignore, { forward: true })
    }
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
    if (win && !win.isDestroyed()) win.hide()
    return true
  })

  ipcMain.handle('window:open-data-folder', () => {
    shell.openPath(fileStore.getDataDir())
    return true
  })

  // Conversation
  ipcMain.handle('conversation:get', () => getActiveConversation())

  ipcMain.handle('conversation:new', () => {
    const conv = createNewConversation()
    broadcastToAll('conversation:updated', conv)
    return conv
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

  // Messaging
  ipcMain.handle('message:send', async (_, payload: { content: string; images?: string[] }) => {
    const conv = getActiveConversation()
    if (!conv) return { error: 'No active conversation' }

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

    // Get responding characters (non-muted desktop chars)
    const respondingIds = settings.ui.desktopCharacters
      .filter(d => !d.muted)
      .map(d => d.characterId)

    if (respondingIds.length === 0) {
      fileStore.saveConversation(conv)
      return { ok: true }
    }

    // For Stage 1: all non-muted characters respond in order
    for (const charId of respondingIds) {
      const char = getCharacter(charId)
      if (!char) continue

      try {
        const recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
        const { content, emotion } = await chatWithOpenAI({
          settings,
          character: char,
          messages: recentMessages.filter(m => m.id !== userMsg.id || true),
          images: payload.images
        })

        const charMsg: Message = {
          id: uuidv4(),
          role: 'character',
          characterId: charId,
          content,
          emotion,
          timestamp: Date.now()
        }
        conv.messages.push(charMsg)
        conv.updatedAt = Date.now()
        broadcastToAll('conversation:updated', conv)
        broadcastToAll('character:new-message', { characterId: charId, message: charMsg })
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e)
        const errMsg2: Message = {
          id: uuidv4(),
          role: 'system',
          content: `[錯誤] ${errMsg}`,
          timestamp: Date.now()
        }
        conv.messages.push(errMsg2)
        broadcastToAll('conversation:updated', conv)
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

    try {
      const recentMessages = conv.messages.slice(-(settings.memory.keepRecentN))
      const { content, emotion } = await chatWithOpenAI({ settings, character: char, messages: recentMessages })
      const msg: Message = {
        id: uuidv4(),
        role: 'character',
        characterId,
        content,
        emotion,
        timestamp: Date.now()
      }
      conv.messages.push(msg)
      conv.updatedAt = Date.now()
      fileStore.saveConversation(conv)
      broadcastToAll('conversation:updated', conv)
      broadcastToAll('character:new-message', { characterId, message: msg })
      return { ok: true }
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) }
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
