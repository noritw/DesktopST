export interface Character {
  id: string
  name: string
  avatar: string
  description: string
  personality: string
  firstMessage: string
  exampleDialogue: string
  emotions: Record<string, string>
  scenario?: string
  systemPromptOverride?: string
  creatorNotes?: string
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: string
  role: 'user' | 'character' | 'system'
  characterId?: string
  content: string
  emotion?: string
  images?: string[]
  timestamp: number
}

export interface Conversation {
  id: string
  title: string
  participantIds: string[]
  messages: Message[]
  summary: string
  createdAt: number
  updatedAt: number
}

export interface DesktopCharacterState {
  characterId: string
  position: { x: number; y: number }
  size: number
  muted: boolean
  zIndex: number
}

export interface AppSettings {
  worldSetting: string
  interactionExample: string
  injectSystemTime: boolean
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'grok'
    apiKey: string
    model: string
    endpoint?: string
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
    temperature: number
  }
  memory: {
    keepRecentN: number
    autoSummarizeAfter: number
  }
  persona: {
    displayName: string
    nickname: string
    description: string
  }
  ui: {
    desktopCharacters: DesktopCharacterState[]
    inputWindowPosition: { x: number; y: number }
    theme: 'light' | 'dark' | 'auto'
  }
}

// Injected by preload
declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, cb: (...args: unknown[]) => void) => () => void
      once: (channel: string, cb: (...args: unknown[]) => void) => void
    }
    windowParams: {
      get: (key: string) => string | null
    }
  }
}
