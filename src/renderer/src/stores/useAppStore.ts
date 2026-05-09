import { create } from 'zustand'
import type { AppSettings, Character, Conversation, DesktopCharacterState, Message } from '../types'

interface AppStore {
  // Data
  settings: AppSettings | null
  characters: Character[]
  desktopCharacters: DesktopCharacterState[]
  conversation: Conversation | null
  isSending: boolean
  thinkingByCharacterId: Record<string, boolean>

  // Actions
  loadAll: () => Promise<void>
  subscribeToEvents: () => () => void

  sendMessage: (content: string, images?: string[]) => Promise<void>
  forceSpeak: (characterId: string) => Promise<void>
  toggleMute: (characterId: string) => Promise<void>
  removeFromDesktop: (characterId: string) => Promise<void>
  saveSettings: (s: AppSettings) => Promise<void>
  saveCharacter: (c: Character) => Promise<void>
  deleteCharacter: (id: string) => Promise<void>
  addToDesktop: (characterId: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  newConversation: () => Promise<void>
  importCharacterJson: (json: string) => Promise<Character | null>
}

export const useAppStore = create<AppStore>((set, get) => ({
  settings: null,
  characters: [],
  desktopCharacters: [],
  conversation: null,
  isSending: false,
  thinkingByCharacterId: {},

  loadAll: async () => {
    const data = await window.api.invoke('store:get-all') as {
      settings: AppSettings
      characters: Character[]
      desktopCharacters: DesktopCharacterState[]
      conversation: Conversation | null
    }
    set({
      settings: data.settings,
      characters: data.characters,
      desktopCharacters: data.desktopCharacters,
      conversation: data.conversation
    })
  },

  subscribeToEvents: () => {
    const unsubs = [
      window.api.on('settings:updated', (s) => set({ settings: s as AppSettings })),
      window.api.on('characters:updated', (c) => set({ characters: c as Character[] })),
      window.api.on('desktop:updated', (d) => set({ desktopCharacters: d as DesktopCharacterState[] })),
      window.api.on('conversation:updated', (c) => set({ conversation: c as Conversation })),
      window.api.on('character:thinking', (payload) => {
        const p = payload as { characterId: string; thinking: boolean }
        set(state => ({
          thinkingByCharacterId: { ...state.thinkingByCharacterId, [p.characterId]: p.thinking }
        }))
      })
    ]
    return () => unsubs.forEach(u => u())
  },

  sendMessage: async (content, images) => {
    set({ isSending: true })
    try {
      await window.api.invoke('message:send', { content, images })
    } finally {
      set({ isSending: false })
    }
  },

  forceSpeak: async (characterId) => {
    await window.api.invoke('character:force-speak', characterId)
  },

  toggleMute: async (characterId) => {
    await window.api.invoke('desktop:toggle-mute', characterId)
  },

  removeFromDesktop: async (characterId) => {
    await window.api.invoke('desktop:remove-character', characterId)
  },

  saveSettings: async (s) => {
    await window.api.invoke('settings:save', s)
    set({ settings: s })
  },

  saveCharacter: async (c) => {
    await window.api.invoke('character:save', c)
  },

  deleteCharacter: async (id) => {
    await window.api.invoke('character:delete', id)
  },

  addToDesktop: async (characterId) => {
    await window.api.invoke('desktop:add-character', characterId)
  },

  deleteMessage: async (messageId) => {
    await window.api.invoke('conversation:delete-message', messageId)
  },

  newConversation: async () => {
    const conv = await window.api.invoke('conversation:new') as Conversation
    set({ conversation: conv })
  },

  importCharacterJson: async (json) => {
    const result = await window.api.invoke('character:import-json', json)
    if (result && typeof result === 'object' && 'error' in (result as object)) return null
    return result as Character
  }
}))

// Selectors
export const selectCharacter = (id: string) => (state: AppStore) =>
  state.characters.find(c => c.id === id) ?? null

export const selectDesktopChar = (id: string) => (state: AppStore) =>
  state.desktopCharacters.find(d => d.characterId === id) ?? null

const EMPTY_MESSAGES: Message[] = []

export const selectMessages = (state: AppStore): Message[] =>
  state.conversation?.messages ?? EMPTY_MESSAGES

export const selectCharacterLastMessage = (characterId: string) => (state: AppStore): Message | null => {
  const msgs = state.conversation?.messages ?? []
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].characterId === characterId) return msgs[i]
  }
  return null
}
