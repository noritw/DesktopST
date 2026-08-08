import { useEffect, useMemo, useState } from 'react'
import { APP_VERSION, formatBuildTime, GIT_HASH } from '../../buildInfo'
import { detectLanDirect, modeDescription, resolveConnection, type Connection } from '../connection'
import { useAppStore } from '../stores/appStore'

const OFFICIAL_URL = 'https://nori.tw/DeST/intro.html'
const LICENSE_URL = 'https://nori.tw/DeST/license.html'

/**
 * 「關於本程式」——由 header 左上角兩字標籤點進來。
 *
 * 版號與建置時間不該直接印在那顆小標籤上（醜、也擠），
 * 但一步之內要能查到「我更新了沒」，所以點一下開這頁。
 */
export function AboutView(): JSX.Element {
  const conn = useMemo(() => resolveConnection(), [])
  const status = useAppStore((s) => s.status)
  const built = formatBuildTime()
  const [lanDirect, setLanDirect] = useState<boolean | null>(null)

  useEffect(() => {
    if (conn.mode !== 'remote') return
    let cancelled = false
    void detectLanDirect(conn).then((v) => {
      if (!cancelled) setLanDirect(v)
    })
    return () => {
      cancelled = true
    }
  }, [conn])

  return (
    <div className="space-y-4 pb-2">
      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
        <p className="text-[11px] text-[var(--text-sub)]">程式名稱</p>
        <p className="text-base font-semibold text-[var(--text)]">DeST</p>
        <p className="mt-0.5 text-[12px] text-[var(--text-sub)]">DesktopST 手機版</p>
      </div>

      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3 space-y-2">
        <Row label="版本" value={`v${APP_VERSION}`} />
        <Row label="建置時間" value={built || '（開發模式未注入）'} />
        {GIT_HASH ? <Row label="程式碼" value={GIT_HASH} /> : null}
      </div>

      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
        <p className="text-[11px] text-[var(--text-sub)]">目前連線</p>
        <p className="mt-1 text-sm font-medium text-[var(--text)]">{connectionTitle(conn, lanDirect)}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-sub)]">
          {modeDescription(conn, lanDirect)}
        </p>
        {conn.mode === 'remote' && (
          <p className="mt-2 text-[11px] text-[var(--text-sub)]">
            連線狀態：
            {status === 'online'
              ? '正常'
              : status === 'offline'
                ? '中斷，正在重連'
                : status === 'connecting'
                  ? '連線中'
                  : '尚未連線'}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <a
          href={OFFICIAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center rounded-full bg-[var(--mint)] py-2.5 text-sm font-medium text-[var(--text)]"
        >
          官方網頁
        </a>
        <a
          href={LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text-sub)]"
        >
          授權條款
        </a>
      </div>

      <p className="px-1 text-center text-[11px] text-[var(--text-sub)]">
        判斷「手機有沒有裝到新的」請看建置時間，不是版本號——debug 版重打多次也可能仍是同一版號。
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[11px] text-[var(--text-sub)]">{label}</span>
      <span className="min-w-0 truncate text-right text-sm text-[var(--text)]">{value}</span>
    </div>
  )
}

function connectionTitle(conn: Connection, lanDirect: boolean | null): string {
  if (conn.mode === 'standalone') return '本機（獨立版）'
  if (window.__relayDeviceId || window.__tunnelWsUrl) return '遙控 · 中繼'
  if (lanDirect === true) return '遙控 · 區網直連'
  if (lanDirect === false) return '遙控 · 連線中'
  return '遙控'
}
