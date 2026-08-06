import { app, Tray, Menu, nativeImage, protocol, screen, shell, BrowserWindow, ipcMain } from 'electron'
import { attachDevToolsShortcuts, isDevToolsAllowed } from './devTools'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { loadSettings, saveSettings, flushSaveSettings, loadCharacters, initDefaultCharacters, initDefaultPresets, loadPersonaPresets, loadWorldPresets, loadScenePresets, getDataDir } from './fileStore'
import { initState, registerIpcHandlers, dismissAllAuxWindows, restoreDismissedAuxWindows, hasDismissedAuxWindows, getSettings, getCharacters, getActiveConversationForMobile, addDesktopCharacterDirect, removeDesktopCharacterDirect, captureScreenshotDirect, handleSendMessageFromMobile, setMobileMessageListener, setGetMobileStatusFn, setApplyMobileRuntimeSettingsFn, getConversationListDirect, loadConversationDirect, createConversationDirect, renameConversationDirect, deleteConversationDirect, getScenesDirect, getPersonaPresetsDirect, getWorldPresetsDirect, activatePersonaDirect, activateWorldDirect, savePersonaPresetDirect, saveWorldPresetDirect, saveScenePresetDirect, removePersonaPresetDirect, removeWorldPresetDirect, removeScenePresetDirect, setColorThemeDirect, triggerReminderSpeak, applySceneById, handleSpotifyProtocolUrl, deleteMessageDirect, editMessageDirect, resendMessageDirect, forceSpeakDirect, toggleMuteDirect, createCharacterDirect, saveCharacterDirect, deleteCharacterDirect, saveCharacterAvatarDirect, importCharacterPngDirect, importCharacterJsonDirect, exportCharacterPngDirect, exportCharacterJsonDirect, buildDstPackDirect, importDstPackDirect, listLorebooksDirect, getLorebookDirect, createLorebookDirect, saveLorebookDirect, removeLorebookDirect, getLlmSettingsSummaryDirect, setLlmProviderDirect, setLlmModelDirect, setLlmEndpointDirect, setLlmApiKeyDirect, getMemorySettingsDirect, setMemorySettingsDirect, listMobileModuleTogglesDirect, setMobileModuleEnabledDirect, listRemindersDirect, createReminderDirect, saveReminderDirect, deleteReminderDirect, toggleReminderDirect } from './ipcHandlers'
import { checkForUpdates } from './updateChecker'
import { initReminderScheduler, setIdleSkipMinutes } from './reminderScheduler'
import { loadNewsModuleSettings } from './modules/news/settings'
import {
  createCharacterWindow,
  createCharacterLibraryWindow,
  toggleInputWindow,
  broadcastToAll,
  hideAuxWindowsRememberingState,
  restoreAuxWindowsFromRememberedState,
  isCursorOverInteractiveCharacter,
  shouldSuppressAuxAutoHide,
  openSettingsWindow,
  openPinnedNotesManager,
  openRemindersManager,
  createNewsReaderWindow,
  openQRCodeWindow,
  getCharacterWindowSize,
  suppressAuxAutoHide,
  setCharactersAlwaysOnTop,
  getCharactersAlwaysOnTop,
  destroyAllCharacterWindows,
  setMobileConversationHook,
  broadcastMobileStatus,
  hideAllWindowsForRemote,
  restoreAllWindowsAfterRemote
} from './windowManager'
import {
  startMobileServer,
  stopMobileServer,
  setBridge,
  registerMobileRoute,
  pushMessage,
  pushDesktopUpdate,
  pushRemoteControlState,
  getConnectedCount,
  isServerRunning,
  isMobileAppBuilt
} from './mobileServer'
import {
  startCloudflared,
  stopCloudflared,
  getUrl as getCloudflaredUrl,
  isRunning as isCloudflaredRunning,
  isCloudflaredAvailable,
  onUrlReady
} from './cloudflaredManager'
import { registerTunnel, registerStarting, registerOffline, getRelayUrl, getAccessToken } from './relayService'
import type { AppSettings, DesktopCharacterState } from './types'
import { activateModules, registerBuiltInModule, loadExternalModules } from './modules/moduleHost'
import { moduleSettingsBridge } from './modules/moduleSettings'
import { remoteControlModule, setRemoteControlModuleEnabled } from './modules/remote-control'
import { newsModule } from './modules/news'

