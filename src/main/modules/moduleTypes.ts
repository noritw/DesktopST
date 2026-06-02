import type { IpcMainInvokeEvent } from 'electron'
import type { MobileRoute, MobileRouteRegistrar } from '../mobileServer'

export type ModuleIpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => unknown

export interface ModuleIpcRegistry {
  handle(channel: string, handler: ModuleIpcHandler): void
}

export interface ModuleMobileRouteRegistry {
  registerRoute: MobileRouteRegistrar
}

export interface ModuleSettingsBridge {
  get<T>(moduleId: string): T | undefined
  set<T>(moduleId: string, value: T): void
}

export interface ModuleHostBridge {
  // Reserved for host services that modules should not import directly.
}

export interface ModuleContext {
  ipc: ModuleIpcRegistry
  mobile: ModuleMobileRouteRegistry
  settings: ModuleSettingsBridge
  host: ModuleHostBridge
}

export interface DesktopSTModule {
  id: string
  name: string
  version: string
  kind: 'built-in'
  riskLevel: 'low' | 'medium' | 'high'
  activate(ctx: ModuleContext): void | Promise<void>
  deactivate?(ctx: ModuleContext): void | Promise<void>
}

export type { MobileRoute }
