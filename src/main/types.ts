export interface Character {
  id: string
  name: string
  nicknames?: string[]
  avatar: string
  description: string
  personality: string
  firstMessage: string
  exampleDialogue: string
  emotions: Record<string, string>
  scenario?: string
  systemPromptOverride?: string
  creatorNotes?: string
  lorebook?: null
  createdAt: number
  updatedAt: number
}

export interface Message {
  id: string
  role: 'user' | 'character' | 'system'
  characterId?: string
  content: string
  llmProvider?: 'openai' | 'claude' | 'gemini' | 'grok'
  llmModel?: string
  debugPrompt?: string
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

export interface WindowBoundsState {
  x: number
  y: number
  width: number
  height: number
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
    inputWindowBounds?: WindowBoundsState
    logWindowBounds?: WindowBoundsState
    theme: 'light' | 'dark' | 'auto'
    hoverMenuOnHover: boolean
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  worldSetting: '',
  interactionExample: '',
  injectSystemTime: true,
  llm: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4o',
    maxResponseTokens: 360,
    maxGroupRounds: 3,
    maxImagesPerMessage: 4,
    temperature: 0.8
  },
  memory: {
    keepRecentN: 20,
    autoSummarizeAfter: 50
  },
  persona: {
    displayName: '主人',
    nickname: '主人',
    description: ''
  },
  ui: {
    desktopCharacters: [],
    inputWindowPosition: { x: 100, y: 100 },
    theme: 'light',
    hoverMenuOnHover: true
  }
}