function isOffscreen(pos: { x: number; y: number }, win: { width: number; height: number }): boolean {
  const px = Number.isFinite(pos.x) ? pos.x : 0
  const py = Number.isFinite(pos.y) ? pos.y : 0
  const rect = { x: px, y: py, w: win.width, h: win.height }
  const displays = screen.getAllDisplays()
  return !displays.some(d => {
    const wa = d.workArea
    // Intersect test
    const x1 = Math.max(rect.x, wa.x)
    const y1 = Math.max(rect.y, wa.y)
    const x2 = Math.min(rect.x + rect.w, wa.x + wa.width)
    const y2 = Math.min(rect.y + rect.h, wa.y + wa.height)
    return x2 > x1 && y2 > y1
  })
}

function centerInPrimary(win: { width: number; height: number }): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  return {
    x: Math.round(wa.x + (wa.width - win.width) / 2),
    y: Math.round(wa.y + (wa.height - win.height) / 2)
  }
}

function sameRecoveredPosition(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) <= 16 && Math.abs(a.y - b.y) <= 16
}

function spreadCharactersOnPrimary(
  desktopCharacters: DesktopCharacterState[],
  indices: number[]
): boolean {
  if (indices.length === 0) return false

  const wa = screen.getPrimaryDisplay().workArea
  const gap = 24
  const margin = 32
  const sizes = indices.map(i => {
    const scale = Number.isFinite(desktopCharacters[i].size) && desktopCharacters[i].size > 0
      ? desktopCharacters[i].size
      : 1
    return getCharacterWindowSize(scale)
  })
  const cellW = Math.max(...sizes.map(s => s.width)) + gap
  const cellH = Math.max(...sizes.map(s => s.height)) + gap
  const columns = Math.max(1, Math.floor((wa.width - margin * 2 + gap) / cellW))
  const totalRows = Math.ceil(indices.length / columns)
  const maxH = Math.max(...sizes.map(s => s.height))
  const rowStep = totalRows > 1
    ? Math.min(cellH, Math.max(48, (wa.height - margin * 2 - maxH) / (totalRows - 1)))
    : 0

  let changed = false
  indices.forEach((characterIndex, n) => {
    const size = sizes[n]
    const row = Math.floor(n / columns)
    const col = n % columns
    const rowCount = row === totalRows - 1
      ? indices.length - row * columns
      : columns
    const rowWidth = rowCount * cellW - gap
    const startX = wa.x + Math.round((wa.width - rowWidth) / 2)
    const x = startX + col * cellW + Math.round((cellW - gap - size.width) / 2)
    const maxY = wa.y + wa.height - margin - size.height
    const minY = wa.y + margin
    const y = Math.max(minY, Math.min(maxY - row * rowStep, maxY))
    const next = { x: Math.round(x), y: Math.round(y) }
    const current = desktopCharacters[characterIndex].position
    if (current.x !== next.x || current.y !== next.y) {
      desktopCharacters[characterIndex].position = next
      changed = true
    }
  })

  return changed
}

function repairDesktopCharacterLayout(desktopCharacters: DesktopCharacterState[]): boolean {
  let changed = false
  const moved = new Set<number>()
  const offscreen = new Set<number>()

  desktopCharacters.forEach((ds, i) => {
    const scale = Number.isFinite(ds.size) && ds.size > 0 ? ds.size : 1
    const win = getCharacterWindowSize(scale)
    if (isOffscreen(ds.position, win)) offscreen.add(i)
  })

  if (offscreen.size === 1) {
    const i = [...offscreen][0]
    const scale = Number.isFinite(desktopCharacters[i].size) && desktopCharacters[i].size > 0
      ? desktopCharacters[i].size
      : 1
    const next = centerInPrimary(getCharacterWindowSize(scale))
    desktopCharacters[i].position = next
    moved.add(i)
    changed = true
  } else if (offscreen.size > 1) {
    const indices = [...offscreen]
    changed = spreadCharactersOnPrimary(desktopCharacters, indices) || changed
    indices.forEach(i => moved.add(i))
  }

  const grouped = new Set<number>()
  for (let i = 0; i < desktopCharacters.length; i++) {
    if (grouped.has(i)) continue
    const group = [i]
    for (let j = i + 1; j < desktopCharacters.length; j++) {
      if (grouped.has(j)) continue
      if (sameRecoveredPosition(desktopCharacters[i].position, desktopCharacters[j].position)) {
        group.push(j)
      }
    }
    if (group.length < 2) continue
    group.forEach(idx => grouped.add(idx))
    if (group.every(idx => moved.has(idx))) continue
    changed = spreadCharactersOnPrimary(desktopCharacters, group) || changed
    group.forEach(idx => moved.add(idx))
  }

  return changed
}

