import type { PluginListenerHandle } from '@capacitor/core'

/**
 * 語音輸入（補充說明欄用）。
 *
 * 為什麼不用 Web Speech API：Android 的 WebView **沒有**綁定系統語音服務，
 * `webkitSpeechRecognition` 在 APK 裡不是不存在就是一啟動就 `network` 錯誤
 * （Chrome 瀏覽器可以，WebView 不行）——所以走原生外掛
 * `@capacitor-community/speech-recognition`（它自己的 AndroidManifest 已帶
 * `RECORD_AUDIO` 與 `RecognitionService` 的 `<queries>`，不必手動合併，
 * 與 CLAUDE.md §5「權限不見得會自動合併」那條的 geolocation 情況不同）。
 *
 * ⚠️ 外掛一律**動態 `import()`**：瀏覽器預覽（`dev:nutrition:mobile`）與
 * vitest 沒有原生層，靜態 import 會在載入模組時就炸。
 */

export interface VoiceSession {
  /** 停止聆聽並回傳最終文字（可能為空字串）。重複呼叫安全。 */
  stop(): Promise<string>
}

async function loadPlugin() {
  const mod = await import('@capacitor-community/speech-recognition')
  // ⚠️ 不可以直接 `return mod.SpeechRecognition`：plugin proxy 把任何屬性存取都當成
  // 原生方法呼叫，JS 會去摸 `.then` 判斷 thenable，於是變成呼叫原生的
  // `SpeechRecognition.then()`，永遠不 settle（CLAUDE.md §5 有同一個坑）。
  return { plugin: mod.SpeechRecognition }
}

/** 這台裝置有沒有語音辨識可用（沒有就不要畫出麥克風按鈕）。 */
export async function isVoiceInputAvailable(): Promise<boolean> {
  try {
    const { plugin } = await loadPlugin()
    const result = await plugin.available()
    return result.available === true
  } catch {
    return false
  }
}

/**
 * 開始聆聽。`onPartial` 會隨著使用者講話一直更新（讓畫面看得出有在收音），
 * 最終文字以 `stop()` 的回傳值為準。
 *
 * 語言固定 `zh-TW`：這個 App 的文案與使用者都是繁中，讓使用者多選一次語言
 * 違反「不打字、少一步」的原則；要講英文品名時辨識器本來就吃得下夾雜英文。
 */
export async function startVoiceInput(onPartial: (text: string) => void): Promise<VoiceSession> {
  const { plugin } = await loadPlugin()

  const permission = await plugin.checkPermissions()
  if (permission.speechRecognition !== 'granted') {
    const requested = await plugin.requestPermissions()
    if (requested.speechRecognition !== 'granted') {
      throw new Error('沒有麥克風權限，無法語音輸入')
    }
  }

  let latest = ''
  let listener: PluginListenerHandle | null = await plugin.addListener('partialResults', (data: { matches?: string[] }) => {
    const text = data.matches?.[0]
    if (typeof text === 'string') {
      latest = text
      onPartial(text)
    }
  })

  // partialResults: true 時 start() 會立刻 resolve，文字全部從 listener 來；
  // popup: false 才不會跳出系統的全螢幕語音對話框（跳出來就看不到自己的畫面了）。
  await plugin.start({ language: 'zh-TW', partialResults: true, popup: false })

  let stopped = false
  return {
    async stop(): Promise<string> {
      if (stopped) return latest
      stopped = true
      try {
        await plugin.stop()
      } catch {
        // 已經自己停了（使用者講完停頓，辨識器會自動結束）——不是錯誤。
      }
      await listener?.remove()
      listener = null
      return latest
    }
  }
}
