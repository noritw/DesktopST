import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * 「關於」畫面用的建置身分證，跟 vite.mobile.config.ts（DeST 本體）同一套邏輯：
 * 主角是建置時間，不是版本號——debug APK 重打好幾次版本號也不會變。
 */
function gitShortHash(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: resolve(__dirname, '../..'),
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim()
  } catch {
    return ''
  }
}

const pkgVersion = (
  JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version?: string }
).version ?? '0.0.0'

export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../../src/core'),
      '@shared': resolve(__dirname, '../../src/shared')
    }
  },
  plugins: [react()],
  // 對應的型別宣告在 src/vite-env.d.ts，讀取包裝在 src/buildInfo.ts
  define: {
    __NUTRITION_APP_VERSION__: JSON.stringify(pkgVersion),
    __NUTRITION_GIT_HASH__: JSON.stringify(gitShortHash()),
    __NUTRITION_BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  build: {
    outDir: resolve(__dirname, 'www'),
    emptyOutDir: true,
    target: 'es2020'
  },
  server: {
    host: true,
    port: 5181
  }
})
