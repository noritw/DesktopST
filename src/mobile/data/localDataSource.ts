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

/**
 * 獨立模式的資料來源：直接呼叫 `core/` ＋ Capacitor adapter。
 *
 * ## 為什麼現在是空殼（**刻意的，比照 `localEventSource.ts`**）
 *
 * 這支的每個方法都要經過 `StorageAdapter` 讀寫手機沙箱，而 Capacitor 版的
 * adapter 尚未實作（`src/mobile/README.md`：「實作到哪個裝哪個」，避免裝一堆
 * 沒有呼叫端的相依）。先寫一份猜測的實作，等真的接上時多半要重寫 ——
 * 那正是階段 0 要避免的「拆掉重寫」。
 *
 * **階段 0-③ 要的產出是介面與契約，不是可運作的獨立模式。**
 * 內容在階段 2（聊天）、3（角色）、5（預設組）逐段填入；
 * 填的時候是把 `not-supported` 換成呼叫 core，介面形狀不會變。
 *
 * ## 已經可以確定的兩件事（所以現在就寫下來）
 *
 * 1. `capabilities` 是定值：獨立模式恆有 API Key 存取（金鑰就在本機，沒有傳輸問題），
 *    恆無遙控與截圖（決議②）。
 * 2. 這裡**不會有**重連、對帳、逾時保險那類東西 —— 那些是遙控獨有的麻煩，
 *    已經關在 `remoteEventSource` 裡。這支短，就是那件事做對了的證據。
 */
export class LocalDataSource implements DataSource {
  readonly capabilities: Capabilities = {
    apiKeyAccess: true,
    remoteControl: false,
    screenshot: false
  }

  getState(): Promise<AppStateSnapshot> {
    return Promise.reject(pending('getState', 2))
  }

  sendMessage(_input: SendMessageInput): Promise<void> {
    return Promise.reject(pending('sendMessage', 2))
  }

  getMessageImageUrl(_messageId: string, _index: number): Promise<string | null> {
    return Promise.reject(pending('getMessageImageUrl', 2))
  }

  readonly conversations: ConversationsApi = {
    list: () => Promise.reject(pending('conversations.list', 2)),
    load: () => Promise.reject(pending('conversations.load', 2)),
    create: () => Promise.reject(pending('conversations.create', 2)),
    rename: () => Promise.reject(pending('conversations.rename', 2)),
    remove: () => Promise.reject(pending('conversations.remove', 2))
  }

  readonly messages: MessagesApi = {
    remove: () => Promise.reject(pending('messages.remove', 2)),
    edit: () => Promise.reject(pending('messages.edit', 2)),
    resend: () => Promise.reject(pending('messages.resend', 2))
  }

  readonly characters: CharactersApi = {
    list: () => Promise.reject(pending('characters.list', 2)),
    get: () => Promise.reject(pending('characters.get', 3)),
    save: () => Promise.reject(pending('characters.save', 3)),
    remove: () => Promise.reject(pending('characters.remove', 3)),
    create: () => Promise.reject(pending('characters.create', 3)),
    saveAvatar: () => Promise.reject(pending('characters.saveAvatar', 3)),
    importCard: () => Promise.reject(pending('characters.importCard', 3)),
    exportCard: () => Promise.reject(pending('characters.exportCard', 3)),
    importPack: () => Promise.reject(pending('characters.importPack', 3)),
    exportPack: () => Promise.reject(pending('characters.exportPack', 3)),
    setPresent: () => Promise.reject(pending('characters.setPresent', 2)),
    toggleMute: () => Promise.reject(pending('characters.toggleMute', 2)),
    speak: () => Promise.reject(pending('characters.speak', 2)),
    avatarUrl: () => Promise.reject(pending('characters.avatarUrl', 2))
  }

