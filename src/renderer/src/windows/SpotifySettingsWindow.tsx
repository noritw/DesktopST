import { useEffect, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'

export default function SpotifySettingsWindow() {
  const settings = useAppStore(s => s.settings)
  const [clientId, setClientId] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const displayName = settings?.spotify?.displayName
  const connected = !!displayName

  useEffect(() => {
    if (settings?.spotify?.clientId) setClientId(settings.spotify.clientId)
  }, [settings?.spotify?.clientId])

  // When displayName appears in settings, auth completed
  useEffect(() => {
    if (waiting && connected) {
      setWaiting(false)
      setMsg({ type: 'ok', text: `已連結為 ${displayName}` })
    }
  }, [connected, displayName, waiting])

  async function handleConnect() {
    const id = clientId.trim()
    if (!id) { setMsg({ type: 'err', text: '請輸入 Client ID' }); return }
    setMsg(null)
    setWaiting(true)
    await window.api.invoke('spotify:start-auth', id)
  }

  async function handleDisconnect() {
    setMsg(null)
    setWaiting(false)
    await window.api.invoke('spotify:disconnect')
    setMsg({ type: 'ok', text: '已斷線' })
  }

  function handleClose() {
    window.api.invoke('spotify:close-settings')
  }

  return (
    <div className="w-full h-full flex flex-col bg-surface rounded-2xl overflow-hidden select-none">
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-mint-40 border-b border-border shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-semibold text-primary">Spotify 整合設定</span>
        <button
          type="button"
          className="w-6 h-6 rounded-full flex items-center justify-center text-secondary hover:bg-mint transition-all text-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleClose}
        >✕</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Status */}
        <div className="rounded-xl bg-mint-40 border border-border p-4 space-y-1">
          <p className="text-xs font-medium text-secondary">連線狀態</p>
          {connected ? (
            <p className="text-sm text-primary font-semibold">已連結：{displayName}</p>
          ) : waiting ? (
            <p className="text-sm text-secondary">等待 Spotify 授權中…請在瀏覽器完成登入</p>
          ) : (
            <p className="text-sm text-secondary">未連結</p>
          )}
        </div>

        {/* Client ID */}
        {!connected && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-secondary block">Spotify Client ID</label>
            <input
              type="text"
              className="input-field w-full text-sm font-mono"
              placeholder="貼上你的 Client ID"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              disabled={waiting}
            />
            <p className="text-[11px] text-secondary leading-relaxed">
              至 Spotify Developer Dashboard 建立應用程式取得 Client ID。
              Redirect URI 請填入：<span className="font-mono text-primary">desktopst://spotify-callback</span>
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {!connected ? (
            <button
              type="button"
              disabled={waiting || !clientId.trim()}
              className="text-sm px-4 py-2 rounded-full bg-[#1DB954] text-white font-semibold hover:bg-[#1aa34a] transition-all disabled:opacity-50"
              onClick={handleConnect}
            >
              {waiting ? '等待授權…' : '連結 Spotify 帳號'}
            </button>
          ) : (
            <button
              type="button"
              className="text-sm px-4 py-2 rounded-full border border-border text-secondary hover:bg-mint-40 transition-all"
              onClick={handleDisconnect}
            >
              斷開連結
            </button>
          )}
        </div>

        {msg && (
          <p className={`text-xs ${msg.type === 'ok' ? 'text-teal' : 'text-[#E85D3F]'}`}>
            {msg.text}
          </p>
        )}

        {/* Info */}
        <div className="border-t border-border pt-4 space-y-1.5 text-[11px] text-secondary leading-relaxed">
          <p>連結後，對話時若 Spotify 正在播放，曲目資訊會自動附入角色的對話情境。</p>
          <p>若長時間未使用，Token 會自動更新，不需要重新登入。</p>
          <p>Token 以系統加密儲存於本機，不會包含在備份或匯出中。</p>
        </div>
      </div>
    </div>
  )
}
