import { Capacitor } from '@capacitor/core'
import type { AppMode } from '../data'

/**
 * 連線設定：這個 app 現在要跟誰講話。
 *
 * 三種進入方式，**同一份 UI**（roadmap §4.5）：
 *
 * | 進入方式 | 模式 | 位址與權杖從哪來 |
 * |---|---|---|
 * | mobileServer 提供的網頁（掃 QR） | 遙控 | 同源 ＋ `?token=` 或 relay 注入 |
 * | 開發時的 `npm run dev:mobile` | 遙控 | `?server=` ＋ `?token=` 明確指定 |
 * | APK（原生殼） | **獨立**（預設） | 本機 Capacitor adapters |
 *
 * 網頁版**永遠是遙控模式** —— 網頁由電腦提供，電腦沒開就連不上，
 * 這是拓樸限制不是取捨（roadmap §4.5）。
 *
 * 原生殼可用 `?server=` 或 `?mode=remote` 強制遙控（除錯用）。
 */

export interface Connection {
  mode: AppMode
  /** 遙控模式才有意義。不含結尾斜線。 */
  baseUrl: string
  token: string
}

/**
 * 記住的「上次用哪個模式」（S2 M1）。只有原生殼會用到。
 *
 * `remote` 只在使用者曾經**成功切到遙控**時才有值——單純掃 QR 匯入（S1）
 * 不會寫這裡，那是完全不同的動作（一次性拉資料，不是「接下來都連這台」）。
 */
export interface ModePref {
  mode: AppMode
  remote?: { baseUrl: string; token: string }
}

declare global {
  interface Window {
    __mobileToken?: string
    __relayDeviceId?: string
    __relayPageUrl?: string
    __tunnelWsUrl?: string
  }
}

/**
 * @param pref 記住的「上次用哪個模式」（S2 M1）。**只在原生殼、且沒有任何
 *   URL／relay 訊號時**才會參考——那些訊號代表明確的外部意圖（掃 QR 開的頁面、
 *   `dev:mobile --server=` 除錯），永遠比「上次記住的」優先。
 */
export function resolveConnection(loc: Location = location, pref?: ModePref | null): Connection {
  const params = new URLSearchParams(loc.search)

  const token = window.__mobileToken || params.get('token') || ''
  const serverOverride = params.get('server')
  const modeParam = params.get('mode')
  const forceStandalone = modeParam === 'standalone'
  const forceRemote = modeParam === 'remote'

  const relayDeviceId = window.__relayDeviceId
  const baseUrl = serverOverride
    ? serverOverride.replace(/\/$/, '')
    : relayDeviceId
      ? `/${relayDeviceId}`
      : ''

  /*
   * 原生殼預設獨立；掃 QR／網頁預設遙控。
   * - `?mode=standalone`：瀏覽器也可強制獨立（用 Capacitor web 後備測本機庫）
   * - 原生若帶 `?server=`／`?mode=remote`／relay 注入 → 遙控（對桌面除錯）
   */
  if (forceStandalone) {
    return { mode: 'standalone', baseUrl: '', token: '' }
  }

  const hasExplicitSignal = forceRemote || !!serverOverride || !!window.__mobileToken || !!relayDeviceId
  const wantRemote = !Capacitor.isNativePlatform() || hasExplicitSignal

  if (!wantRemote) {
    // 原生殼、沒有任何外部訊號 → 這才是記住的偏好該發揮作用的時候。
    if (pref?.mode === 'remote' && pref.remote) {
      return { mode: 'remote', baseUrl: pref.remote.baseUrl, token: pref.remote.token }
    }
    return { mode: 'standalone', baseUrl: '', token: '' }
  }

  return { mode: 'remote', baseUrl, token }
}

export function wsUrlFor(conn: Connection): string {
  if (window.__tunnelWsUrl) return window.__tunnelWsUrl

  const token = encodeURIComponent(conn.token)
  if (/^https?:/i.test(conn.baseUrl)) {
    return `${conn.baseUrl.replace(/^http/, 'ws')}/?token=${token}`
  }
  const wsOrigin = location.origin.replace(/^http/, 'ws')
  return `${wsOrigin}${conn.baseUrl}/?token=${token}`
}