// ── GPU 加速 ───────────────────────────────────────────────
// 部分機器（尤其較舊內顯／特定驅動版本）會被 Chromium 列入 GPU blocklist，
// 導致透明視窗退回 SwiftShader 軟體合成 → CPU/記憶體暴增。
// 正常機器不需要此旗標（反而可能讓 GPU 程序多佔記憶體）。
// 若某台機器確認是 GPU blocklist 問題，可設環境變數 DESKTOPST_IGNORE_GPU_BLOCKLIST=1 啟用。
// 注意：此 switch 必須在 app ready 之前設定。
if (process.env['DESKTOPST_IGNORE_GPU_BLOCKLIST'] === '1') {
  app.commandLine.appendSwitch('ignore-gpu-blocklist')
}

// ── Single-instance lock + protocol handler ───────────────

// Dev mode needs explicit main-script path so the second instance can start
// correctly before hitting requestSingleInstanceLock and quitting
if (app.isPackaged) {
  app.setAsDefaultProtocolClient('desktopst')
} else {
  app.setAsDefaultProtocolClient('desktopst', process.execPath, [
    path.resolve(process.argv[1] ?? '.')
  ])
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find(arg => arg.startsWith('desktopst://'))
    if (url) handleSpotifyProtocolUrl(url)
  })
}

// ── App lifecycle ─────────────────────────────────────────

/**
 * 把 GPU 加速狀態寫到 %APPDATA%\DesktopST\gpu-diagnostics.log。
 * 用來切分「另一台電腦特別吃資源」是不是因為退回 SwiftShader 軟體渲染
 * （透明視窗在軟體合成下 CPU/記憶體會暴增）。
 * 看 log 裡 gl_compositing / gpu_compositing 是否為 "disabled_software" 或 "software_only"。
 */
function logGpuDiagnostics(): void {
  try {
    const status = app.getGPUFeatureStatus()
    const lines = [
      `[GPU] ${new Date().toISOString()}`,
      `platform=${process.platform} arch=${process.arch} electron=${process.versions.electron} chrome=${process.versions.chrome}`,
      ...Object.entries(status).map(([k, v]) => `  ${k}: ${v}`)
    ]
    const software = Object.values(status).some(v => /software/i.test(String(v)))
    lines.push(`  >> hardwareAccelerated=${!software ? 'YES' : 'NO (falling back to software rendering — 透明視窗會很吃 CPU/記憶體)'}`)
    const text = lines.join('\n') + '\n\n'
    const logPath = path.join(app.getPath('userData'), 'gpu-diagnostics.log')
    fs.writeFileSync(logPath, text, 'utf8')
  } catch (e) {
    console.error('[GPU] diagnostics failed:', e)
  }
}

