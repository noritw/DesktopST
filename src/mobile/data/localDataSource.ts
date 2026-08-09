import { DataError } from '@core/data'
import type {
  AppStateSnapshot,
  Capabilities,
  CharactersApi,
  ConversationsApi,
  DataSource,
  MessagesApi,
  NewsApi,
  LorebooksApi,
  PresetsApi,
  RemindersApi,
  RemoteControlApi,
  SendMessageInput,
  SettingsApi
} from '@core/data'
import { DEFAULT_MODEL_BY_PROVIDER } from '@core/llm/modelCatalog'
import { personaKey, worldKey } from '@core/store/keys'
import type { StandaloneSession } from '../runtime/session'
import { newId } from '../runtime/id'

/**
 * 獨立模式的資料來源：呼叫 `StandaloneSession`（core ＋ Capacitor adapters）。
 *
 * news／部分進階設定仍 pending；remoteControl 永久 unsupported。
 */
export class LocalDataSource implements DataSource {
  readonly capabilities: Capabilities = {
    apiKeyAccess: true,
    remoteControl: false,
    screenshot: false
  }

  constructor(private readonly session: StandaloneSession) {}

  getState(): Promise<AppStateSnapshot> {
    return Promise.resolve(this.session.getState())
  }

  sendMessage(input: SendMessageInput): Promise<void> {
    return this.session.sendMessage(input)
  }

  stopGenerating() {
    return this.session.stopGenerating()
  }

  getMessageImageUrl(messageId: string, index: number): Promise<string | null> {
    return this.session.getMessageImageUrl(messageId, index)
  }

  readonly conversations: ConversationsApi = {
    list: async () => this.session.listConversations(),
    load: (id) => this.session.loadConversation(id),
    create: (title) => this.session.createConversation(title),
    rename: (id, title) => this.session.renameConversation(id, title),
    remove: (id) => this.session.removeConversation(id)
  }

  readonly messages: MessagesApi = {
    remove: (id) => this.session.removeMessage(id),
    edit: (id, content) => this.session.editMessage(id, content),
    resend: (id) => this.session.resendMessage(id),
    getDebug: async (id) => this.session.getMessageDebug(id)
  }

  readonly characters: CharactersApi = {
    list: async () => {
      const present = new Set(this.session.settings.ui.desktopCharacters.map((d) => d.characterId))
      return this.session.characters.map((c) => ({
        id: c.id,
        name: c.name,
        present: present.has(c.id)
      }))
    },
    get: async (id) => {
      const c = this.session.characters.find((x) => x.id === id)
      if (!c) throw new DataError('not-found', id)
      return c
    },
    save: (character) => this.session.saveCharacter(character),
    remove: (id) => this.session.removeCharacter(id),
    create: (name) => this.session.createCharacter(name),
    saveAvatar: (id, image) => this.session.saveAvatar(id, image),
    importCard: (file) => this.session.importCard(file),
    exportCard: () => Promise.reject(pending('characters.exportCard', 3)),
    importPack: (bytes, opts) => this.session.importPack(bytes, opts),
    exportPack: () => Promise.reject(pending('characters.exportPack', 3)),
    setPresent: (id, present) => this.session.setPresent(id, present),
    toggleMute: async (id) => {
      await this.session.toggleMute(id)
      const d = this.session.settings.ui.desktopCharacters.find((x) => x.characterId === id)
      return !!d?.muted
    },
    speak: (id) => this.session.speak(id),
    avatarUrl: (id) => this.session.avatarDataUrl(id)
  }

