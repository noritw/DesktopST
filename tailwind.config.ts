import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        // 主題色：全部透過 CSS 變數動態套用
        mint:             'var(--color-mint)',
        teal:             'var(--color-teal)',
        bg:               'var(--color-bg)',
        surface:          'var(--color-surface)',
        border:           'var(--color-border)',
        primary:          'var(--color-text-primary)',
        secondary:        'var(--color-text-secondary)',
        user:             'var(--color-text-user)',
        danger:           'var(--color-danger)',
        'danger-soft':    'var(--color-danger-soft)',
        'danger-border':  'var(--color-danger-border)',
        // 固定色
        sky:              'var(--color-sky-fixed)',
        // 半透明變體（用 color-mix 定義於 CSS，不依賴 Tailwind opacity modifier）
        'mint-10':        'var(--color-mint-10)',
        'mint-20':        'var(--color-mint-20)',
        'mint-30':        'var(--color-mint-30)',
        'mint-40':        'var(--color-mint-40)',
        'mint-55':        'var(--color-mint-55)',
        'mint-80':        'var(--color-mint-80)',
        'teal-20':        'var(--color-teal-20)',
        'teal-25':        'var(--color-teal-25)',
        'teal-30':        'var(--color-teal-30)',
        'teal-40':        'var(--color-teal-40)',
        'teal-80':        'var(--color-teal-80)',
        'surface-45':     'var(--color-surface-45)',
        'surface-60':     'var(--color-surface-60)',
        'surface-80':     'var(--color-surface-80)',
        'surface-85':     'var(--color-surface-85)',
        'surface-90':     'var(--color-surface-90)',
        'surface-95':     'var(--color-surface-95)',
        'danger-soft-80': 'var(--color-danger-soft-80)',
        'border-60':      'var(--color-border-60)',
      },
      borderRadius: {
        panel: '16px',
        'panel-lg': '24px'
      },
      fontFamily: {
        sans: ['Segoe UI Variable Display', 'system-ui', 'Microsoft JhengHei UI', 'Microsoft JhengHei', 'sans-serif']
      },
      boxShadow: {
        soft: '0 3px 12px rgba(61,90,82,0.18)',
        panel: '0 6px 20px rgba(61,90,82,0.2)'
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'fade-out': 'fadeOut 0.3s ease-in-out',
        'bubble-in': 'bubbleIn 0.25s ease-out'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' }
        },
        bubbleIn: {
          '0%': { opacity: '0', transform: 'translateY(6px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' }
        }
      }
    }
  },
  plugins: []
}

export default config