app.on('ready', async () => {
  logGpuDiagnostics()
  // Register local:// file protocol before any window loads
  protocol.registerFileProtocol('local', (request, callback) => {
    const raw = request.url.slice('local://'.length)
    callback({ path: decodeURIComponent(raw) })
  })

  // Handle protocol URL passed at startup (app wasn't running when redirect happened)
  const startupProtocolUrl = process.argv.find(arg => arg.startsWith('desktopst://'))
  if (startupProtocolUrl) handleSpotifyProtocolUrl(startupProtocolUrl)

  const appRoot = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : app.getAppPath()

  // Load settings
  const settings = loadSettings()

  // Init default characters if first run
  const existingChars = loadCharacters()
  let chars = existingChars
  let desktopState = settings.ui.desktopCharacters

  if (existingChars.length === 0) {
    const result = await initDefaultCharacters(appRoot)
    chars = result.chars
    desktopState = result.desktopState
    if (desktopState.length > 0) {
      settings.ui.desktopCharacters = desktopState
      saveSettings(settings)
    }
  }
  // Init default presets if first run
  const { personas, worlds } = initDefaultPresets(appRoot)
  if (!settings.activePersonaId && personas.length > 0) {
    settings.activePersonaId = personas[0].id
    saveSettings(settings)
  }
  if (!settings.activeWorldId && worlds.length > 0) {
    settings.activeWorldId = worlds[0].id
    saveSettings(settings)
  }

  // Filter out desktop entries whose character card no longer exists
  if (chars.length > 0 && desktopState.length > 0) {
    const charIds = new Set(chars.map(c => c.id))
    const valid = desktopState.filter(ds => charIds.has(ds.characterId))
    if (valid.length !== desktopState.length) {
      desktopState = valid
      settings.ui.desktopCharacters = valid
      saveSettings(settings)
    }
  }

  // Safety: if we have characters but none on desktop, put at least one on.
  if (chars.length > 0 && (!desktopState || desktopState.length === 0)) {
    desktopState = [{
      characterId: chars[0].id,
      position: { x: 80, y: 400 },
      size: 1,
      flipped: false,
      muted: false,
      zIndex: 1
    }]
    settings.ui.desktopCharacters = desktopState
    saveSettings(settings)
  }

  registerBuiltInModule(remoteControlModule)
  registerBuiltInModule(newsModule)
  await loadExternalModules(path.join(getDataDir(), 'local-modules'))
  await activateModules({
    ipc: {
      handle: (channel, handler) => ipcMain.handle(channel, handler)
    },
    mobile: {
      registerRoute: registerMobileRoute
    },
    settings: moduleSettingsBridge,
    host: {
      requestCharacterSpeak: forceSpeakDirect,
      getDesktopCharacters: () => {
        const chars = getCharacters()
        return getSettings().ui.desktopCharacters
          .map(d => {
            const c = chars.find(c => c.id === d.characterId)
            return c ? { id: c.id, name: c.name, muted: !!d.muted } : null
          })
          .filter((c): c is { id: string; name: string; muted: boolean } => c != null)
      }
      // registerContextProvider 由 activateModules per-module 綁定模組 id 後注入
    }
  })

  // Register IPC handlers
  registerIpcHandlers()

  // Init in-memory state
  initState(settings, chars, desktopState)

  // Init reminder scheduler (after state is ready)
  initReminderScheduler(triggerReminderSpeak)
  setIdleSkipMinutes(settings.ui.reminderIdleSkipMinutes ?? 0)

  // Version check on startup (5s delay so UI is ready first)
  setTimeout(() => {
    const s = getSettings()
    if (s.updates?.checkOnStartup !== false) {
      void checkForUpdates({
        silent: true,
        dismissedVersion: s.updates?.dismissedVersion
      }).then(result => {
        let changed = false
        if (result.dismissed && result.latestVersion) {
          s.updates = { ...s.updates, dismissedVersion: result.latestVersion }
          changed = true
        }
        if (changed) {
          saveSettings(s)
          broadcastToAll('settings:updated', s)
        }
      })
    }
  }, 5000)

  // Create character windows for all desktop characters
  const didRepairDesktopLayout = repairDesktopCharacterLayout(settings.ui.desktopCharacters)
  for (const ds of settings.ui.desktopCharacters) {
    createCharacterWindow(ds.characterId, ds.position, ds.size)
  }
  if (didRepairDesktopLayout) saveSettings(settings)

  const noCharacters = chars.length === 0
  const onboardingPending = settings.ui.onboardingCompleted === false

  // 只在「真的需要設定」時強制開啟設定視窗
  // 無 API Key 時允許先操作，在對話時再提示
  if (noCharacters || onboardingPending) {
    suppressAuxAutoHide(5000)
    setImmediate(() => {
      openSettingsWindow(onboardingPending ? 'llm' : 'general')
    })
  }

  // DevTools：僅在目前聚焦的 DesktopST 視窗切換，且同時只保留一個（見 devTools.ts）
  if (isDevToolsAllowed()) {
    app.on('browser-window-created', (_, win) => {
      attachDevToolsShortcuts(win)
    })
    for (const win of BrowserWindow.getAllWindows()) {
      attachDevToolsShortcuts(win)
    }
  }

  // System tray
  setupTray(appRoot)

  // Mobile server
  initMobileServer()
})