  readonly presets: PresetsApi = {
    listPersonas: async () => this.session.personas.map((p) => ({ id: p.id, name: p.name })),
    listWorlds: async () => this.session.worlds.map((w) => ({ id: w.id, name: w.name })),
    listScenes: async () => this.session.scenes.map((s) => ({ id: s.id, name: s.name })),
    getPersona: async (id) => {
      const p = this.session.personas.find((x) => x.id === id)
      if (!p) throw new DataError('not-found', id)
      return p
    },
    getWorld: async (id) => {
      const w = this.session.worlds.find((x) => x.id === id)
      if (!w) throw new DataError('not-found', id)
      return w
    },
    getScene: async (id) => {
      const s = this.session.scenes.find((x) => x.id === id)
      if (!s) throw new DataError('not-found', id)
      return s
    },
    activePersonaId: async () => this.session.settings.activePersonaId || '',
    activeWorldId: async () => this.session.settings.activeWorldId || '',
    activeSceneId: async () => this.session.settings.activeSceneId || undefined,
    activatePersona: async (id) => {
      if (!this.session.personas.some((p) => p.id === id)) throw new DataError('not-found', id)
      this.session.settings.activePersonaId = id
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    activateWorld: async (id) => {
      if (!this.session.worlds.some((w) => w.id === id)) throw new DataError('not-found', id)
      this.session.settings.activeWorldId = id
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    applyScene: (id) => this.session.applyScene(id),
    captureScene: (id, name) => this.session.captureScene(id, name),
    savePersona: async (preset) => {
      const next = preset.id ? preset : { ...preset, id: newId() }
      const idx = this.session.personas.findIndex((p) => p.id === next.id)
      if (idx >= 0) this.session.personas[idx] = next
      else this.session.personas.push(next)
      await this.session.adapters.storage.writeJson(personaKey(next.id), next)
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    saveWorld: async (preset) => {
      const next = preset.id ? preset : { ...preset, id: newId() }
      const idx = this.session.worlds.findIndex((w) => w.id === next.id)
      if (idx >= 0) this.session.worlds[idx] = next
      else this.session.worlds.push(next)
      await this.session.adapters.storage.writeJson(worldKey(next.id), next)
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    saveScene: (preset) => this.session.saveScene(preset),
    removePersona: (id) => this.session.removePersona(id),
    removeWorld: (id) => this.session.removeWorld(id),
    removeScene: (id) => this.session.removeScene(id)
  }

  readonly settings: SettingsApi = {
    setColorTheme: async (theme) => {
      this.session.settings.ui.colorTheme = theme
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    setShowLlmBadge: async (show) => {
      this.session.settings.ui.showLlmBadge = show
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    setShowPersonaName: async (show) => {
      this.session.settings.ui.showPersonaName = show
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    getLlm: async () => this.session.llmSnapshot(),
    /*
     * `llm.model` 是早期單一供應商時代的欄位，但 `core` 的 `resolveModel()` 仍會
     * 在 `models[provider]` 空的時候拿它來墊 —— 不同步的話，切到 Claude 卻沒挑模型
     * 就會把 OpenAI 的型號送去 Anthropic。桌面 `setLlmProviderDirect` 同樣做這件事。
     */
    setLlmProvider: async (provider) => {
      const llm = this.session.settings.llm
      llm.provider = provider
      const model = llm.models?.[provider] || DEFAULT_MODEL_BY_PROVIDER[provider] || ''
      if (model) {
        llm.models = { ...llm.models, [provider]: model }
        llm.model = model
      }
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    setLlmModel: async (provider, model) => {
      const llm = this.session.settings.llm
      llm.models = { ...llm.models, [provider]: model }
      if (llm.provider === provider) llm.model = model
      await this.session.saveSettings()
    },
    setLlmEndpoint: async (endpoint) => {
      this.session.settings.llm.endpoint = endpoint
      await this.session.saveSettings()
    },
    setLlmUtilityEnabled: async (enabled) => {
      this.session.settings.llm.utilityEnabled = enabled
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    // 同 `setLlmProvider`：換供應商時沒選過型號就補目錄預設值，避免存出空模型。
    setLlmUtilityProvider: async (provider) => {
      const llm = this.session.settings.llm
      llm.utilityProvider = provider
      const model = llm.utilityModels?.[provider] || DEFAULT_MODEL_BY_PROVIDER[provider] || ''
      if (model) llm.utilityModels = { ...llm.utilityModels, [provider]: model }
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    setLlmUtilityModel: async (provider, model) => {
      const llm = this.session.settings.llm
      llm.utilityModels = { ...llm.utilityModels, [provider]: model }
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    setLlmApiKey: async (provider, apiKey) => {
      this.session.settings.llm.apiKeys = {
        ...this.session.settings.llm.apiKeys,
        [provider]: apiKey
      }
      await this.session.saveSettings()
    },
    setLlmChatLimits: async (limits) => {
      this.session.settings.llm.maxResponseTokens = limits.maxResponseTokens
      this.session.settings.llm.maxGroupRounds = limits.maxGroupRounds
      this.session.settings.llm.maxImagesPerMessage = limits.maxImagesPerMessage
      await this.session.saveSettings()
      this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })
    },
    getMemory: async () => ({
      keepRecentN: this.session.settings.memory.keepRecentN,
      autoSummarizeAfter: this.session.settings.memory.autoSummarizeAfter,
      autoSummarizeEnabled: this.session.settings.memory.autoSummarizeEnabled
    }),
    setMemory: async (m) => {
      this.session.settings.memory = { ...this.session.settings.memory, ...m }
      await this.session.saveSettings()
    },
    listModules: async () => this.session.listModules(),
    setModuleEnabled: (id, enabled) => this.session.setModuleEnabled(id, enabled),
    getWeather: async () => {
      const w = this.session.settings.weather
      return {
        enabled: !!w?.enabled,
        polish: !!w?.polish,
        locationName: w?.locationName ?? '',
        latitude: w?.latitude ?? 0,
        longitude: w?.longitude ?? 0,
        locationSource: w?.locationSource ?? '',
        utilityEnabled: !!this.session.settings.llm.utilityEnabled
      }
    },
    setWeather: async (patch) => {
      this.session.settings.weather = {
        enabled: false,
        polish: false,
        locationName: '',
        latitude: 0,
        longitude: 0,
        locationSource: '',
        ...this.session.settings.weather,
        ...patch
      }
      await this.session.saveSettings()
      return this.settings.getWeather()
    },
    detectWeatherLocation: async () => {
      await this.session.detectWeatherLocation()
      return this.settings.getWeather()
    },
    geocodeWeatherLocation: async (name) => {
      await this.session.geocodeWeatherLocation(name)
      return this.settings.getWeather()
    },
    fetchWeatherNow: () => this.session.fetchWeatherNow()
  }

  readonly lorebooks: LorebooksApi = {
    list: () => this.session.listLorebooks(),
    get: async (id) => {
      const book = await this.session.getLorebook(id)
      if (!book) throw new DataError('not-found', id)
      return book
    },
    save: (book) => this.session.saveLorebook(book),
    remove: (id) => this.session.removeLorebook(id),
    create: (name) => this.session.createLorebook(name),
    generateEntry: (characterId, lorebookId) => this.session.generateLoreEntry(characterId, lorebookId)
  }

  readonly news: NewsApi = {
    getReaderState: () => Promise.reject(pending('news.getReaderState', 6)),
    fetchBatch: () => Promise.reject(pending('news.fetchBatch', 6)),
    fetchSection: () => Promise.reject(pending('news.fetchSection', 6)),
    setPinned: () => Promise.reject(pending('news.setPinned', 6)),
    setDismissed: () => Promise.reject(pending('news.setDismissed', 6)),
    setQuota: () => Promise.reject(pending('news.setQuota', 6)),
    setKeywordGroups: () => Promise.reject(pending('news.setKeywordGroups', 6)),
    setSourceOrder: () => Promise.reject(pending('news.setSourceOrder', 6)),
    markOpened: () => Promise.reject(pending('news.markOpened', 6)),
    enrichForChat: () => Promise.reject(pending('news.enrichForChat', 6)),
    updatePromptContext: () => Promise.reject(pending('news.updatePromptContext', 6)),
    getSettings: () => Promise.reject(pending('news.getSettings', 6)),
    saveSettings: () => Promise.reject(pending('news.saveSettings', 6)),
    getSchedule: () => Promise.reject(pending('news.getSchedule', 6)),
    setSchedule: () => Promise.reject(pending('news.setSchedule', 6))
  }

  readonly reminders: RemindersApi = {
    list: async () => this.session.listReminders(),
    create: async () => this.session.createReminder(),
    save: async (reminder) => this.session.saveReminder(reminder),
    remove: async (id) => this.session.removeReminder(id),
    toggle: async (id, enabled) => this.session.toggleReminder(id, enabled)
  }

  readonly remoteControl: RemoteControlApi = {
    getState: () => Promise.reject(unsupported('remoteControl.getState')),
    listDisplays: () => Promise.reject(unsupported('remoteControl.listDisplays')),
    listWindows: () => Promise.reject(unsupported('remoteControl.listWindows')),
    captureDisplay: () => Promise.reject(unsupported('remoteControl.captureDisplay')),
    captureWindow: () => Promise.reject(unsupported('remoteControl.captureWindow')),
    isLocked: () => Promise.reject(unsupported('remoteControl.isLocked')),
    click: () => Promise.reject(unsupported('remoteControl.click')),
    scroll: () => Promise.reject(unsupported('remoteControl.scroll')),
    typeText: () => Promise.reject(unsupported('remoteControl.typeText')),
    sendKey: () => Promise.reject(unsupported('remoteControl.sendKey')),
    listPrograms: () => Promise.reject(unsupported('remoteControl.listPrograms')),
    launchProgram: () => Promise.reject(unsupported('remoteControl.launchProgram')),
    closeProgram: () => Promise.reject(unsupported('remoteControl.closeProgram')),
    systemAction: () => Promise.reject(unsupported('remoteControl.systemAction')),
    hideWindows: () => Promise.reject(unsupported('remoteControl.hideWindows')),
    restoreWindows: () => Promise.reject(unsupported('remoteControl.restoreWindows'))
  }
}

function pending(method: string, stage: number): DataError {
  return new DataError('not-supported', `${method}: 獨立模式尚未實作（B3 階段 ${stage}）`)
}

function unsupported(method: string): DataError {
  return new DataError('not-supported', `${method}: 獨立模式沒有電腦可控，永久不支援`)
}
