import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'

/**
 * 「關於」畫面用的建置身分證，跟 vite.mobile.config.ts 同一套邏輯：
 * 主角是建置時間，不是版本號——桌面版重打好幾次 package.json 版本號也不會變，
 * 只有建置時間答得出「我到底重打了沒」。
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
  main: {
    resolve: {
      alias: {
        '@core': resolve(__dirname, '../../src/core')
      }
    },
    build: {
      outDir: resolve(__dirname, 'out/main'),
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') }
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      outDir: resolve(__dirname, 'out/preload'),
      rollupOptions: { input: resolve(__dirname, 'src/main/preload.ts') }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@core': resolve(__dirname, '../../src/core'),
        '@shared': resolve(__dirname, '../../src/shared')
      }
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
    },
    // 對應的型別宣告在 src/renderer/vite-env.d.ts，讀取包裝在 src/renderer/src/buildInfo.ts
    define: {
      __NUTRITION_APP_VERSION__: JSON.stringify(pkgVersion),
      __NUTRITION_GIT_HASH__: JSON.stringify(gitShortHash()),
      __NUTRITION_BUILD_TIME__: JSON.stringify(new Date().toISOString())
    },
    css: { postcss: { plugins: [] } },
    plugins: [react()]
  }
})