// When app loses focus to another application, hide all auxiliary UI to reduce distractions.
let blurTimer: NodeJS.Timeout | null = null
app.on('browser-window-blur', () => {
  if (blurTimer) clearTimeout(blurTimer)
  blurTimer = setTimeout(() => {
    // If we still don't have a focused window, the user has switched to another app.
    const anyFocusedWindow = BrowserWindow.getAllWindows().some(w => !w.isDestroyed() && w.isFocused())
    if (!anyFocusedWindow && !isCursorOverInteractiveCharacter() && !shouldSuppressAuxAutoHide()) {
      hideAuxWindowsRememberingState()
      broadcastToAll('ui:app-focus', { focused: false })
    }
  }, 260)
})

app.on('browser-window-focus', () => {
  if (blurTimer) { clearTimeout(blurTimer); blurTimer = null }
  restoreAuxWindowsFromRememberedState()
  broadcastToAll('ui:app-focus', { focused: true })
})

app.on('window-all-closed', () => {
  // Do nothing — keep app running in tray
})

app.on('before-quit', async (event) => {
  event.preventDefault()
  flushSaveSettings()
  stopMobileServer()
  stopCloudflared()
  await registerOffline()  // 等待完成後再關閉
  app.exit()
})

// ── Mobile server ─────────────────────────────────────────

/** 供 QRCodeWindow IPC 查詢 */
export function getMobileStatus() {
  const s = getSettings()
  const port = s.mobile?.port ?? 3721
  const networkIp = getLocalIp()
  const token = encodeURIComponent(getAccessToken())
  const tunnelUrl = getCloudflaredUrl()
  const relayUrl = getRelayUrl()
  return {
    enabled: s.mobile?.enabled ?? false,
    running: isServerRunning(),
    tunnelReady: !!tunnelUrl,
    // 單一入口：`/` 一律送 B3 React UI（不再有 `?ui=app`／舊版 mobile.html 分流）。
    url: tunnelUrl ? `${tunnelUrl}?token=${token}` : null,
    localUrl: `http://${networkIp}:${port}?token=${token}`,
    relayUrl,
    /** 沒跑過 `npm run build:mobile` 時為 false，QR 視窗要顯示提示而不是壞掉的碼。 */
    appAvailable: isMobileAppBuilt(),
    connectedCount: getConnectedCount(),
    cloudflaredAvailable: isCloudflaredAvailable()
  }
}

function getLocalIp(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '127.0.0.1'
}

let mobileLastConvId = ''
let mobileLastConvMessageCount = 0

// 把 getMobileStatus 注入 ipcHandlers（避免循環 import）
setGetMobileStatusFn(getMobileStatus)
setApplyMobileRuntimeSettingsFn(applyMobileRuntimeSettings)

function applyMobileRuntimeSettings(previous: AppSettings, next: AppSettings): void {
  const prevMobile = previous.mobile
  const nextMobile = next.mobile
  const wasEnabled = prevMobile?.enabled ?? false
  const isEnabled = nextMobile?.enabled ?? false
  const portChanged = (prevMobile?.port ?? 3721) !== (nextMobile?.port ?? 3721)
  const tunnelChanged = (prevMobile?.useTunnel ?? true) !== (nextMobile?.useTunnel ?? true)

  if (!isEnabled) {
    if (wasEnabled || isServerRunning() || isCloudflaredRunning()) {
      stopMobileServer()
      stopCloudflared()
      void registerOffline().finally(() => broadcastMobileStatus(getMobileStatus()))
    }
    return
  }

  if (portChanged && isServerRunning()) {
    stopMobileServer()
    stopCloudflared()
  } else if (tunnelChanged && nextMobile?.useTunnel === false) {
    stopCloudflared()
    void registerOffline()
  }

  initMobileServer()
  broadcastMobileStatus(getMobileStatus())
}

