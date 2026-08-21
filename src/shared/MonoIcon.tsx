/**
 * 單色線條圖示 —— **桌面版與手機版共用的唯一一份**。
 *
 * 原本只住在 `src/renderer/src/components/MonoIcon.tsx`（桌面版），
 * 手機版則到處散落 emoji（💬📰👥🗂️🎨⚙️⋯⋯）。owner 2026-08-06 回報
 * 「Icon 花花綠綠很醜，能統一成單色的、對齊桌面版樣式嗎」——
 * 與其在手機再抄一份 SVG（那就是 roadmap §4.1 的 drift），
 * 直接把實作搬到這裡，兩邊都 import 同一個檔案。
 *
 * `src/renderer/src/components/MonoIcon.tsx` 現在只是一層 re-export，
 * 桌面既有的 15 個呼叫端一行都不用改。
 *
 * ## 為什麼放 `src/shared/` 而不是 `src/core/`
 *
 * `core/` 是純資料與邏輯層，`main/`（Node）也會 import 它，
 * 因此不得依賴 React 或任何 UI 框架。這支是 React 元件，放進去會破壞那條界線。
 * `src/shared/` 專收「兩個 UI 都要用、但不屬於 core」的純呈現元件。
 *
 * ## 樣式約定
 *
 * 一律 `viewBox="0 0 24 24"`、`stroke="currentColor"`、`fill="none"`、`strokeWidth=2`。
 * **顏色由呼叫端用 CSS 的 `color` 決定**（`currentColor`），
 * 所以同一顆圖示在薄荷綠 header 與深色主題下都會自動對比正確 ——
 * 這正是 emoji 做不到、而 owner 覺得「花花綠綠」的原因。
 */

export type MonoIconName =
  // ── 桌面版原有 ──
  | 'close'
  | 'check'
  | 'edit'
  | 'trash'
  | 'prompt'
  | 'log'
  | 'image'
  | 'camera'
  | 'mic'
  | 'chart'
  | 'send'
  | 'stop'
  | 'resend'
  | 'save'
  | 'download'
  | 'qr'
  | 'folder'
  | 'settings'
  | 'user'
  | 'import'
  | 'screenshot'
  | 'screenshot-character'
  | 'notes'
  | 'pin'
  | 'copy'
  | 'alarm'
  | 'bell'
  | 'more-chat'
  | 'react'
  | 'eye'
  | 'eye-off'
  // ── B3 手機版新增（桌面日後也可用）──
  | 'menu'
  | 'chat'
  | 'news'
  | 'users'
  | 'palette'
  | 'dice'
  | 'paw'
  | 'plus'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'book'
  | 'volume'
  | 'mute'
  | 'exit'
  | 'plug'
  | 'at'
  // ── B3 階段 6（個人新聞報）新增 ──
  | 'refresh'
  | 'external-link'
  | 'arrow-up'
  | 'arrow-down'
  | 'sliders'
  | 'more'
  // ── B6（遙控面板）新增 ──
  | 'monitor'
  | 'power'
  | 'keyboard'
  | 'lock'
  | 'cursor'

