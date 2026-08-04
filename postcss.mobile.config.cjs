// 手機 UI 專用（見 tailwind.mobile.config.ts 的說明：與桌面分開，避免互相污染 CSS）
module.exports = {
  plugins: {
    tailwindcss: { config: './tailwind.mobile.config.ts' },
    autoprefixer: {}
  }
}
