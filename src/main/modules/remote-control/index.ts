export * from './actions'
export * from './ipc'
export * from './logStore'
export * from './routes'
export * from './settings'
export * from './types'

import type { DesktopSTModule } from '../moduleTypes'
import { registerRemoteControlIpcHandlers } from './ipc'
import { registerRemoteControlRoutes } from './routes'
import { REMOTE_CONTROL_MODULE_ID } from './settings'

export const remoteControlModule: DesktopSTModule = {
  id: REMOTE_CONTROL_MODULE_ID,
  name: 'Remote Control',
  version: '1.0.0',
  kind: 'built-in',
  riskLevel: 'high',
  activate(ctx) {
    registerRemoteControlRoutes(ctx.mobile.registerRoute)
    registerRemoteControlIpcHandlers(ctx.ipc)
  }
}