export default function MonoIcon({ name, className = 'w-4 h-4' }: { name: MonoIconName; className?: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} pointer-events-none`.trim()}>
      {name === 'check' && (
        <path {...common} d="M4 13l5 5L20 7" />
      )}
      {name === 'react' && (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="M8.5 13.5a4.5 4.5 0 0 0 7 0" />
          <path {...common} d="M9 9.5h.01" />
          <path {...common} d="M15 9.5h.01" />
        </>
      )}
      {name === 'eye' && (
        <>
          <path {...common} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle {...common} cx="12" cy="12" r="3" />
        </>
      )}
      {name === 'eye-off' && (
        <>
          <path {...common} d="M4 4l16 16" />
          <path {...common} d="M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3.2 3.9" />
          <path {...common} d="M6.2 6.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 3.5-.7" />
          <path {...common} d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
        </>
      )}
      {name === 'close' && (
        <>
          <path {...common} d="M6 6l12 12" />
          <path {...common} d="M18 6L6 18" />
        </>
      )}
      {name === 'edit' && (
        <>
          <path {...common} d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
          <path {...common} d="M13.5 7.5l3 3" />
        </>
      )}
      {name === 'trash' && (
        <>
          <path {...common} d="M5 7h14" />
          <path {...common} d="M9 7V5h6v2" />
          <path {...common} d="M8 10v8" />
          <path {...common} d="M12 10v8" />
          <path {...common} d="M16 10v8" />
          <path {...common} d="M7 7l1 14h8l1-14" />
        </>
      )}
      {name === 'prompt' && (
        <>
          <path {...common} d="M8 9l-4 3 4 3" />
          <path {...common} d="M16 9l4 3-4 3" />
          <path {...common} d="M14 5l-4 14" />
        </>
      )}
      {name === 'log' && (
        <>
          <path {...common} d="M7 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
          <path {...common} d="M8 8h8" />
          <path {...common} d="M8 12h8" />
          <path {...common} d="M8 16h5" />
        </>
      )}
      {name === 'image' && (
        <>
          <rect {...common} x="4" y="5" width="16" height="14" rx="2" />
          <path {...common} d="M8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          <path {...common} d="M20 16l-5-5-4 4-2-2-5 5" />
        </>
      )}
      {name === 'camera' && (
        <>
          <path {...common} d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
          <circle {...common} cx="12" cy="13.5" r="3.5" />
        </>
      )}
      {name === 'mic' && (
        <>
          <rect {...common} x="9" y="3" width="6" height="11" rx="3" />
          <path {...common} d="M5.5 11a6.5 6.5 0 0 0 13 0" />
          <path {...common} d="M12 17.5V21" />
          <path {...common} d="M8.5 21h7" />
        </>
      )}
      {name === 'chart' && (
        <>
          <path {...common} d="M4 20V4" />
          <path {...common} d="M4 20h16" />
          <path {...common} d="M8 17v-5" />
          <path {...common} d="M13 17V7" />
          <path {...common} d="M18 17v-8" />
        </>
      )}
      {name === 'send' && (
        <>
          <path {...common} d="M4 12l16-8-5 16-3-7-8-1Z" />
          <path {...common} d="M12 13l8-9" />
        </>
      )}
      {name === 'stop' && (
        <rect {...common} x="6" y="6" width="12" height="12" rx="2" />
      )}
      {name === 'resend' && (
        <>
          <path {...common} d="M4 12a8 8 0 0 1 13.66-5.66L20 8" />
          <path {...common} d="M20 4v4h-4" />
          <path {...common} d="M20 12a8 8 0 0 1-13.66 5.66L4 16" />
          <path {...common} d="M4 20v-4h4" />
        </>
      )}
      {name === 'save' && (
        <>
          <path {...common} d="M5 4h12l2 2v14H5V4Z" />
          <path {...common} d="M8 4v6h8V4" />
          <path {...common} d="M8 20v-6h8v6" />
        </>
      )}
      {name === 'download' && (
        <>
          <path {...common} d="M12 3v11" />
          <path {...common} d="M7 10l5 5 5-5" />
          <path {...common} d="M5 18v2h14v-2" />
        </>
      )}
      {name === 'qr' && (
        <>
          <path {...common} d="M4 4h6v6H4z" />
          <path {...common} d="M14 4h6v6h-6z" />
          <path {...common} d="M4 14h6v6H4z" />
          <path {...common} d="M14 14h2v2h-2z" />
          <path {...common} d="M18 14h2v2h-2z" />
          <path {...common} d="M14 18h2v2h-2z" />
          <path {...common} d="M18 18h2v2h-2z" />
        </>
      )}
      {name === 'folder' && (
        <>
          <path {...common} d="M4 7h6l2 2h8v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z" />
          <path {...common} d="M4 7V6a2 2 0 0 1 2-2h4l2 3" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path {...common} d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <path {...common} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </>
      )}
      {name === 'user' && (
        <>
          <path {...common} d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
          <path {...common} d="M4 21a8 8 0 0 1 16 0" />
        </>
      )}
      {name === 'import' && (
        <>
          <path {...common} d="M12 3v10" />
          <path {...common} d="M8 9l4 4 4-4" />
          <path {...common} d="M5 17v3h14v-3" />
        </>
      )}
      {name === 'screenshot' && (
        <>
          <path {...common} d="M5 10V5h5" />
          <path {...common} d="M14 5h5v5" />
          <path {...common} d="M5 14v5h5" />
          <path {...common} d="M19 14v5h-5" />
          <circle {...common} cx="12" cy="12" r="2.5" />
        </>
      )}
      {name === 'screenshot-character' && (
        <>
          <path {...common} d="M5 10V5h5" />
          <path {...common} d="M14 5h5v5" />
          <path {...common} d="M5 14v5h5" />
          <path {...common} d="M19 14v5h-5" />
          <circle {...common} cx="12" cy="10.5" r="2" />
          <path {...common} d="M8.5 17c.9-2 2.2-3 3.5-3s2.6 1 3.5 3" />
        </>
      )}
      {name === 'notes' && (
        <>
          <rect {...common} x="8" y="6" width="10" height="12" rx="2" />
          <path {...common} d="M5 9v8a2 2 0 0 0 2 2h8" />
          <path {...common} d="M10 6l1.4-2h3.2L16 6" />
        </>
      )}
      {name === 'copy' && (
        <>
          <rect {...common} x="9" y="9" width="11" height="11" rx="2" />
          <path {...common} d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )}
      {name === 'pin' && (
        <>
          {/* 圖釘針身 */}
          <line {...common} x1="12" y1="12" x2="6" y2="20" />
          {/* 圖釘頭（圓形） */}
          <circle {...common} cx="15" cy="9" r="4" />
          {/* 限位桿 */}
          <line {...common} x1="12" y1="12" x2="18" y2="6" />
        </>
      )}
      {name === 'alarm' && (
        <>
          {/* 鐘身 */}
          <circle {...common} cx="12" cy="13" r="7" />
          {/* 左角 */}
          <path {...common} d="M6.5 8l-1.5-2" />
          {/* 左錘（半圓，逆時針旋轉） */}
          <ellipse {...common} cx="4.5" cy="4.5" rx="1.8" ry="0.6" transform="rotate(-30 4.5 4.5)" />
          {/* 右角 */}
          <path {...common} d="M17.5 8l1.5-2" />
          {/* 右錘（半圓，順時針旋轉） */}
          <ellipse {...common} cx="19.5" cy="4.5" rx="1.8" ry="0.6" transform="rotate(30 19.5 4.5)" />
          {/* 指針 */}
          <path {...common} d="M12 10v3l2 1" />
          {/* 左腳 */}
          <path {...common} d="M7 20v2" />
          {/* 右腳 */}
          <path {...common} d="M17 20v2" />
        </>
      )}
      {name === 'bell' && (
        <>
          <path {...common} d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path {...common} d="M13.73 21a2 2 0 0 1-3.46 0" />
        </>
      )}
      {name === 'more-chat' && (
        <>
          <path {...common} d="M4 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V4Z" />
          <circle cx="8.5" cy="9" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="9" r="1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="9" r="1" fill="currentColor" stroke="none" />
        </>
      )}

      {/* ── B3 手機版新增 ─────────────────────────────── */}
      {name === 'menu' && (
        <>
          <path {...common} d="M4 7h16" />
          <path {...common} d="M4 12h16" />
          <path {...common} d="M4 17h16" />
        </>
      )}
      {name === 'chat' && (
        <path {...common} d="M20 12a8 8 0 0 1-8 8H4l2.3-2.3A8 8 0 1 1 20 12Z" />
      )}
      {name === 'news' && (
        <>
          <path {...common} d="M4 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v12a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2V6Z" />
          <path {...common} d="M17 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2" />
          <path {...common} d="M7.5 8h6" />
          <path {...common} d="M7.5 12h6" />
          <path {...common} d="M7.5 16h4" />
        </>
      )}
      {name === 'users' && (
        <>
          <circle {...common} cx="9" cy="8" r="3.5" />
          <path {...common} d="M2.5 20a6.5 6.5 0 0 1 13 0" />
          <path {...common} d="M16 5.2a3.5 3.5 0 0 1 0 6.6" />
          <path {...common} d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
        </>
      )}
      {name === 'palette' && (
        <>
          <path {...common} d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.2H18a3 3 0 0 0 3-3c0-4.6-4-8.6-9-8.6Z" />
          <circle cx="7.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="9.8" cy="7.8" r="1.15" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="7.2" r="1.15" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'dice' && (
        <>
          <rect {...common} x="4" y="4" width="16" height="16" rx="3" />
          <circle cx="8.8" cy="8.8" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15.2" cy="15.2" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
      {name === 'paw' && (
        <>
          <ellipse {...common} cx="6.4" cy="11" rx="1.9" ry="2.4" />
          <ellipse {...common} cx="17.6" cy="11" rx="1.9" ry="2.4" />
          <ellipse {...common} cx="9.9" cy="6.6" rx="1.9" ry="2.5" />
          <ellipse {...common} cx="14.1" cy="6.6" rx="1.9" ry="2.5" />
          <path {...common} d="M12 13.2c3 0 5 2 5 4.1 0 1.7-1.5 2.9-3.2 2.6-1.2-.2-1.6-.4-1.8-.4s-.6.2-1.8.4c-1.7.3-3.2-.9-3.2-2.6 0-2.1 2-4.1 5-4.1Z" />
        </>
      )}
      {name === 'plus' && (
        <>
          <path {...common} d="M12 5v14" />
          <path {...common} d="M5 12h14" />
        </>
      )}
      {name === 'chevron-left' && (
        <path {...common} d="M15 5l-7 7 7 7" />
      )}
      {name === 'chevron-right' && (
        <path {...common} d="M9 5l7 7-7 7" />
      )}
      {name === 'chevron-down' && (
        <path {...common} d="M5 9l7 7 7-7" />
      )}
      {name === 'book' && (
        <>
          <path {...common} d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z" />
          <path {...common} d="M20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5V5.5Z" />
        </>
      )}
      {name === 'volume' && (
        <>
          <path {...common} d="M4 9.5h3.2L12 5.5v13l-4.8-4H4v-5Z" />
          <path {...common} d="M15.5 9a4 4 0 0 1 0 6" />
          <path {...common} d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
      {name === 'mute' && (
        <>
          <path {...common} d="M4 9.5h3.2L12 5.5v13l-4.8-4H4v-5Z" />
          <path {...common} d="M16 10l4 4" />
          <path {...common} d="M20 10l-4 4" />
        </>
      )}
      {name === 'exit' && (
        <>
          <path {...common} d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
          <path {...common} d="M10 8l-4 4 4 4" />
          <path {...common} d="M6 12h9" />
        </>
      )}
      {name === 'plug' && (
        <>
          <path {...common} d="M3 3l18 18" />
          <path {...common} d="M9.5 5.5V3" />
          <path {...common} d="M14.5 6V3" />
          <path {...common} d="M7 8h10v3a5 5 0 0 1-5 5" />
          <path {...common} d="M12 16v5" />
        </>
      )}
      {name === 'at' && (
        <>
          <circle {...common} cx="12" cy="12" r="3.6" />
          <path {...common} d="M15.6 8.4v4.8a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.4 6.95" />
        </>
      )}
      {name === 'refresh' && (
        <>
          <path {...common} d="M20 11a8 8 0 0 0-13.7-5.2L4 8" />
          <path {...common} d="M4 4v4h4" />
          <path {...common} d="M4 13a8 8 0 0 0 13.7 5.2L20 16" />
          <path {...common} d="M20 20v-4h-4" />
        </>
      )}
      {name === 'external-link' && (
        <>
          <path {...common} d="M14 4h6v6" />
          <path {...common} d="M20 4l-8.5 8.5" />
          <path {...common} d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </>
      )}
      {name === 'arrow-up' && (
        <>
          <path {...common} d="M12 20V5" />
          <path {...common} d="M6 11l6-6 6 6" />
        </>
      )}
      {name === 'arrow-down' && (
        <>
          <path {...common} d="M12 4v15" />
          <path {...common} d="M6 13l6 6 6-6" />
        </>
      )}
      {name === 'sliders' && (
        <>
          <path {...common} d="M4 7h10" />
          <path {...common} d="M18 7h2" />
          <circle {...common} cx="16" cy="7" r="2" />
          <path {...common} d="M4 17h4" />
          <path {...common} d="M12 17h8" />
          <circle {...common} cx="10" cy="17" r="2" />
        </>
      )}
      {name === 'more' && (
        <>
          <circle {...common} cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle {...common} cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle {...common} cx="19" cy="12" r="1.5" fill="currentColor" />
        </>
      )}

      {/* ── B6（遙控面板）新增 ─────────────────────────── */}
      {name === 'monitor' && (
        <>
          <rect {...common} x="3" y="4" width="18" height="12" rx="2" />
          <path {...common} d="M8 20h8" />
          <path {...common} d="M12 16v4" />
        </>
      )}
      {name === 'power' && (
        <>
          <path {...common} d="M12 3v8" />
          <path {...common} d="M7 6a7 7 0 1 0 10 0" />
        </>
      )}
      {name === 'keyboard' && (
        <>
          <rect {...common} x="3" y="6" width="18" height="12" rx="2" />
          <path {...common} d="M6.5 10h.01" />
          <path {...common} d="M9.5 10h.01" />
          <path {...common} d="M12.5 10h.01" />
          <path {...common} d="M15.5 10h.01" />
          <path {...common} d="M17.5 10h.01" />
          <path {...common} d="M7 14h10" />
        </>
      )}
      {name === 'lock' && (
        <>
          <rect {...common} x="5" y="10" width="14" height="10" rx="2" />
          <path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" />
        </>
      )}
      {name === 'cursor' && (
        <path {...common} d="M5 3l6.5 16 2-6.7L20 10.5 5 3Z" />
      )}
    </svg>
  )
}
