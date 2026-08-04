/**
 * Lorebook（用語解說）core —— B2.5。
 *
 * 純函式、零 I/O。檔案讀寫由平台層負責（`core/store/keys.ts` 的 `lorebookKey`），
 * core 只收「已經讀好的 `Lorebook[]`」。規格：`docs/future-lorebook.md`。
 */

export * from './types'
export * from './scan'
export * from './format'
export * from './resolve'
export * from './normalize'
export * from './stLorebook'
