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
  /** 角色自帶新聞興趣關鍵字（疊加，普通權重）。 */
  newsKeywords?: string[]
  /** 角色卡掛的用語解說 id（疊加，注入時排在世界觀之前）。見 docs/future-lorebook.md §4.2 */
  lorebookIds?: string[]
  lastDesktopSize?: number
  lastDesktopFlipped?: boolean
  lastDesktopPosition?: { x: number; y: number }
  createdAt: number
  updatedAt: number
}

/** 新聞陪聊 debug 資訊（保留最近一則，供 Log 視窗「新聞」分頁顯示）。 */
export interface NewsDebugInfo {
  groupName: string
  characterKeywords: string[]
  interestTerms: string[]
  item: {
    title: string; source: string; keyword?: string; url: string; summary?: string
    subjectivityScore?: number
    subjectivityReason?: string
  } | null
  fromTopic: boolean
  mode: 'news' | 'topic' | 'survey' | 'notes' | 'none'
}

/** 新聞發話的原文連結中繼資料（保留最近數則，供事後從對話記錄重開泡泡時還原連結卡與互動按鈕）。 */
export interface NewsLinkInfo {
  id: string
  sourceId: string
  title: string
  url: string
  summary: string
  source: string
  keyword?: string
  /** 實際進 Prompt 的上下文；UI 只顯示 title */
  promptContext?: string
}

export interface Message {
  id: string
  role: 'user' | 'character' | 'system'
  characterId?: string
  /**
   * 發話角色當下的名字，**只在 `characterId` 查不到人時當備援**
   * （完整說明見 `core/types.ts` 的同名欄位）。
   *
   * ⚠️ 這份 `Message` 是 renderer 自己維護的平行定義，不是 `core/types.ts`
   * 那份的 re-export（`src/main/types.ts` 才是）。core 加欄位時這裡要一起加，
   * 否則 renderer 讀得到值卻過不了型別檢查。
   */
  characterName?: string
  content: string
  llmProvider?: 'openai' | 'claude' | 'gemini' | 'grok' | 'local'
  llmModel?: string
  debugPrompt?: string
  emotion?: string
  images?: string[]
  randomResult?: RandomResult
  randomResults?: RandomResult[]
  timestamp: number
  inputTokens?: number
  outputTokens?: number
  utilityInputTokens?: number
  utilityOutputTokens?: number
  utilityDebugPrompt?: string
  /** 對話新聞搜尋：意圖萃取 LLM call 的完整 prompt。 */
  convSearchDebugPrompt?: string
  convSearchInputTokens?: number
  convSearchOutputTokens?: number
  /** 此訊息是否保有完整 debug prompt（決定是否顯示「查看完整 Prompt」按鈕） */
  hasDebugPrompt?: boolean
  /** 新聞陪聊 debug（保留最近一則）。 */
  newsDebug?: NewsDebugInfo
  /** 輕量旗標：此訊息是否保有 newsDebug。 */
  hasNewsDebug?: boolean
  /** 新聞發話的原文連結資料（保留最近數則，供對話記錄重開泡泡時還原連結卡與互動按鈕）。 */
  newsLink?: NewsLinkInfo
  /** 使用者對這則角色訊息按的 emoji reaction（單選，限 MESSAGE_REACTION_EMOJIS）。 */
  reaction?: string
  /** 排除於記憶外：不進 prompt 上下文、也不被記憶摘要收錄 */
  excludeFromContext?: boolean
}

/** 訊息 reaction 的固定 emoji 集（泡泡 / Log 視窗共用；😒 對新聞訊息兼作「主題沒興趣」回饋）。 */
export const MESSAGE_REACTION_EMOJIS = ['❤️', '👍', '😂', '🥺', '😮', '😒'] as const

