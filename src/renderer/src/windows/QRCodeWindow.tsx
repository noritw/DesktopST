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

type Purpose = 'backup' | 'remote'

/**
 * 「用手機遙控這台電腦」：挑一個最穩的網址（relay → tunnel → 區網）。
 * 中繼未啟用／未連上時 `relayUrl` 已經是空字串（見 `getMobileStatus()`），
 * 不會再指向一個打下去只會 503 的網址（qr-entry-merge-plan.md §2.1）。
 */
function pickRemoteUrl(s: MobileStatus): string | null {
  return s.relayUrl || (s.tunnelReady && s.url ? s.url : s.running ? s.localUrl : null)
}

/**
 * 「把資料複製到手機」：**一律用區網位址**，不要中繼。
 * 中繼會被電腦端剝掉 API Key（qr-entry-merge-plan.md §4.2），先給區網位址
 * 直接對，不必依賴「掃到中繼再自動升級」那套只有第一次連線才會跑的機制。
 */
function pickBackupUrl(s: MobileStatus): string | null {
  return s.running ? s.localUrl : null
}

function pickUrl(purpose: Purpose, s: MobileStatus): string | null {
  return purpose === 'backup' ? pickBackupUrl(s) : pickRemoteUrl(s)
}

export default function QRCodeWindow() {
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const [purpose, setPurpose] = useState<Purpose | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const refresh = async () => {
      const s = await window.api.invoke('mobile:get-status') as MobileStatus
      setStatus(s)
    }

    refresh()
    const interval = setInterval(refresh, 2000)

    const unsub = window.api.on('mobile:status-updated', () => { void refresh() })

    return () => {
      clearInterval(interval)
      unsub()
    }
  }, [])

  const displayUrl = status && purpose ? pickUrl(purpose, status) : null

  useEffect(() => {
    // 沒建置就不產碼——給一個掃了會 503 的 QR 比不給更難懂
    if (!status?.appAvailable || !displayUrl) { setQrDataUrl(null); return }
    let cancelled = false
    void window.api.invoke('mobile:generate-qr', displayUrl).then((url) => {
      if (!cancelled) setQrDataUrl(url as string | null)
    })
    return () => { cancelled = true }
  }, [status?.appAvailable, displayUrl])

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

  // 先問用途，再出對應的 QR（qr-entry-merge-plan.md §4.2）——
  // 不要讓使用者自己搞懂中繼／區網的差別才知道該掃哪張。
  if (!purpose) {
    return (
      <div style={styles.root}>
        <button style={{ ...styles.closeBtn, ...noDrag }} onClick={handleClose}>✕</button>
        <div style={{ ...styles.card, ...noDrag }}>
          <div style={styles.blockTitle}>連接手機</div>
          <button style={{ ...styles.purposeBtn, ...noDrag }} onClick={() => setPurpose('backup')}>
            <span style={styles.purposeBtnTitle}>把資料複製到手機</span>
            <span style={styles.purposeBtnHint}>需要手機和這台電腦連同一個 Wi-Fi。API Key 只會在這種連線下傳送。</span>
          </button>
          <button style={{ ...styles.purposeBtn, ...noDrag }} onClick={() => setPurpose('remote')}>
            <span style={styles.purposeBtnTitle}>用手機遙控這台電腦</span>
            <span style={styles.purposeBtnHint}>
              同一個 Wi-Fi 時速度最快；不在同一個網路時會透過中繼連線。
              也可以切換成這個模式，把手機獨立版累積的角色、對話、提醒等資料同步回這台電腦（雙向同步，逐項比對後再選）。
            </span>
          </button>
        </div>
      </div>
    )
  }

  const extStatus = status as MobileStatus & { tunnelStatus?: string }
  const firewallBlocked = extStatus.tunnelStatus === 'firewall-blocked'
  const statusLabel = purpose === 'backup'
    ? (status.running ? '✅ 已就緒' : '❌ 伺服器未啟動')
    : status.relayUrl && status.tunnelReady
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
        <button style={{ ...styles.backBtn, ...noDrag }} onClick={() => setPurpose(null)}>← 換個用途</button>
        <div style={styles.statusBadge}>
          {statusLabel}
        </div>

        <div style={styles.qrBlock}>
          <div style={styles.blockTitle}>{purpose === 'backup' ? '把資料複製到手機' : '用手機遙控這台電腦'}</div>
          <div style={styles.blockHint}>
            {purpose === 'backup'
              ? '需要同一個 Wi-Fi，API Key 才會一起傳過去'
              : '同一個 Wi-Fi 時速度最快，不同網路會自動走中繼；連上後可在手機「切換模式」把資料雙向同步回這台電腦'}
          </div>
          {status.appAvailable ? (
            qrDataUrl ? (
              <img src={qrDataUrl} alt="手機遠端 QR Code" style={styles.qrImg} />
            ) : (
              <div style={styles.qrPlaceholder}>
                <div style={styles.spinner}>⏳</div>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                  {purpose === 'backup' ? '等待伺服器啟動…' : '等待 Tunnel 就緒…'}
                </div>
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

        {purpose === 'remote' && firewallBlocked && (
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

        {purpose === 'remote' && !status.cloudflaredAvailable && (
          <div style={styles.warnBox}>
            ⚠️ 找不到 cloudflared.exe，目前僅支援區域網路連線。
            請將 cloudflared.exe 放入 bin\ 資料夾（開發模式）或 cloudflared\ 資料夾（打包後）。
          </div>
        )}

        {purpose === 'remote' && !status.tunnelReady && status.running && (
          <div style={styles.localHint}>
            區域網路也可用：<br />
            <span style={{ fontWeight: 600 }}>{status.localUrl}</span>
          </div>
        )}

        {status.appAvailable && displayUrl && (
          <div style={styles.pairWarnBox}>
            ⚠️ 這張 QR／網址等同這台電腦的存取憑證，請勿截圖外流或分享給不信任的人。
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
  purposeBtn: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: 4,
    width: '100%',
    textAlign: 'left' as const,
    padding: '12px 14px',
    borderRadius: 14,
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  purposeBtnTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--color-text-primary)',
  },
  purposeBtnHint: {
    fontSize: 11,
    lineHeight: 1.5,
    color: 'var(--color-text-secondary)',
  },
  backBtn: {
    alignSelf: 'flex-start' as const,
    border: 'none',
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    fontSize: 12,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    fontFamily: 'inherit',
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
  pairWarnBox: {
    fontSize: 11,
    color: 'var(--color-text-secondary)',
    textAlign: 'center' as const,
    lineHeight: 1.6,
    padding: '0 4px',
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
