/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        mint: '#CBFBC4',
        teal: '#AAEEDD',
        sky: '#AAEEFF',
        butter: '#FFE8AA',
        blush: '#FFBBBB',
        lavender: '#F0BBFF',
        bg: '#F7FFFC',
        surface: '#FFFFFF',
        border: '#D8F5EC',
        primary: '#3D5A52',
        secondary: '#7BA898'
      },
      borderRadius: {
        panel: '16px',
        'panel-lg': '24px'
      },
      fontFamily: {
        sans: ['Nunito', 'M PLUS Rounded 1c', 'Noto Sans TC', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        soft: '0 2px 8px rgba(170,238,221,0.3)',
        panel: '0 4px 16px rgba(170,238,221,0.25)'
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