export interface Conversation {
  id: string
  title: string
  participantIds: string[]
  messages: Message[]
  /** 記憶摘要：超出 keepRecentN 的舊訊息濃縮結果（自動或手動產生，使用者可直接編輯） */
  summary: string
  /** 摘要已涵蓋到哪個時間點（最後一則被濃縮訊息的 timestamp） */
  summaryCoversTs?: number
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
  | { type: 'weekly'; days: number[]; hour: number; minute: number }
  | { type: 'interval'; intervalMs: number }

export interface SpotifySettings {
  enabled: boolean
  clientId: string
  displayName?: string
}

export interface CalendarSettings {
  enabled: boolean
  /** 使用者自備的 Google OAuth Client ID（程式碼中不內建任何 ID） */
  clientId: string
  /** Google 桌面應用程式 client 一併發放的密鑰；以 safeStorage 加密存放 */
  clientSecret?: string
  /** 已連結的帳號（Google 為 email） */
  displayName?: string
  /** 往後看幾小時的行程 */
  lookaheadHours: number
  maxEvents: number
  /** 沒有行程時也告訴角色（預設關，省 token） */
  mentionWhenEmpty: boolean
  /** 日曆驅動提醒掃描器：往前掃幾天內的事件（預設 90） */
  reminderScanDays?: number
  /** 本機日曆有變動但還沒推到手機時，是否由角色每天主動提醒使用者去同步（預設開） */
  notifyOnUnsyncedChanges?: boolean
}

export interface MobileSettings {
  enabled: boolean
  port: number
  useTunnel: boolean
}

export interface RegisteredProgram {
  id: string
  name: string
  path: string
  args?: string
  iconDataUrl?: string
  createdAt: number
}

export type RemoteCapability =
  | 'remote.viewScreen'
  | 'remote.captureWindow'
  | 'remote.pointer.click'
  | 'remote.pointer.scroll'
  | 'remote.keyboard.type'
  | 'remote.keyboard.hotkey'
  | 'remote.program.launch'
  | 'remote.program.close'
  | 'remote.monitor.power'
  | 'remote.system.shutdown'
  | 'remote.system.restart'

export interface RegisteredRemoteDevice {
  id: string
  nickname: string
  label?: string
  createdAt: number
  lastSeenAt?: number
}

export interface RemoteControlSettings {
  enabled: boolean
  allowedCapabilities: RemoteCapability[]
  requireConfirmation: RemoteCapability[]
  allowedDevices: RegisteredRemoteDevice[]
  restrictToAllowedDevices: boolean
  logRetention: {
    maxEntries: number
    keepDays?: number
  }
  enableInputControl: boolean
  enableSystemActions: boolean
  registeredPrograms: RegisteredProgram[]
}

/** 見 `core/types.ts` 的同名型別；`gps` 只有手機端會寫入。 */
export type WeatherLocationSource = 'ip' | 'gps' | 'manual' | ''

/** 見 `core/types.ts` 的同名型別 `WeatherProactiveSettings`。 */
export interface WeatherProactiveSettings {
  enabled: boolean
  earthquake: boolean
  earthquakeMinIntensity: number
  typhoon: boolean
  rainTomorrow: boolean
  rainThreshold: number
  tempSwing: boolean
  tempSwingThreshold: number
  niceDay: boolean
  niceDayMinIntervalDays: number
  dailyLimit: number
  quietHours: { start: number; end: number }
  shadowMode: boolean
}

export interface WeatherSettings {
  enabled: boolean
  polish: boolean
  locationName: string
  latitude: number
  longitude: number
  locationSource: WeatherLocationSource
  realtimeQuery?: {
    enabled: boolean
    cwaApiKey: string
    forecastCounty: string
  }
  proactive?: WeatherProactiveSettings
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

export interface Reminder {
  id: string
  characterId?: string
  label: string
  prompt: string
  schedule: ReminderSchedule
  enabled: boolean
  injectPinnedNotes?: boolean
  injectConversationContext?: boolean
  injectWeather?: boolean
  injectNews?: boolean
  injectCalendar?: boolean
  notificationDevice?: 'desktop' | 'mobile' | 'both'
  wakeMode?: 'always' | 'screen_on_only'
  inactiveBehavior?: 'skip' | 'notify_on_unlock'
  allowOfflineFallback?: boolean
  sceneId?: string
  sceneConstraint?: 'any_scene' | 'match_scene_only'
  conversationId?: string
  lastTriggeredAt?: number
  createdAt: number
  updatedAt?: number
  /** 這筆提醒的來源：手動建立，或某個日曆事件衍生。未設定視同 'manual' */
  source?: 'manual' | 'calendar'
  /** source==='calendar' 時，對應的 Google 事件 id */
  sourceEventId?: string
  /** source==='calendar' 時，對應事件本身第幾筆 reminders.overrides */
  sourceOverrideIndex?: number
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
  /** 世界觀掛的用語解說 id（疊加）。見 docs/future-lorebook.md §4.2 */
  lorebookIds?: string[]
  builtIn?: boolean
  createdAt: number
  updatedAt: number
}

export type ColorTheme =
  | 'mint' | 'butter' | 'peach' | 'aqua' | 'sky' | 'blush' | 'lavender' | 'forest' | 'white'
  | 'dark' | 'sepia' | 'cyber'

export interface ScenePreset {
  id: string
  name: string
  activePersonaId: string
  activeWorldId: string
  desktopCharacters: DesktopCharacterState[]
  lastActiveConversationId?: string
  colorTheme?: ColorTheme
  inputWindowBounds?: WindowBoundsState
  logWindowBounds?: WindowBoundsState
  /** 綁定的新聞關鍵字組 id；未綁 = 用預設組。 */
  newsKeywordGroupId?: string
  /** 綁定的用語解說；未綁＝角色卡＋世界觀的疊加結果，有值＝**取代式**（空陣列＝一本都不用）。 */
  lorebookIds?: string[]
  /** 各模組在此情境的開關覆蓋：'on' 強制開、'off' 強制關、無 key＝跟隨全域設定 */
  moduleOverrides?: Record<string, 'on' | 'off'>
  createdAt: number
  updatedAt: number
}

export interface AppSettings {
  activePersonaId: string
  activeWorldId: string
  activeSceneId?: string
  injectSystemTime: boolean
  weather?: WeatherSettings
  spotify?: SpotifySettings
  calendar?: CalendarSettings
  mobile?: MobileSettings
  remoteControl?: RemoteControlSettings
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'grok' | 'local'
    /** @deprecated use apiKeys[provider] instead */
    apiKey: string
    apiKeys: Record<string, string>
    model: string
    /** Per-provider model selection; takes precedence over single `model` field */
    models?: Record<string, string>
    /** @deprecated use endpoints[provider] instead */
    endpoint?: string
    /** 各供應商各自的端點（主模型與輔助模型共用這張表） */
    endpoints?: Record<string, string>
    /** 附加在 system prompt 尾端的自訂指示，對所有供應商生效。 */
    extraInstruction?: string
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
    temperature: number
    /** 提醒發話、情緒分類是否使用獨立輔助模型（群組對話一律用扮演主模型） */
    utilityEnabled?: boolean
    /** 輔助模型的供應商（未設定時跟隨 provider） */
    utilityProvider?: 'openai' | 'claude' | 'gemini' | 'grok' | 'local'
    /** 各供應商的輔助模型名稱 */
    utilityModels?: Record<string, string>
  }
  memory: {
    keepRecentN: number
    autoSummarizeAfter: number
    autoSummarizeEnabled: boolean
    keepDebugPromptN: number
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
    colorTheme?: ColorTheme
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
    /** 閒置超過幾分鐘時略過提醒（0 = 不略過）*/
    reminderIdleSkipMinutes?: number
    /** 按「說點什麼」時是否把桌面可見便利貼當作可聊的話題素材 */
    speakUsePinnedNotes?: boolean
    /** 一般回話時是否把桌面可見便利貼附入 system context */
    chatUsePinnedNotes?: boolean
    /** Include the input window when capturing screenshots with DesktopST windows visible. */
    screenshotIncludeInputWindow?: boolean
    randomToolsEnabled?: boolean
    /** 每則角色回覆旁顯示生成它的模型小圖示（點一下看型號）。未設定＝開啟 */
    showLlmBadge?: boolean
    /** Low performance mode: keeps character transparency, simplifies bubbles, and limits bubble windows. */
    lowPerformanceMode?: boolean
    /** Initial message count shown in the log window while low performance mode is enabled. */
    lowPerformanceLogMessageLimit?: number
    /** Event-driven hit testing: disables the main-process cursor polling loop and relies on renderer events instead. */
    eventDrivenHitTest?: boolean
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

// 用語解說型別直接吃 core，避免在 renderer 重寫一份（比照 modules/news/types.ts）
export type { Lorebook, LoreEntry } from '@core/lore'