function initMobileServer(): void {
  const s = getSettings()
  if (!s.mobile?.enabled) return

  const port = s.mobile.port ?? 3721

  setBridge({
    getCharacters,
    getDesktopCharacterIds: () => getSettings().ui.desktopCharacters.map(d => d.characterId),
    getDesktopCharacters: () => {
      const chars = getCharacters()
      return getSettings().ui.desktopCharacters
        .map(d => {
          const c = chars.find(c => c.id === d.characterId)
          return c ? { id: c.id, name: c.name, muted: !!d.muted } : null
        })
        .filter((c): c is { id: string; name: string; muted: boolean } => c != null)
    },
    getActiveConversation: getActiveConversationForMobile,
    sendMessage: async (payload) => { await handleSendMessageFromMobile(payload) },
    addDesktopCharacter: addDesktopCharacterDirect,
    removeDesktopCharacter: removeDesktopCharacterDirect,
    captureScreenshot: (withChars: boolean, displayIndex?: number) => captureScreenshotDirect(withChars, displayIndex),
    getConversationList: getConversationListDirect,
    loadConversation: loadConversationDirect,
    createConversation: createConversationDirect,
    renameConversation: renameConversationDirect,
    deleteConversation: deleteConversationDirect,
    forceSpeak: forceSpeakDirect,
    toggleMute: toggleMuteDirect,
    getScenes: getScenesDirect,
    applyScene: applySceneById,
    getPersonaPresets: getPersonaPresetsDirect,
    getWorldPresets: getWorldPresetsDirect,
    activatePersona: activatePersonaDirect,
    activateWorld: activateWorldDirect,
    getActivePersonaId: () => getSettings().activePersonaId,
    getActiveWorldId: () => getSettings().activeWorldId,
    getActiveSceneId: () => getSettings().activeSceneId,
    getPersonaPreset: (id) => loadPersonaPresets().find(p => p.id === id) ?? null,
    getWorldPreset: (id) => loadWorldPresets().find(p => p.id === id) ?? null,
    getScenePreset: (id) => loadScenePresets().find(p => p.id === id) ?? null,
    savePersonaPreset: savePersonaPresetDirect,
    saveWorldPreset: saveWorldPresetDirect,
    saveScenePreset: saveScenePresetDirect,
    removePersonaPreset: removePersonaPresetDirect,
    removeWorldPreset: removeWorldPresetDirect,
    removeScenePreset: removeScenePresetDirect,
    getColorTheme: () => getSettings().ui.colorTheme ?? 'mint',
    setColorTheme: (theme) => setColorThemeDirect(theme),
    getRandomToolsEnabled: () => getSettings().ui.randomToolsEnabled !== false,
    getMaxImagesPerMessage: () => getSettings().llm?.maxImagesPerMessage ?? 5,
    shouldIncludeDeviceNameInPrompt: () => getSettings().mobile?.enabled === true,
    deleteMessage: deleteMessageDirect,
    editMessage: editMessageDirect,
    resendMessage: resendMessageDirect,
    // 角色卡寫入（B3 階段 3）：與桌面 IPC 共用同一批 `*Direct`
    getCharacterCard: (id) => getCharacters().find(c => c.id === id) ?? null,
    createCharacter: createCharacterDirect,
    saveCharacter: saveCharacterDirect,
    deleteCharacter: deleteCharacterDirect,
    saveCharacterAvatar: (id, buffer, ext) => saveCharacterAvatarDirect({ id, buffer, ext }),
    importCharacterPng: importCharacterPngDirect,
    importCharacterJson: (json) => importCharacterJsonDirect({ json }),
    exportCharacterPng: exportCharacterPngDirect,
    exportCharacterJson: exportCharacterJsonDirect,
    buildDstPack: buildDstPackDirect,
    importDstPack: (buffer, opts) => importDstPackDirect(buffer, {
      // 手機端沒有「彈對話框問」這個選項，策略在請求裡就決定好了。
      onConflict: async () => opts.onConflict,
      confirmGlobalSettings: async () => opts.applyGlobalSettings
    }),
    listLorebooks: () => listLorebooksDirect(),
    getLorebook: (id) => getLorebookDirect(id),
    createLorebook: (name) => createLorebookDirect(name),
    saveLorebook: (book) => saveLorebookDirect(book),
    removeLorebook: (id) => removeLorebookDirect(id),
    getRemoteControlSettings: () => getSettings().remoteControl,
    setRemoteControlEnabled: (enabled: boolean) => {
      const s = getSettings()
      if (!s.remoteControl) return { error: 'Remote control settings not available' }
      s.remoteControl = setRemoteControlModuleEnabled(s.remoteControl, enabled)
      saveSettings(s)
      broadcastToAll('settings:updated', s)
      pushRemoteControlState()
      return { ok: true }
    },
    touchAllowedRemoteDevice: (device) => {
      if (!device.id) return
      const s = getSettings()
      if (!s.remoteControl?.allowedDevices?.length) return
      const existing = s.remoteControl.allowedDevices.find(d => d.id === device.id)
      if (!existing) return
      existing.nickname = device.nickname || existing.nickname
      existing.label = device.label || existing.label
      existing.lastSeenAt = Date.now()
      saveSettings(s)
      broadcastToAll('settings:updated', s)
    },
    notifyRemoteClickPending: () => broadcastToAll('character:remote-click-pending', {}),
    notifyRemoteAction: () => broadcastToAll('character:remote-action', {}),
    hideWindowsForRemote: () => hideAllWindowsForRemote(),
    restoreWindowsForRemote: () => restoreAllWindowsAfterRemote(),
    // 設定（B3 階段 4）：與桌面設定視窗共用同一批 `*Direct`
    getLlmSettings: () => getLlmSettingsSummaryDirect(),
    setLlmProvider: (provider) => setLlmProviderDirect(provider),
    setLlmModel: (provider, model) => setLlmModelDirect(provider, model),
    setLlmEndpoint: (endpoint) => setLlmEndpointDirect(endpoint),
    setLlmApiKey: (provider, apiKey) => setLlmApiKeyDirect(provider, apiKey),
    getMemorySettings: () => getMemorySettingsDirect(),
    setMemorySettings: (m) => setMemorySettingsDirect(m),
    listModuleToggles: () => listMobileModuleTogglesDirect(),
    setModuleToggle: (id, enabled) => setMobileModuleEnabledDirect(id, enabled),
    // 提醒 CRUD（B3 階段 4）
    listReminders: () => listRemindersDirect(),
    createReminder: () => createReminderDirect(),
    saveReminder: (reminder) => saveReminderDirect(reminder),
    deleteReminder: (id) => deleteReminderDirect(id),
    toggleReminder: (id, enabled) => toggleReminderDirect(id, enabled)
  })

  // Hook conversation broadcasts → push new messages to mobile clients
  setMobileConversationHook((conv) => {
    const msgs = conv.messages
    // If conversation switched, reset counter without pushing historical messages
    if (conv.id !== mobileLastConvId) {
      mobileLastConvId = conv.id
      mobileLastConvMessageCount = msgs.length
      // 手機端沒有專屬的「換對話」推播型別，借用既有的 desktop-updated 觸發
      // RemoteEventSource 的 state-invalidated → 手機重抓 /api/state，
      // getState 本來就會回目前使用中的對話。之前這裡直接 return，
      // 手機完全不知道電腦換了對話，訊息串會停在切換前那份
      // （owner 2026-08-05 實機回報「桌面切換對話沒有和手機同步」）。
      pushDesktopUpdate(getSettings().ui.desktopCharacters.map(d => d.characterId))
      return
    }
    if (msgs.length > mobileLastConvMessageCount) {
      const newMsgs = msgs.slice(mobileLastConvMessageCount)
      for (const msg of newMsgs) pushMessage(msg)
      mobileLastConvMessageCount = msgs.length
    } else if (msgs.length < mobileLastConvMessageCount) {
      // Messages were deleted / cleared
      mobileLastConvMessageCount = msgs.length
    }
  })

  // Desktop updated → push to mobile
  setMobileMessageListener(null) // not used directly; we use conversation hook

  startMobileServer(port).then(async () => {
    broadcastMobileStatus(getMobileStatus())
    if (s.mobile?.useTunnel !== false) {
      // 若找不到 cloudflared.exe，先自動下載
      if (!isCloudflaredAvailable()) {
        console.log('[MobileServer] cloudflared not found, downloading…')
        broadcastMobileStatus({ ...getMobileStatus(), tunnelStatus: 'downloading' })
        const { downloadCloudflaredIfNeeded } = await import('./cloudflaredManager')
        const ok = await downloadCloudflaredIfNeeded()
        if (!ok) {
          console.warn('[MobileServer] cloudflared download failed, tunnel unavailable')
          broadcastMobileStatus(getMobileStatus())
          return
        }
      }
      void registerStarting()  // 先佔位，讓手機看到等待頁
      void startCloudflared(port).then(() => {
        broadcastMobileStatus(getMobileStatus())
        onUrlReady((url) => {
          registerTunnel(url).then(result => {
            if (!result.ok) console.warn('[Relay] Registration failed:', result.error)
          })
        })
      })
    }
  }).catch(e => console.error('[MobileServer] Failed to start:', e))
}

