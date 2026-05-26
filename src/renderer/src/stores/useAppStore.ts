import { create } from 'zustand'
import type { AppSettings, Character, Conversation, DesktopCharacterState, Message, PersonaPreset, RandomResult, WorldPreset } from '../types'

export type CharacterContextSnapshot = {
  characterId: string
  lastMessage?: { id: string; emotion?: string; content?: string }
}

interface AppStore {
  // Data
  settings: AppSettings | null
  characters: Character[]
  desktopCharacters: DesktopCharacterState[]
  conversation: Conversation | null
  characterContext: CharacterContextSnapshot | null
  isSending: boolean
  uiAppFocused: boolean
  personaPresets: PersonaPreset[]
  worldPresets: WorldPreset[]

  // Actions
  loadAll: () => Promise<void>
  loadBubbleInit: () => Promise<void>
  loadCharacterInit: () => Promise<void>
  subscribeToEvents: () => () => void
  subscribeBubbleEvents: () => () => void
  subscribeCharacterEvents: () => () => void

  sendMessage: (content: string, images?: string[], randomResult?: RandomResult) => Promise<void>
  continueGroup: () => Promise<void>
  forceSpeak: (characterId: string) => Promise<void>
  toggleMute: (characterId: string) => Promise<void>
  removeFromDesktop: (characterId: string) => Promise<void>
  saveSettings: (s: AppSettings) => Promise<void>
  saveCharacter: (c: Character) => Promise<void>
  deleteCharacter: (id: string) => Promise<void>
  addToDesktop: (characterId: string) => Promise<void>
  deleteMessage: (messageId: string) => Promise<void>
  editMessage: (messageId: string, content: string, emotion?: string) => Promise<void>
  newConversation: () => Promise<void>
  listConversations: () => Promise<Array<{ id: string; title: string; updatedAt: number; createdAt: number }>>
  loadConversation: (id: string) => Promise<void>
  renameConversation: (title: string) => Promise<void>
  clearConversation: () => Promise<void>
  deleteCurrentConversation: () => Promise<void>
  importCharacterJson: (json: string) => Promise<Character | null>
  loadPresets: () => Promise<void>
  savePersonaPreset: (p: PersonaPreset) => Promise<void>
  deletePersonaPreset: (id: string) => Promise<void>
  saveWorldPreset: (w: WorldPreset) => Promise<void>
  deleteWorldPreset: (id: string) => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  settings: null,
  characters: [],
  desktopCharacters: [],
  conversation: null,
  characterContext: null,
  isSending: false,
  uiAppFocused: true,
  personaPresets: [],
  worldPresets: [],

  loadAll: async () => {
    const data = await window.api.invoke('store:get-all') as {
      settings: AppSettings
      characters: Character[]
      desktopCharacters: DesktopCharacterState[]
      conversation: Conversation | null
      characterContext?: CharacterContextSnapshot | null
    }
    const personas = await window.api.invoke('presets:persona:list') as PersonaPreset[]
    const worlds = await window.api.invoke('presets:world:list') as WorldPreset[]
    set({
      settings: data.settings,
      characters: data.characters,
      desktopCharacters: data.desktopCharacters,
      conversation: data.conversation,
      characterContext: data.characterContext ?? null,
      personaPresets: personas,
      worldPresets: worlds
    })
  },

  loadBubbleInit: async () => {
    const data = await window.api.invoke('store:get-all') as { settings: AppSettings }
    set({ settings: data.settings })
  },

  loadCharacterInit: async () => {
    const data = await window.api.invoke('store:get-all') as {
      settings: AppSettings
      characters: Character[]
      desktopCharacters: DesktopCharacterState[]
      characterContext?: CharacterContextSnapshot | null
    }
    set({
      settings: data.settings,
      characters: data.characters,
      desktopCharacters: data.desktopCharacters,
      characterContext: data.characterContext ?? null
    })
  },

  subscribeBubbleEvents: () => {
    const unsub = window.api.on('settings:updated', (s) => {
      set({ settings: s as AppSettings })
    })
    return unsub
  },

