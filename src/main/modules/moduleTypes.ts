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

export type ModuleContextProvider = () => string | null | Promise<string | null>

export interface ModuleHostBridge {
  // Reserved for host services that modules should not import directly.
  requestCharacterSpeak?(
    characterId: string,
    opts?: { extraSystemContext?: string; triggerDirective?: string }
  ): Promise<{ ok: true } | { error: string }>
  getDesktopCharacters?(): Array<{ id: string; name: string; muted: boolean }>
  /** 登錄一個 context provider：每次對話組裝 prompt 前都會呼叫，回傳的字串會注入 system context。 */
  registerContextProvider?(provider: ModuleContextProvider): void
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
  kind: 'built-in' | 'external'
  riskLevel: 'low' | 'medium' | 'high'
  activate(ctx: ModuleContext): void | Promise<void>
  deactivate?(ctx: ModuleContext): void | Promise<void>
}

export type { MobileRoute }
