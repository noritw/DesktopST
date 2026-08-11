import type { HttpAdapter, PlatformAdapters, SecretAdapter, StorageAdapter } from '../../core/adapters'
import { base64ToBytes, bytesToBase64 } from '../../core/util/base64'
import { createSecretAdapterFromKey, unavailableSecrets } from '../adapters/secretCrypto'
import { capacitorScheduler } from '../adapters/schedulerAdapter'
import { capacitorNotifier } from '../adapters/notifierAdapter'
import { assertValidStorageKey, cleanPrefix } from '../adapters/storageKey'
import { getHeadlessBridge, hlog, type HeadlessNativeBridge } from './bridge'

/**
 * headless WebView 用的 `PlatformAdapters`。
 *
 * headless 沒有 Capacitor Bridge，拿不到 Filesystem／SecureStorage／CapacitorHttp，
 * 所以這裡改用 `HeadlessBridge.java` 注入的原生介面補回同樣的能力。
 * **形狀與前景那組完全一致**——這正是 `reminderSpeak.ts`／`chat.ts`
 * 一行都不用改就能在背景跑的原因（計畫書 §2.1「TS 邏輯零重寫」）。
 *
 * 檔案根目錄是 `context.getFilesDir()`，與前景 `@capacitor/filesystem` 的
 * `Directory.Data` 是同一個目錄；不一致的話這裡會讀到一個空資料夾。
 */

function headlessStorage(bridge: HeadlessNativeBridge): StorageAdapter {
  return {
    async readJson<T>(key: string): Promise<T | null> {
      const raw = bridge.readFile(assertValidStorageKey(key))
      if (raw == null) return null
      try {
        return JSON.parse(raw) as T
      } catch {
        return null
      }
    },

    async writeJson(key: string, value: unknown): Promise<void> {
      bridge.writeFile(assertValidStorageKey(key), JSON.stringify(value, null, 2))
    },

    async readBinary(key: string): Promise<Uint8Array | null> {
      const b64 = bridge.readFileBase64(assertValidStorageKey(key))
      return b64 == null ? null : base64ToBytes(b64)
    },

    async writeBinary(key: string, data: Uint8Array): Promise<void> {
      /*
       * headless 這條路徑不寫圖檔（提醒只產生文字），
       * 但介面要求要有——寫成 base64 交給原生，語意與前景一致。
       */
      bridge.writeFile(assertValidStorageKey(key), bytesToBase64(data))
    },

    async exists(key: string): Promise<boolean> {
      return bridge.exists(assertValidStorageKey(key))
    },

    async remove(): Promise<void> {
      // headless 不刪東西。背景跑的程式碼不該有機會清掉使用者資料。
      hlog('storage.remove 在 headless 被呼叫，已忽略')
    },

    async list(prefix: string): Promise<string[]> {
      const clean = cleanPrefix(prefix)
      try {
        const names = JSON.parse(bridge.listDir(clean)) as string[]
        return names.map((n) => (clean ? `${clean}/${n}` : n)).sort()
      } catch {
        return []
      }
    }
  }
}

/**
 * 原生 HTTP。
 *
 * 為什麼不直接用 WebView 的 `fetch`：headless 載的是 `file://`，origin 是 null，
 * 打 LLM API 一定被 CORS 擋——這也正是前景要 CapacitorHttp 的原因。
 *
 * ⚠️ 逾時要走 `signal`（與 `httpAdapter.ts` 同一條規矩）。
 * 原生請求送出去之後我們只是「不再等它」，不是真的取消。
 */
function headlessHttp(bridge: HeadlessNativeBridge): HttpAdapter {
  let seq = 0
  const pending = new Map<string, (json: string) => void>()

  if (typeof window !== 'undefined') {
    window.__destHeadlessHttp = (callbackId, responseJson) => {
      const resolve = pending.get(callbackId)
      if (resolve) {
        pending.delete(callbackId)
        resolve(responseJson)
      }
    }
  }

  const doFetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init)
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.text()
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => {
      headers[k] = v
    })

    const id = `h${++seq}`
    const native = new Promise<string>((resolve) => {
      pending.set(id, resolve)
      bridge.httpRequest(
        JSON.stringify({ url: req.url, method: req.method, headers, body }),
        id
      )
    })

    const signal = init?.signal ?? (input instanceof Request ? input.signal : null)
    const raw = await withAbort(native, signal, () => pending.delete(id))
    const res = JSON.parse(raw) as
      | { ok: true; status: number; body: string }
      | { ok: false; error: string }

    if (!res.ok) throw new Error(`headless http failed: ${res.error}`)
    return new Response(res.body, { status: res.status })
  }

  return { fetch: doFetch, supportsStreaming: false }
}

/**
 * 讓 `signal` 真的能中止等待。
 *
 * 與 `httpAdapter.ts` 的 `withAbort` 同樣的理由：原生那側收不到 signal，
 * core 裡的 `AbortController` ＋ 逾時如果沒有這一層就等於不存在。
 */
function withAbort<T>(work: Promise<T>, signal: AbortSignal | null | undefined, cleanup: () => void): Promise<T> {
  const abortError = (reason: string): Error => {
    const e = new Error(reason)
    e.name = 'AbortError'
    return e
  }

  const races: Promise<T>[] = [work]
  if (signal) {
    if (signal.aborted) {
      cleanup()
      return Promise.reject(abortError('aborted'))
    }
    races.push(
      new Promise<never>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            cleanup()
            reject(abortError('aborted'))
          },
          { once: true }
        )
      })
    )
  }
  return Promise.race(races)
}

/**
 * 解開 master key。
 *
 * 拿不到時回 `unavailableSecrets`（＝解不出 API Key），
 * 這**不是崩潰條件**：`reminderSpeak` 會判定「沒有 API Key」而退回快取台詞。
 */
function headlessSecrets(bridge: HeadlessNativeBridge): SecretAdapter {
  const b64 = bridge.masterKey()
  if (!b64) {
    hlog('拿不到 master key（使用者可能還沒設 API Key），將退回快取台詞')
    return unavailableSecrets
  }
  try {
    return createSecretAdapterFromKey(base64ToBytes(b64))
  } catch (e) {
    hlog(`master key 無法使用: ${String(e)}`)
    return unavailableSecrets
  }
}

export function headlessAdapters(): PlatformAdapters | null {
  const bridge = getHeadlessBridge()
  if (!bridge) return null
  return {
    storage: headlessStorage(bridge),
    secrets: headlessSecrets(bridge),
    http: headlessHttp(bridge),
    /*
     * 排程與通知在 headless 都用不到：這一趟只負責生一句話回傳，
     * 通知是原生發的、下一輪排程由前景的 App 負責。
     * 仍然給前景那組 stub，介面才完整。
     */
    scheduler: capacitorScheduler,
    notifier: capacitorNotifier
  }
}
