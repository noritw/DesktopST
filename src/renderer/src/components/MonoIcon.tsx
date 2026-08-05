/**
 * 單色線條圖示（桌面版入口）。
 *
 * ⚠️ **實作已搬到 `src/shared/MonoIcon.tsx`**，手機版 UI 也 import 同一份
 * （owner 2026-08-06：「Icon 統一成單色、對齊桌面版樣式」）。
 * 這裡保留成一層 re-export，桌面既有的 15 個呼叫端不必改 import 路徑。
 *
 * **要加新圖示請改 `src/shared/MonoIcon.tsx`，不要在這裡加。**
 */
export { default, type MonoIconName } from '@shared/MonoIcon'
