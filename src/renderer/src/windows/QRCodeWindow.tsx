import { useEffect, useState } from 'react'

interface MobileStatus {
  enabled: boolean
  running: boolean
  tunnelReady: boolean
  url: string | null
  localUrl: string
  connectedCount: number
  cloudflaredAvailable: boolean
}

export default function QRCodeWindow() {
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const refresh = async () => {
      const s = await window.api.invoke('mobile:get-status') as MobileStatus
      setStatus(s)

      // Generate QR code from the best available URL
      const url = s.tunnelReady && s.url ? s.url : s.running ? s.localUrl : null
      if (url) {
        const dataUrl = await window.api.invoke('mobile:generate-qr', url) as string | null
        setQrDataUrl(dataUrl)
      } else {
        setQrDataUrl(null)
      }
    }

    refresh()
    const interval = setInterval(refresh, 2000)

    const unsub = window.api.on('mobile:status-updated', () => { void refresh() })

    return () => {
      clearInterval(interval)
      unsub()
    }
  }, [])

  const displayUrl = status?.tunnelReady && status.url
    ? status.url
    : status?.running
    ? status.localUrl
    : null

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
  const statusLabel = status.tunnelReady
    ? `✅ 已就緒（${status.connectedCount} 支裝置連線中）`
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

        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="QR Code"
            style={styles.qrImg}
          />
        ) : (
          <div style={styles.qrPlaceholder}>
            <div style={styles.spinner}>⏳</div>
            <div style={{ fontSize: 13, color: '#7AA898', marginTop: 8 }}>等待 Tunnel 就緒…</div>
          </div>
        )}

        <div style={styles.urlBox}>
          <span style={styles.urlText}>{displayUrl ?? '等待中…'}</span>
        </div>

        {displayUrl && (
          <button style={{ ...styles.copyBtn, ...noDrag }} onClick={handleCopy}>
            {copied ? '✓ 已複製' : '複製網址'}
          </button>
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
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#F7FFFC',
    padding: 16,
    ...drag,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    background: '#fff',
    borderRadius: 20,
    padding: '24px 20px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)',
    width: '100%',
    maxWidth: 280,
  },
  statusBadge: {
    fontSize: 13,
    color: '#3D5A52',
    background: '#CBFBC4',
    borderRadius: 20,
    padding: '4px 12px',
    textAlign: 'center',
  },
  qrImg: {
    width: 200,
    height: 200,
    borderRadius: 12,
    border: '3px solid #CBFBC4',
  },
  qrPlaceholder: {
    width: 200,
    height: 200,
    borderRadius: 12,
    border: '3px solid #CBFBC4',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#F7FFFC',
  },
  urlBox: {
    background: '#F7FFFC',
    borderRadius: 10,
    padding: '8px 12px',
    width: '100%',
    textAlign: 'center',
  },
  urlText: {
    fontSize: 12,
    color: '#3D5A52',
    wordBreak: 'break-all',
  },
  copyBtn: {
    padding: '8px 24px',
    borderRadius: 20,
    border: 'none',
    background: '#AAEEDD',
    color: '#3D5A52',
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
    color: '#3D5A52',
    textAlign: 'center',
  },
  hint: {
    fontSize: 13,
    color: '#7AA898',
    textAlign: 'center',
  },
  warnBox: {
    fontSize: 12,
    color: '#9B3535',
    background: '#FFF0F0',
    borderRadius: 10,
    padding: '8px 12px',
    lineHeight: 1.6,
    textAlign: 'center',
  },
  localHint: {
    fontSize: 12,
    color: '#7AA898',
    textAlign: 'center',
    lineHeight: 1.6,
  },
  spinner: {
    fontSize: 24,
    color: '#7AA898',
  },
  closeBtn: {
    position: 'fixed' as const,
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0,0,0,0.08)',
    color: '#3D5A52',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
}
