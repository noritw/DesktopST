/**
 * 薄殼：連結閱讀本體在 `core/link/`（桌面與手機獨立版共用同一份，
 * 2026-09-13）。桌面固定綁 `electronHttp`，呼叫端不必知道 deps 長什麼樣。
 */
import * as core from '../core/link'
import { electronHttp } from './adapters/httpAdapter'
import type { AppSettings } from './types'

export type { LinkContextResult, LinkFetchOutcome } from '../core/link'
export { LINK_READER_MODULE_ID } from '../core/link'

const deps = { http: electronHttp }

export function getLinkContext(
  userMessage: string,
  settings: AppSettings,
  enabledOverride?: boolean
): Promise<core.LinkContextResult> {
  return core.getLinkContext(deps, userMessage, settings, enabledOverride)
}