// ── System tray ───────────────────────────────────────────

function setupTray(appRoot: string) {
  const trayCandidates = ['AppIcon_16x16.png', 'Icon16x16.png', 'icon.png', 'icon.ico'].map(f => path.join(appRoot, 'assets', f))
  let iconPath = trayCandidates.find(p => fs.existsSync(p)) ?? ''

  const icon = iconPath && fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  const tray = new Tray(icon)
  tray.setToolTip('DesktopST')

  const refreshTrayMenu = () => {
    const auxAction = hasDismissedAuxWindows()
      ? { label: '重新開啟所有輔助視窗', click: () => { restoreDismissedAuxWindows(); refreshTrayMenu() } }
      : { label: '收起所有輔助視窗', click: async () => { await dismissAllAuxWindows(); refreshTrayMenu() } }
    const isAlwaysOnTop = getCharactersAlwaysOnTop()
    const scenes = loadScenePresets().sort((a, b) => a.createdAt - b.createdAt)
    const activeSceneId = getSettings().activeSceneId
    const sceneSubmenu = scenes.length === 0
      ? [{ label: '（尚無情境，請在設定→情境中新增）', enabled: false }]
      : scenes.map(s => ({
          label: s.name,
          type: 'checkbox' as const,
          checked: s.id === activeSceneId,
          click: () => { applySceneById(s.id); refreshTrayMenu() }
        }))
    const menu = Menu.buildFromTemplate([
      { label: '開啟輸入視窗', click: () => toggleInputWindow() },
      { label: '📱 到手機上繼續對話', click: () => openQRCodeWindow() },
      { label: '開啟角色庫', click: () => createCharacterLibraryWindow({ mode: 'home' }) },
      { label: '開啟便利貼管理', click: () => openPinnedNotesManager() },
      { label: '管理提醒', click: () => openRemindersManager() },
      { label: '📰 開啟新聞報', click: () => {
        if (!loadNewsModuleSettings().enabled) {
          openSettingsWindow('news')
          return
        }
        createNewsReaderWindow()
      } },
      { label: '切換情境', submenu: sceneSubmenu },
      auxAction,
      { type: 'separator' },
      {
        label: '角色保持在最上層',
        type: 'checkbox',
        checked: isAlwaysOnTop,
        click: () => {
          const next = !getCharactersAlwaysOnTop()
          const s = getSettings()
          s.ui.alwaysOnTop = next
          setCharactersAlwaysOnTop(next)
          saveSettings(s)
          broadcastToAll('settings:updated', s)
          refreshTrayMenu()
        }
      },
      { type: 'separator' },
      { label: '開啟設定', click: () => openSettingsWindow('llm') },
      {
        label: '檢查更新',
        click: () => {
          const s = getSettings()
          void checkForUpdates({
            silent: false,
            dismissedVersion: s.updates?.dismissedVersion
          }).then(result => {
            let changed = false
            if (result.dismissed && result.latestVersion) {
              s.updates = { ...s.updates, dismissedVersion: result.latestVersion }
              changed = true
            }
            if (changed) {
              saveSettings(s)
              broadcastToAll('settings:updated', s)
            }
          })
        }
      },
      {
        label: '新手教學',
        click: () => {
          const guideFile = app.isPackaged
            ? path.join(process.resourcesPath, '../docs/getting-started.html')
            : path.join(app.getAppPath(), 'docs/getting-started.html')
          void shell.openPath(guideFile)
        }
      },
      { type: 'separator' },
      {
        label: '修復角色視窗（重建桌面）',
        click: () => {
          const s = getSettings()
          destroyAllCharacterWindows()
          for (const d of s.ui.desktopCharacters) {
            createCharacterWindow(d.characterId, d.position, d.size)
          }
          broadcastToAll('desktop:updated', s.ui.desktopCharacters)
        }
      },
      { type: 'separator' },
      { label: '結束', click: () => app.quit() }
    ])
    tray.setContextMenu(menu)
  }

  refreshTrayMenu()
  tray.on('click', () => toggleInputWindow())
}
