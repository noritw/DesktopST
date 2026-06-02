import type { RemoteCapability, RemoteControlSettings } from './types'

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
  const allowedCapabilities = Array.isArray(settings?.allowedCapabilities) && settings.allowedCapabilities.length > 0
    ? settings.allowedCapabilities
    : legacySettingsToCapabilities({
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

  return {
    enabled: typeof settings?.enabled === 'boolean' ? settings.enabled : legacyEnabled,
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
