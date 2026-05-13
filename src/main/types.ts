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
  lastDesktopSize?: number
  lastDesktopFlipped?: boolean
  lastDesktopPosition?: { x: number; y: number }
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
  flipped: boolean
  muted: boolean
  zIndex: number
}

export interface WindowBoundsState {
  x: number
  y: number
  width: number
  height: number
}

export interface PinnedNote {
  id: string
  characterId: string
  title: string
  content: string
  color: string           // 便利貼背景色，e.g. '#FFE8AA'
  visible: boolean        // true=貼在桌面；false=收回管理介面
  position: { x: number; y: number }
  size?: { width: number; height: number }
  fontSize?: number       // 便利貼內文字級（px），未設定時 fallback 到全域字級
  updatedAt: number
}

export interface PersonaPreset {
  id: string
  name: string
  displayName: string
  nickname: string
  description: string
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

export interface WorldPreset {
  id: string
  name: string
  worldSetting: string
  interactionExample: string
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  activePersonaId: string
  activeWorldId: string
  injectSystemTime: boolean
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'grok'
    /** @deprecated use apiKeys[provider] instead; kept for migration */
    apiKey: string
    apiKeys: Record<string, string>
    model: string
    /** Per-provider model selection; takes precedence over single `model` field */
    models?: Record<string, string>
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
  ui: {
    desktopCharacters: DesktopCharacterState[]
    inputWindowPosition: { x: number; y: number }
    inputWindowBounds?: WindowBoundsState
    logWindowBounds?: WindowBoundsState
    emojiPickerOffset?: { x: number; y: number }
    unfocusedBubbleOpacity: number
    theme: 'light' | 'dark' | 'auto'
    hoverMenuOnHover: boolean
    /** 全域字級：xs=12 / sm=13 / md=14（預設）/ lg=16 / xl=18 px */
    chatFontSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    /** 上次在記錄／輸入端使用的作用中對話；重開程式時還原 */
    lastActiveConversationId?: string
    /** 首次啟動引導完成後為 true，避免重複打擾 */
    onboardingCompleted?: boolean
    /** 便利貼資料 */
    pinnedNotes?: PinnedNote[]
  }
}

/** Legacy shape — used only for migration detection */
export interface LegacyAppSettings extends Omit<AppSettings, 'activePersonaId' | 'activeWorldId'> {
  worldSetting?: string
  interactionExample?: string
  persona?: {
    displayName: string
    nickname: string
    description: string
  }
  activePersonaId?: string
  activeWorldId?: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  activePersonaId: '',
  activeWorldId: '',
  injectSystemTime: true,
  llm: {
    provider: 'openai',
    apiKey: '',
    apiKeys: { openai: '', claude: '', gemini: '', grok: '' },
    model: 'gpt-4o',
    maxResponseTokens: 360,
    maxGroupRounds: 3,
    maxImagesPerMessage: 5,
    temperature: 0.8
  },
  memory: {
    keepRecentN: 20,
    autoSummarizeAfter: 50
  },
  ui: {
    desktopCharacters: [],
    inputWindowPosition: { x: 100, y: 100 },
    unfocusedBubbleOpacity: 0.1,
    theme: 'light',
    hoverMenuOnHover: true,
    onboardingCompleted: false
  }
}