  readonly presets: PresetsApi = {
    listPersonas: () => Promise.reject(pending('presets.listPersonas', 2)),
    listWorlds: () => Promise.reject(pending('presets.listWorlds', 2)),
    listScenes: () => Promise.reject(pending('presets.listScenes', 2)),
    getPersona: () => Promise.reject(pending('presets.getPersona', 5)),
    getWorld: () => Promise.reject(pending('presets.getWorld', 5)),
    getScene: () => Promise.reject(pending('presets.getScene', 5)),
    activePersonaId: () => Promise.reject(pending('presets.activePersonaId', 2)),
    activeWorldId: () => Promise.reject(pending('presets.activeWorldId', 2)),
    activeSceneId: () => Promise.reject(pending('presets.activeSceneId', 2)),
    activatePersona: () => Promise.reject(pending('presets.activatePersona', 2)),
    activateWorld: () => Promise.reject(pending('presets.activateWorld', 2)),
    applyScene: () => Promise.reject(pending('presets.applyScene', 2)),
    savePersona: () => Promise.reject(pending('presets.savePersona', 5)),
    saveWorld: () => Promise.reject(pending('presets.saveWorld', 5)),
    saveScene: () => Promise.reject(pending('presets.saveScene', 5)),
    removePersona: () => Promise.reject(pending('presets.removePersona', 5)),
    removeWorld: () => Promise.reject(pending('presets.removeWorld', 5)),
    removeScene: () => Promise.reject(pending('presets.removeScene', 5))
  }

  readonly settings: SettingsApi = {
    setColorTheme: () => Promise.reject(pending('settings.setColorTheme', 4)),
    getLlm: () => Promise.reject(pending('settings.getLlm', 4)),
    setLlmProvider: () => Promise.reject(pending('settings.setLlmProvider', 4)),
    setLlmModel: () => Promise.reject(pending('settings.setLlmModel', 4)),
    setLlmEndpoint: () => Promise.reject(pending('settings.setLlmEndpoint', 4)),
    setLlmApiKey: () => Promise.reject(pending('settings.setLlmApiKey', 4)),
    getMemory: () => Promise.reject(pending('settings.getMemory', 4)),
    setMemory: () => Promise.reject(pending('settings.setMemory', 4)),
    listModules: () => Promise.reject(pending('settings.listModules', 4)),
    setModuleEnabled: () => Promise.reject(pending('settings.setModuleEnabled', 4)),
    getWeather: () => Promise.reject(pending('settings.getWeather', 4)),
    setWeather: () => Promise.reject(pending('settings.setWeather', 4)),
    detectWeatherLocation: () => Promise.reject(pending('settings.detectWeatherLocation', 4)),
    geocodeWeatherLocation: () => Promise.reject(pending('settings.geocodeWeatherLocation', 4)),
    fetchWeatherNow: () => Promise.reject(pending('settings.fetchWeatherNow', 4))
  }

  readonly lorebooks: LorebooksApi = {
    list: () => Promise.reject(pending('lorebooks.list', 3)),
    get: () => Promise.reject(pending('lorebooks.get', 9)),
    save: () => Promise.reject(pending('lorebooks.save', 9)),
    remove: () => Promise.reject(pending('lorebooks.remove', 9)),
    create: () => Promise.reject(pending('lorebooks.create', 9))
  }

  // 獨立模式的新聞抓取要在手機上自己連 Google News／RSS（B3 之後的事），
  // 端點層的 `readerFetch.ts` 目前綁在 main。介面形狀已固定，填的時候只換實作。
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
    getSettings: () => Promise.reject(pending('news.getSettings', 6)),
    saveSettings: () => Promise.reject(pending('news.saveSettings', 6)),
    getSchedule: () => Promise.reject(pending('news.getSchedule', 6)),
    setSchedule: () => Promise.reject(pending('news.setSchedule', 6))
  }

  readonly reminders: RemindersApi = {
    list: () => Promise.reject(pending('reminders.list', 4)),
    create: () => Promise.reject(pending('reminders.create', 4)),
    save: () => Promise.reject(pending('reminders.save', 4)),
    remove: () => Promise.reject(pending('reminders.remove', 4)),
    toggle: () => Promise.reject(pending('reminders.toggle', 4))
  }

  /**
   * 遙控面板（清單 H1–H11，B6）。**永久不支援，不是 pending stage** ——
   * 獨立模式沒有電腦可控，這件事不會在任何未來階段被填入。
   * `capabilities.remoteControl` 恆為 false，UI 應該先靠這個旗標把入口整個
   * 藏起來（不渲染，不是顯示但 disabled），走到這裡代表 UI 出了 bug。
   */
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

/** 尚未實作。標明會在哪個階段填入，免得日後只看到一句 not-supported。 */
function pending(method: string, stage: number): DataError {
  return new DataError('not-supported', `${method}: 獨立模式尚未實作（B3 階段 ${stage}）`)
}

/** 永久不支援（見 `remoteControl` 上的說明），與 `pending()` 刻意分開避免誤植階段編號。 */
function unsupported(method: string): DataError {
  return new DataError('not-supported', `${method}: 獨立模式沒有電腦可控，永久不支援`)
}
