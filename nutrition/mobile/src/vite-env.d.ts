/// <reference types="vite/client" />

/**
 * `vite.config.ts` 的 `define` 在建置時寫死進 bundle 的常數。
 *
 * 不要直接在元件裡用這些名字 —— 走 `src/buildInfo.ts`，那裡處理了格式化與異常值。
 */
declare const __NUTRITION_APP_VERSION__: string
declare const __NUTRITION_GIT_HASH__: string
declare const __NUTRITION_BUILD_TIME__: string
