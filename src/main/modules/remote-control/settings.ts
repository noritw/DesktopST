import type { RemoteCapability, RemoteControlSettings } from './types'
import { hasModuleSettings, readModuleSettings, writeModuleSettings } from '../moduleSettings'

export const REMOTE_CONTROL_MODULE_ID = 'desktopst.remote-control'

export const INPUT_CONTROL_CAPABILITIES: RemoteCapability[] = [
  'remote.pointer.click',
  'remote.pointer.scroll',
  'remote.keyboard.type',
  'remote.keyboard.hotkey'
]

export const SYSTEM_ACTION_CAPABILITIES: RemoteCapability[] = [
  'remote.monitor.power',
  'remote.system.shutdown',
  'remote.system.restart'
]

export const PROGRAM_CAPABILITIES: RemoteCapability[] = [
  'remote.program.launch',
  'remote.program.close'
]

export const DEFAULT_REMOTE_LOG_RETENTION = {
  maxEntries: 500
}

export function legacySettingsToCapabilities(settings: RemoteControlSettings | undefined): RemoteCapability[] {
  if (!settings) return []
  return [
    ...(settings.enableInputControl ? INPUT_CONTROL_CAPABILITIES : []),
    ...(settings.enableSystemActions ? SYSTEM_ACTION_CAPABILITIES : []),
    ...(settings.registeredPrograms.length ? PROGRAM_CAPABILITIES : [])
  ]
}

export function normalizeRemoteControlSettings(settings: Partial<RemoteControlSettings> | undefined): RemoteControlSettings {
  const registeredPrograms = Array.isArray(settings?.registeredPrograms) ? settings.registeredPrograms : []
  const legacyEnabled = !!settings?.enableInputControl || !!settings?.enableSystemActions || registeredPrograms.length > 0
  const enabled = typeof settings?.enabled === 'boolean' ? settings.enabled : legacyEnabled
  const allowedCapabilities = Array.isArray(settings?.allowedCapabilities) && settings.allowedCapabilities.length > 0
    ? settings.allowedCapabilities
    : (() => {
      const legacyCapabilities = legacySettingsToCapabilities({
        enabled: legacyEnabled,
        allowedCapabilities: [],
        requireConfirmation: [],
        allowedDevices: [],
        restrictToAllowedDevices: false,
        logRetention: DEFAULT_REMOTE_LOG_RETENTION,
        enableInputControl: !!settings?.enableInputControl,
        enableSystemActions: !!settings?.enableSystemActions,
        registeredPrograms
      })
      return legacyCapabilities.length > 0 || !enabled
        ? legacyCapabilities
        : [...INPUT_CONTROL_CAPABILITIES, ...SYSTEM_ACTION_CAPABILITIES]
    })()

  return {
    enabled,
    allowedCapabilities,
    requireConfirmation: Array.isArray(settings?.requireConfirmation) ? settings.requireConfirmation : [],
    allowedDevices: Array.isArray(settings?.allowedDevices) ? settings.allowedDevices : [],
    restrictToAllowedDevices: settings?.restrictToAllowedDevices === true,
    logRetention: {
      ...DEFAULT_REMOTE_LOG_RETENTION,
      ...(settings?.logRetention ?? {})
    },
    enableInputControl: !!settings?.enableInputControl,
    enableSystemActions: !!settings?.enableSystemActions,
    registeredPrograms
  }
}

export function setRemoteControlModuleEnabled(
  settings: Partial<RemoteControlSettings> | undefined,
  enabled: boolean
): RemoteControlSettings {
  const next = normalizeRemoteControlSettings(settings)
  next.enabled = enabled
  next.enableInputControl = enabled
  next.enableSystemActions = enabled

  const allowed = new Set(next.allowedCapabilities)
  for (const capability of [...INPUT_CONTROL_CAPABILITIES, ...SYSTEM_ACTION_CAPABILITIES]) {
    if (enabled) allowed.add(capability)
    else allowed.delete(capability)
  }
  if (!enabled) {
    for (const capability of PROGRAM_CAPABILITIES) allowed.delete(capability)
  } else if (next.registeredPrograms.length > 0) {
    for (const capability of PROGRAM_CAPABILITIES) allowed.add(capability)
  }
  next.allowedCapabilities = [...allowed]
  return next
}

export function hasRemoteControlModuleSettings(): boolean {
  return hasModuleSettings(REMOTE_CONTROL_MODULE_ID)
}

export function loadRemoteControlModuleSettings(): RemoteControlSettings | undefined {
  const settings = readModuleSettings<Partial<RemoteControlSettings>>(REMOTE_CONTROL_MODULE_ID)
  return settings ? normalizeRemoteControlSettings(settings) : undefined
}

export function saveRemoteControlModuleSettings(settings: Partial<RemoteControlSettings>): RemoteControlSettings {
  const normalized = normalizeRemoteControlSettings(settings)
  writeModuleSettings(REMOTE_CONTROL_MODULE_ID, normalized)
  return normalized
}

export function isCapabilityAllowed(
  settings: RemoteControlSettings | undefined,
  capability: RemoteCapability
): boolean {
  const normalized = normalizeRemoteControlSettings(settings)
  return normalized.enabled && normalized.allowedCapabilities.includes(capability)
}

export function isDeviceAllowed(settings: RemoteControlSettings | undefined, deviceId: string): boolean {
  const normalized = normalizeRemoteControlSettings(settings)
  if (!normalized.restrictToAllowedDevices) return true
  if (normalized.allowedDevices.length === 0) return true
  if (!deviceId) return false
  return normalized.allowedDevices.some(device => device.id === deviceId)
}

export function getRemoteControlClientState(settings: RemoteControlSettings | undefined): {
  enabled: boolean
  allowedCapabilities: RemoteCapability[]
  requireConfirmation: RemoteCapability[]
  restrictToAllowedDevices: boolean
  currentDeviceAllowed?: boolean
  deviceRestrictionActive: boolean
} {
  const normalized = normalizeRemoteControlSettings(settings)
  return {
    enabled: normalized.enabled,
    allowedCapabilities: normalized.allowedCapabilities,
    requireConfirmation: normalized.requireConfirmation,
    restrictToAllowedDevices: normalized.restrictToAllowedDevices,
    deviceRestrictionActive: normalized.restrictToAllowedDevices && normalized.allowedDevices.length > 0
  }
}

export function getRemoteControlClientStateForDevice(
  settings: RemoteControlSettings | undefined,
  deviceId: string
): ReturnType<typeof getRemoteControlClientState> {
  return {
    ...getRemoteControlClientState(settings),
    currentDeviceAllowed: isDeviceAllowed(settings, deviceId)
  }
}