  subscribeCharacterEvents: () => {
    const unsubs = [
      window.api.on('settings:updated', (s) => {
        const next = s as AppSettings
        set({ settings: next, desktopCharacters: next.ui.desktopCharacters })
      }),
      window.api.on('characters:updated', (c) => set({ characters: c as Character[] })),
      window.api.on('desktop:updated', (d) => set({ desktopCharacters: d as DesktopCharacterState[] })),
      window.api.on('ui:app-focus', (payload) => {
        const p = payload as { focused: boolean }
        set({ uiAppFocused: !!p.focused })
      })
    ]
    return () => unsubs.forEach(u => u())
  },

  subscribeToEvents: () => {
    const unsubs = [
      window.api.on('settings:updated', (s) => {
        const next = s as AppSettings
        set({ settings: next, desktopCharacters: next.ui.desktopCharacters })
      }),
      window.api.on('characters:updated', (c) => set({ characters: c as Character[] })),
      window.api.on('desktop:updated', (d) => set({ desktopCharacters: d as DesktopCharacterState[] })),
      window.api.on('conversation:updated', (c) => set({ conversation: c as Conversation })),
      window.api.on('ui:app-focus', (payload) => {
        const p = payload as { focused: boolean }
        set({ uiAppFocused: !!p.focused })
      }),
      window.api.on('presets:updated', () => {
        get().loadPresets()
      })
    ]
    return () => unsubs.forEach(u => u())
  },

  sendMessage: async (content, images, randomResult) => {
    set({ isSending: true })
    try {
      await window.api.invoke('message:send', { content, images, randomResult })
    } finally {
      set({ isSending: false })
    }
  },

  continueGroup: async () => {
    set({ isSending: true })
    try {
      await window.api.invoke('character:continue-group')
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
    set(state => {
      const idx = state.characters.findIndex(x => x.id === c.id)
      const chars = [...state.characters]
      if (idx >= 0) chars[idx] = c
      else chars.push(c)
      return { characters: chars }
    })
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

  editMessage: async (messageId, content, emotion) => {
    await window.api.invoke('conversation:edit-message', { messageId, content, emotion })
  },

  newConversation: async () => {
    const conv = await window.api.invoke('conversation:new') as Conversation
    set({ conversation: conv })
  },

  listConversations: async () => {
    return await window.api.invoke('conversation:list') as Array<{ id: string; title: string; updatedAt: number; createdAt: number }>
  },

  loadConversation: async (id: string) => {
    const conv = await window.api.invoke('conversation:load', id) as Conversation | { error: string }
    if (conv && typeof conv === 'object' && 'error' in conv) return
    set({ conversation: conv as Conversation })
  },

  renameConversation: async (title: string) => {
    await window.api.invoke('conversation:rename', title)
  },

  clearConversation: async () => {
    await window.api.invoke('conversation:clear')
  },

  deleteCurrentConversation: async () => {
    await window.api.invoke('conversation:delete-current')
  },

  importCharacterJson: async (json) => {
    const result = await window.api.invoke('character:import-json', json)
    if (result && typeof result === 'object' && 'error' in (result as object)) return null
    return result as Character
  },

  loadPresets: async () => {
    const personas = await window.api.invoke('presets:persona:list') as PersonaPreset[]
    const worlds = await window.api.invoke('presets:world:list') as WorldPreset[]
    set({ personaPresets: personas, worldPresets: worlds })
  },

  savePersonaPreset: async (p) => {
    await window.api.invoke('presets:persona:save', p)
    await get().loadPresets()
  },

  deletePersonaPreset: async (id) => {
    await window.api.invoke('presets:persona:delete', id)
    await get().loadPresets()
  },

  saveWorldPreset: async (w) => {
    await window.api.invoke('presets:world:save', w)
    await get().loadPresets()
  },

  deleteWorldPreset: async (id) => {
    await window.api.invoke('presets:world:delete', id)
    await get().loadPresets()
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

