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
  spriteIds?: Record<string, string>
  scenario?: string
  systemPromptOverride?: string
  creatorNotes?: string
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
  inputTokens?: number
  outputTokens?: number
  utilityInputTokens?: number
  utilityOutputTokens?: number
  utilityDebugPrompt?: string
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
  color: string           // 便利貼背景色
  visible: boolean        // true=貼在桌面；false=收回管理介面
  position: { x: number; y: number }
  size?: { width: number; height: number }
  fontSize?: number       // 便利貼內文字級（px），未設定時 fallback 到全域字級
  updatedAt: number
}

export type ReminderSchedule =
  | { type: 'startup' }
  | { type: 'once'; at: number }
  | { type: 'daily'; hour: number; minute: number }
  | { type: 'interval'; intervalMs: number }

export interface Reminder {
  id: string
  characterId?: string
  label: string
  prompt: string
  schedule: ReminderSchedule
  enabled: boolean
  injectPinnedNotes?: boolean
  lastTriggeredAt?: number
  createdAt: number
}

export interface PersonaPreset {
  id: string
  name: string
  displayName: string
  nickname: string
  nicknames?: string[]
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
    /** @deprecated use apiKeys[provider] instead */
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
    /** 提醒發話、情緒分類是否使用獨立輔助模型（群組對話一律用扮演主模型） */
    utilityEnabled?: boolean
    /** 輔助模型的供應商（未設定時跟隨 provider） */
    utilityProvider?: 'openai' | 'claude' | 'gemini' | 'grok'
    /** 各供應商的輔助模型名稱 */
    utilityModels?: Record<string, string>
  }
  memory: {
    keepRecentN: number
    autoSummarizeAfter: number
  }
  updates?: {
    checkOnStartup?: boolean
    dismissedVersion?: string
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
    /** 首次啟動引導完成後為 true */
    onboardingCompleted?: boolean
    /** 便利貼資料 */
    pinnedNotes?: PinnedNote[]
    /** 介面配色主題 */
    colorTheme?: 'mint' | 'butter' | 'peach' | 'aqua' | 'sky' | 'blush' | 'lavender' | 'white' | 'dark'
    /** 角色視窗永遠顯示在最上層 */
    alwaysOnTop?: boolean
    /** 對話泡泡自動消失設定 */
    chatBubbleAutoClose?: {
      enabled: boolean
      seconds: number
    }
    /** 提醒通知音效設定 */
    reminderNotificationSound?: {
      enabled: boolean
      volume: number
      customSoundPath?: string
    }
    /** 訊息通知音效設定 */
    messageNotificationSound?: {
      enabled: boolean
      volume: number
      customSoundPath?: string
    }
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
    electronBuild: {
      rendererUrl: string | null
    }
  }
}