/**
 * 探測一組 `{baseUrl, token}` 現在連不連得上（S2 M1 切換模式用）。
 *
 * 跟 `detectLanDirect` 故意分開：那支只在**已經確定要用**遙控時，
 * 拿來判斷「是不是區網直連」；這支是**切換前的守門**，關心的是「連不連得上、
 * 權杖還有沒有效」，401（權杖過期，`DesktopPullSection.tsx` 已有先例）也要算失敗。
 */
export async function checkRemoteReachable(baseUrl: string, token: string): Promise<boolean> {
  try {
    const base = baseUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/api/connection-info`, {
      headers: { 'X-DesktopST-Token': token }
    })
    return res.ok
  } catch {
    return false
  }
}

export interface LiveRemoteResolution {
  ok: boolean
  /** `ok:true` 時才有意義：最後真的要用來連線的位址（可能已升級成區網直連）。 */
  baseUrl?: string
  token?: string
  /** 走的是中繼、而且升級不了區網直連——這個 App 版本沒辦法在這條連線上建立即時遙控。 */
  relayOnly?: boolean
}

/**
 * 幫「App 內切換到遙控」（S2 M1 `ModeSwitcher.tsx`）決定實際要連的位址。
 *
 * ⚠️ **中繼網址不能直接拿來開 WebSocket。** `wsUrlFor()` 對一般伺服器位址是拿
 * `baseUrl` 字串代換 `http→ws`，這對中繼完全是錯的路由——中繼的即時通道只有
 * **中繼自己託管的網頁**載入時才會被注入正確位址（`window.__tunnelWsUrl`，
 * 見 `main/cloudflare-worker.js`）。原生殼是自己組網址連過去，繞過了那層注入，
 * 症狀是 HTTP（送訊息）正常、WebSocket（即時狀態／推播）永遠連不上、
 * 畫面卡在「連線中斷，正在重新連線」（2026-08-12 owner 實機回報）。
 *
 * 因此**掃到中繼網址時，一律嘗試比照 S1（`syncImport.ts` 的 `upgradeToLan`）
 * 升級成區網直連**；升級不了就老實回報 `relayOnly`，讓呼叫端明講「這條連線
 * 這個版本還不支援即時遙控」，不要讓使用者切過去卻卡在一個永遠連不上的假連線。
 */
export async function resolveLiveRemote(baseUrl: string, token: string): Promise<LiveRemoteResolution> {
  const base = baseUrl.replace(/\/$/, '')
  const info = await fetchSyncInitInfo(base, token)
  if (!info) return { ok: false }
  if (info.lanDirect) return { ok: true, baseUrl: base, token }

  const lanUrl = info.lanUrl?.trim()
  if (lanUrl) {
    const upgraded = await fetchSyncInitInfo(lanUrl.replace(/\/$/, ''), token)
    if (upgraded?.lanDirect) return { ok: true, baseUrl: lanUrl.replace(/\/$/, ''), token }
  }
  return { ok: true, relayOnly: true }
}

async function fetchSyncInitInfo(
  base: string,
  token: string
): Promise<{ lanDirect: boolean; lanUrl?: string } | null> {
  // 同樣要自己算逾時：這支是「切換到遙控」按下去之後第一個等待點，
  // 電腦關機時沒有逾時就會一直停在「連線中⋯⋯」（owner 2026-08-13 回報）。
  const work = (async (): Promise<{ lanDirect: boolean; lanUrl?: string } | null> => {
    try {
      const res = await fetch(`${base}/api/sync-init`, { headers: { 'X-DesktopST-Token': token } })
      if (!res.ok) return null
      const data = (await res.json()) as { lanDirect?: boolean; lanUrl?: string }
      return { lanDirect: !!data.lanDirect, lanUrl: data.lanUrl }
    } catch {
      return null
    }
  })()
  return withTimeout(work, PROBE_TIMEOUT_MS, null)
}

/**
 * 探測電腦還在不在的逾時。
 *
 * ⚠️ **一定要自己算時間，不能靠 `AbortSignal`。** CapacitorHttp 完全忽略
 * `init.signal`（CLAUDE.md §5），APK 上唯一能中止「等待」的方法是 `Promise.race`。
 * 電腦整台關機時封包沒有任何人回應，作業系統的 TCP 逾時可能要等上一分鐘以上——
 * 開 App 停在「載入中⋯⋯」不動就是這樣來的（owner 2026-08-13 回報）。
 *
 * 六秒對區網綽綽有餘；中繼再慢也不該讓使用者盯著轉圈等更久，真的慢了
 * 使用者仍可在詢問視窗選「繼續嘗試連線」。
 */
export const PROBE_TIMEOUT_MS = 6000

/** 逾時就當作沒連上。原生請求仍會自己跑完，我們只是不再等它。 */
function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(onTimeout), ms))
  ])
}

/**
 * 電腦還在不在 ＋ 是不是區網直連，一次問完。
 *
 * 兩件事共用同一支 `/api/connection-info`：開機流程需要「連得上嗎」來決定要不要
 * 詢問使用者切回本機，而 header 的小標籤需要 `lanDirect`。分兩次問等於在電腦
 * 關機時要等兩次逾時。
 */
export async function probeRemote(
  conn: Connection,
  timeoutMs = PROBE_TIMEOUT_MS
): Promise<{ alive: boolean; lanDirect: boolean }> {
  if (conn.mode === 'standalone') return { alive: true, lanDirect: false }
  const work = (async (): Promise<{ alive: boolean; lanDirect: boolean }> => {
    try {
      const base = conn.baseUrl.replace(/\/$/, '')
      const res = await fetch(`${base}/api/connection-info`, {
        headers: { 'X-DesktopST-Token': conn.token }
      })
      // 權杖過期（401／403）也算「電腦在」——那要走重新配對，不是叫使用者切回本機。
      if (!res.ok) return { alive: res.status === 401 || res.status === 403, lanDirect: false }
      const data = (await res.json()) as { lanDirect?: boolean }
      return { alive: true, lanDirect: data.lanDirect === true }
    } catch {
      return { alive: false, lanDirect: false }
    }
  })()
  return withTimeout(work, timeoutMs, { alive: false, lanDirect: false })
}

export async function detectLanDirect(conn: Connection): Promise<boolean> {
  return (await probeRemote(conn)).lanDirect
}

/** Header 小標籤用：最多兩個字，點進去「關於」才看完整說明。 */
export function modeBadgeLabel(conn: Connection, lanDirect: boolean | null): string {
  if (conn.mode === 'standalone') return '本機'
  if (window.__relayDeviceId || window.__tunnelWsUrl) return '中繼'
  if (lanDirect === true) return '區網'
  return '電腦'
}

/** 關於視窗用的完整連線說明。 */
export function modeDescription(conn: Connection, lanDirect: boolean | null): string {
  if (conn.mode === 'standalone') {
    return '獨立模式：角色、對話與設定都存在這台手機上，不必開著電腦也能聊。'
  }
  if (window.__relayDeviceId || window.__tunnelWsUrl) {
    return '遙控模式（中繼）：畫面與操作經過中繼伺服器連到你的電腦。金鑰等敏感資料不會經中繼傳送。'
  }
  if (lanDirect === true) {
    return '遙控模式（區網）：手機與電腦在同一個區域網路，直接連到電腦上的 DeST。'
  }
  if (lanDirect === false) {
    return '遙控模式：正在連線到電腦上的 DeST。若兩台在同一個 Wi-Fi，通常可以升級成區網直連。'
  }
  return '遙控模式：正在確認與電腦的連線方式……'
}

/** @deprecated 改用 modeBadgeLabel／modeDescription */
export function modeLabel(conn: Connection, lanDirect: boolean | null): string {
  return modeBadgeLabel(conn, lanDirect)
}
