export * from './types'
export * from './settings'
export * from './sources'
export * from './filter'
export * from './trigger'
export * from './topicState'
export * from './readerPack'
export * from './ipc'

import type { DesktopSTModule } from '../moduleTypes'
import { registerNewsIpcHandlers } from './ipc'
import { NEWS_MODULE_ID } from './settings'

export const newsModule: DesktopSTModule = {
  id: NEWS_MODULE_ID,
  name: 'News Companion',
  version: '1.0.0',
  kind: 'built-in',
  riskLevel: 'medium',
  activate(ctx) {
    // 設定相關 IPC 一律註冊（需可隨時開關模組）；
    // 實際的抓取 / 注入行為在 forceSpeakDirect 內依 settings.enabled 把關，
    // 停用時不發任何網路請求、不注入任何新聞素材。
    registerNewsIpcHandlers(ctx.ipc)
  }
}
