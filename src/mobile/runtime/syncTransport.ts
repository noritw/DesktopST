/**
 * S1／S2 共用的 HTTP 抓取層——手機向電腦拉資料的所有請求都走這裡。
 *
 * 從 `syncImport.ts`（S1 一次性匯入）抽出來，因為 S2 M2 的 manifest 抓取
 * （`syncManifest.ts`）需要同一套 token header／401/403/404 正規化邏輯，
 * 原本沒有匯出，抽出來才不會在兩個檔案各寫一份。
 */

export interface SyncSource {
  /** 不含結尾斜線，例如 `http://192.168.1.20:3721` */
  baseUrl: string
  token: string
}

export class SyncError extends Error {
  constructor(
    readonly code: 'unreachable' | 'unauthorized' | 'server-error' | 'bad-response' | 'empty',
    message: string
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

export type FetchImpl = typeof globalThis.fetch

export function authHeaders(src: SyncSource): Record<string, string> {
  return { 'X-DesktopST-Token': src.token }
}

/**
 * 逾時上限。
 *
 * ⚠️ **一定要自己算，不能靠 `AbortSignal`。** APK 上 `fetch` 是 CapacitorHttp，
 * 它完全忽略 `init.signal`（CLAUDE.md §5）；電腦整台關機時封包沒人回應，
 * 作業系統的 TCP 逾時可能超過一分鐘。沒有這道上限的話，模式切換前抓
 * manifest 那一步會一直等下去，畫面停在「連線中⋯⋯」完全沒反應
 * （owner 2026-08-13 回報）。
 *
 * 預設放寬到 30 秒是因為這支也用來抓角色包（`getBinary`，可能好幾 MB，
 * 走中繼時更慢）；只是要問一份小清單的呼叫端請自己傳短一點的值。
 */
const DEFAULT_TIMEOUT_MS = 30_000

export async function request(
  src: SyncSource,
  path: string,
  fetchImpl: FetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  let res: Response
  try {
    res = await Promise.race([
      fetchImpl(`${src.baseUrl.replace(/\/$/, '')}${path}`, { headers: authHeaders(src) }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new SyncError('unreachable', `${path} 等了 ${timeoutMs}ms 沒有回應`)), timeoutMs)
      )
    ])
  } catch (e) {
    if (e instanceof SyncError) throw e
    throw new SyncError('unreachable', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 401 || res.status === 403) {
    throw new SyncError('unauthorized', `${path} 回 ${res.status}`)
  }
  if (res.status === 404) throw new SyncError('empty', `${path} 回 404`)
  if (!res.ok) throw new SyncError('server-error', `${path} 回 ${res.status}`)
  return res
}

export async function getJson<T>(
  src: SyncSource,
  path: string,
  fetchImpl: FetchImpl,
  timeoutMs?: number
): Promise<T> {
  const res = await request(src, path, fetchImpl, timeoutMs)
  try {
    return (await res.json()) as T
  } catch {
    throw new SyncError('bad-response', `${path} 回應不是 JSON`)
  }
}

/**
 * POST JSON 並把回應解析回來（S2 M4）。
 *
 * 回應**一定要用**：電腦端存完之後回的是它實際採用的 id，那個 id 不保證等於
 * 送過去的（`savePersonaPresetDirect` 的 `id: existing?.id ?? uuidv4()`）。
 * M3 把回應丟掉、自己假設 id 沒變，對應表因此整份寫錯，每同步一次就多一份
 * 重複資料（`core/sync/pair.ts` 檔頭有完整來龍去脈）。
 *
 * 逾時理由同 `request()`：CapacitorHttp 忽略 `signal`，得自己算。
 */
export async function postJson<T>(
  src: SyncSource,
  path: string,
  payload: unknown,
  fetchImpl: FetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const url = `${src.baseUrl.replace(/\/$/, '')}${path}`
  let res: Response
  try {
    res = await Promise.race([
      fetchImpl(url, {
        method: 'POST',
        headers: { ...authHeaders(src), Authorization: `Bearer ${src.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new SyncError('unreachable', `${path} 等了 ${timeoutMs}ms 沒有回應`)), timeoutMs)
      )
    ])
  } catch (e) {
    if (e instanceof SyncError) throw e
    throw new SyncError('unreachable', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 401 || res.status === 403) throw new SyncError('unauthorized', `${path} 回 ${res.status}`)
  if (!res.ok) throw new SyncError('server-error', `${path} 回 ${res.status}：${await res.text().catch(() => '')}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new SyncError('bad-response', `${path} 回應不是 JSON`)
  }
}

export async function getBinary(src: SyncSource, path: string, fetchImpl: FetchImpl): Promise<Uint8Array> {
  const res = await request(src, path, fetchImpl)
  return new Uint8Array(await res.arrayBuffer())
}
