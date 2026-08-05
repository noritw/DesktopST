import type { Config } from 'tailwindcss'

/**
 * 手機 UI 專用的 Tailwind 設定。
 *
 * **與桌面的 `tailwind.config.ts` 分開，是刻意的**：兩者共用一份的話，
 * 手機才用得到的 class 會被掃進桌面的 CSS（反之亦然），而桌面版的
 * 「行為零改動」紀律連 CSS 體積都該守住。
 *
 * 顏色變數沿用 `mobile.html` 的 `--mint` 系列（見 `src/mobile/ui/theme.ts`
 * 的說明），不是桌面那套 `--color-mint`。
 */
const config: Config = {
  content: ['./src/mobile/ui/**/*.{ts,tsx,html}', './src/shared/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mint: 'var(--mint)',
        mint2: 'var(--mint2)',
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'user-bubble': 'var(--user-bubble)',
        text: 'var(--text)',
        'text-sub': 'var(--text-sub)',
        border: 'var(--border)'
      },
      borderRadius: {
        panel: '16px',
        'panel-lg': '24px'
      }
    }
  },
  plugins: []
}

export default config
