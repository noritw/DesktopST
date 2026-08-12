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

export async function request(src: SyncSource, path: string, fetchImpl: FetchImpl): Promise<Response> {
  let res: Response
  try {
    res = await fetchImpl(`${src.baseUrl.replace(/\/$/, '')}${path}`, { headers: authHeaders(src) })
  } catch (e) {
    throw new SyncError('unreachable', e instanceof Error ? e.message : String(e))
  }
  if (res.status === 401 || res.status === 403) {
    throw new SyncError('unauthorized', `${path} 回 ${res.status}`)
  }
  if (res.status === 404) throw new SyncError('empty', `${path} 回 404`)
  if (!res.ok) throw new SyncError('server-error', `${path} 回 ${res.status}`)
  return res
}

export async function getJson<T>(src: SyncSource, path: string, fetchImpl: FetchImpl): Promise<T> {
  const res = await request(src, path, fetchImpl)
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
