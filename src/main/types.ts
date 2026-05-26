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
  randomResult?: RandomResult
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

export interface WeatherSettings {
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: 'ip' | 'manual' | ''
}

export type OmikujiTier = '大吉' | '中吉' | '小吉' | '吉' | '末吉' | '凶' | '大凶'

export type RandomResult =
  | { tool: 'omikuji'; result: OmikujiTier }
  | { tool: 'jiao'; result: '聖筊' | '笑筊' | '陰筊' }
  | { tool: 'coin'; result: '正面' | '反面' }
  | { tool: 'dice'; faces: number; count: number; rolls: number[]; kept: number[]; keepHighest?: number; keepLowest?: number; modifier: number; total: number }

export interface PendingRandomTool {
  tool: 'omikuji' | 'jiao' | 'coin' | 'dice'
  faces?: number
  count?: number
  modifier?: number
  keepHighest?: number
  keepLowest?: number
}

export interface AppSettings {
  activePersonaId: string
  activeWorldId: string
  injectSystemTime: boolean
  weather?: WeatherSettings
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
    versionPublishedAt?: string
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
    /** 角色視窗保持在最上層（預設 true）*/
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
    /** 閒置超過幾分鐘時略過提醒（0 = 不略過）*/
    reminderIdleSkipMinutes?: number
    /** 截圖時是否保留對話輸入框 */
    screenshotIncludeInputWindow?: boolean
  }
}

export type ReminderSchedule =
  | { type: 'startup' }
  | { type: 'once'; at: number }
  | { type: 'daily'; hour: number; minute: number }
  /** days: 0=週日 … 6=週六（與 JS Date.getDay() 一致），可複選 */
  | { type: 'weekly'; days: number[]; hour: number; minute: number }
  | { type: 'interval'; intervalMs: number }

export interface Reminder {
  id: string
  /** 未設定時觸發時隨機選桌面上的未靜音角色 */
  characterId?: string
  label: string
  prompt: string
  schedule: ReminderSchedule
  enabled: boolean
  /** 觸發時將桌面可見便利貼內容附入 prompt */
  injectPinnedNotes?: boolean
  /** 觸發時附入目前對話的近期紀錄（筆數同「記憶」設定） */
  injectConversationContext?: boolean
  /** 觸發時附入天氣資訊（需先在設定設定地點） */
  injectWeather?: boolean
  lastTriggeredAt?: number
  createdAt: number
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
    model: 'gpt-5.4-nano-2026-03-17',
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
    onboardingCompleted: false,
    alwaysOnTop: true,
    chatBubbleAutoClose: {
      enabled: false,
      seconds: 8
    },
    reminderNotificationSound: {
      enabled: true,
      volume: 0.7
    },
    messageNotificationSound: {
      enabled: true,
      volume: 0.7
    },
    screenshotIncludeInputWindow: false
  }
}
