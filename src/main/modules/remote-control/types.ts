import type {
  RemoteCapability as LegacyRemoteCapability,
  RegisteredRemoteDevice as LegacyRegisteredRemoteDevice,
  RegisteredProgram as LegacyRegisteredProgram,
  RemoteControlSettings as LegacyRemoteControlSettings
} from '../../types'

export type RemoteCapability = LegacyRemoteCapability
export type RegisteredRemoteDevice = LegacyRegisteredRemoteDevice
export type RegisteredProgram = LegacyRegisteredProgram
export type RemoteControlSettings = LegacyRemoteControlSettings

export interface RemoteControlModuleSettings {
  enabled: boolean
  allowedCapabilities: RemoteCapability[]
  requireConfirmation: RemoteCapability[]
  registeredPrograms: RegisteredProgram[]
  allowedDevices: RegisteredRemoteDevice[]
  restrictToAllowedDevices: boolean
  logRetention: {
    maxEntries: number
    keepDays?: number
  }
}
