import { useEffect, useState } from 'react'

interface MobileStatus {
  enabled: boolean
  running: boolean
  tunnelReady: boolean
  url: string | null
  localUrl: string
  relayUrl: string
  /** 沒跑過 `npm run build:mobile` 時為 false。 */
  appAvailable: boolean
  connectedCount: number
  cloudflaredAvailable: boolean
}

/**
 * 挑一個最穩的網址：relay（最穩，換網路也不用重掃）→ tunnel → 區網。
 */
function pickUrl(s: MobileStatus): string | null {
  return s.relayUrl || (s.tunnelReady && s.url ? s.url : s.running ? s.localUrl : null)
}

export default function QRCodeWindow() {
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const refresh = async () => {
      const s = await window.api.invoke('mobile:get-status') as MobileStatus
      setStatus(s)

      // 沒建置就不產碼——給一個掃了會 503 的 QR 比不給更難懂
      const url = s.appAvailable ? pickUrl(s) : null
      setQrDataUrl(url ? (await window.api.invoke('mobile:generate-qr', url) as string | null) : null)
    }

    refresh()
    const interval = setInterval(refresh, 2000)

    const unsub = window.api.on('mobile:status-updated', () => { void refresh() })

    return () => {
      clearInterval(interval)
      unsub()
    }
  }, [])

  const displayUrl = status ? pickUrl(status) : null

  const handleCopy = () => {
    if (!displayUrl) return
    navigator.clipboard.writeText(displayUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleClose = () => window.close()

  if (!status) {
    return (
      <div style={styles.root}>
        <button style={{ ...styles.closeBtn, ...noDrag }} onClick={handleClose}>✕</button>
        <div style={styles.spinner}>載入中…</div>
      </div>
    )
  }

  if (!status.enabled || !status.running) {
    return (
      <div style={styles.root}>
        <button style={{ ...styles.closeBtn, ...noDrag }} onClick={handleClose}>✕</button>
        <div style={{ ...styles.card, ...noDrag }}>
          <div style={styles.iconLarge}>📱</div>
          <div style={styles.title}>手機遠端對話未啟用</div>
          <div style={styles.hint}>請至「設定 → 介面」開啟手機遠端功能</div>
        </div>
      </div>
    )
  }

  const extStatus = status as MobileStatus & { tunnelStatus?: string }
  const firewallBlocked = extStatus.tunnelStatus === 'firewall-blocked'
  const statusLabel = status.relayUrl && status.tunnelReady
    ? `✅ 已就緒（${status.connectedCount} 支裝置連線中）`
    : firewallBlocked
    ? '🚫 防火牆可能阻擋了 Tunnel'
    : extStatus.tunnelStatus === 'downloading'
    ? '⬇️ 正在下載 Cloudflare Tunnel…'
    : status.running
    ? '⏳ Cloudflare Tunnel 連線中…'
    : '❌ 伺服器未啟動'

  return (
    <div style={styles.root}>
      <button style={{ ...styles.closeBtn, ...noDrag }} onClick={handleClose}>✕</button>
      <div style={{ ...styles.card, ...noDrag }}>
        <div style={styles.statusBadge}>
          {statusLabel}
        </div>

        <div style={styles.qrBlock}>
          <div style={styles.blockTitle}>手機遠端</div>
          <div style={styles.blockHint}>聊天、角色、設定、遙控</div>
          {status.appAvailable ? (
            qrDataUrl ? (
              <img src={qrDataUrl} alt="手機遠端 QR Code" style={styles.qrImg} />
            ) : (
              <div style={styles.qrPlaceholder}>
                <div style={styles.spinner}>⏳</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>等待 Tunnel 就緒…</div>
              </div>
            )
          ) : (
            <div style={styles.qrPlaceholder}>
              <div style={styles.missingText}>尚未建置：請執行 npm run build:mobile</div>
            </div>
          )}
          {status.appAvailable && displayUrl && (
            <button style={{ ...styles.copyBtn, ...noDrag }} onClick={handleCopy}>
              {copied ? '✓ 已複製' : '複製網址'}
            </button>
          )}
        </div>

        {firewallBlocked && (
          <div style={styles.warnBox}>
            🚫 Tunnel 連線超時，可能是 Windows 防火牆阻擋。
            <button
              style={{ ...styles.fixBtn, ...noDrag }}
              onClick={() => window.api.invoke('mobile:fix-firewall')}
            >
              自動修復防火牆
            </button>
          </div>
        )}

        {!status.cloudflaredAvailable && (
          <div style={styles.warnBox}>
            ⚠️ 找不到 cloudflared.exe，目前僅支援區域網路連線。
            請將 cloudflared.exe 放入 bin\ 資料夾（開發模式）或 cloudflared\ 資料夾（打包後）。
          </div>
        )}

        {!status.tunnelReady && status.running && (
          <div style={styles.localHint}>
            區域網路也可用：<br />
            <span style={{ fontWeight: 600 }}>{status.localUrl}</span>
          </div>
        )}
      </div>
    </div>
  )
}

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const styles: Record<string, React.CSSProperties> = {
  root: {
    // 單組 QR：置中即可。矮螢幕仍可捲，避免內容被裁。
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    maxHeight: '100vh',
    overflowY: 'auto' as const,
    boxSizing: 'border-box' as const,
    background: 'var(--color-bg)',
    padding: 16,
    ...drag,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    background: 'var(--color-surface)',
    borderRadius: 20,
    padding: '20px 20px',
    boxShadow: 'var(--shadow-soft)',
    width: '100%',
    maxWidth: 280,
    flexShrink: 0,
  },
  statusBadge: {
    fontSize: 13,
    color: 'var(--color-text-primary)',
    background: 'var(--color-mint)',
    borderRadius: 20,
    padding: '4px 12px',
    textAlign: 'center',
  },
  qrBlock: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: 6,
    width: '100%',
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  blockHint: {
    fontSize: 11,
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const,
  },
  missingText: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const,
    lineHeight: 1.6,
    padding: '0 12px',
  },
  qrImg: {
    width: 160,
    height: 160,
    borderRadius: 12,
    border: '3px solid var(--color-mint)',
    // ⚠️ 全檔唯一刻意寫死的顏色：QR code 需要淺底才掃得到。
    // 換成 var(--color-surface) 之類的話，深色主題下會變成深底深碼，
    // 畫面看起來還很正常、但相機掃不出來——不要「順手」改成變數。
    background: '#FFFFFF',
  },
  qrPlaceholder: {
    width: 160,
    height: 160,
    borderRadius: 12,
    border: '3px solid var(--color-mint)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg)',
  },
  copyBtn: {
    padding: '8px 24px',
    borderRadius: 20,
    border: 'none',
    background: 'var(--color-teal)',
    color: 'var(--color-text-primary)',
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  iconLarge: {
    fontSize: 48,
  },
  title: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
  },
  warnBox: {
    fontSize: 12,
    color: 'var(--color-danger)',
    background: 'var(--color-danger-soft)',
    borderRadius: 10,
    padding: '8px 12px',
    lineHeight: 1.6,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
  },
  fixBtn: {
    padding: '6px 16px',
    borderRadius: 20,
    border: 'none',
    background: 'var(--color-danger-border)',
    color: 'var(--color-text-primary)',
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  localHint: {
    fontSize: 12,
    color: 'var(--color-text-secondary)',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  spinner: {
    fontSize: 24,
    color: 'var(--color-text-secondary)',
  },
  closeBtn: {
    position: 'fixed' as const,
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--color-border-60)',
    color: 'var(--color-text-primary)',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
}
