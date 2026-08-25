import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '../stores/useAppStore'

/** `calendar:peek` 的回傳形狀（主程序 CalendarPeekResult ＋ 情境覆蓋旗標） */
interface CalendarPeek {
  configured: boolean
  authenticated: boolean
  enabled: boolean
  lookaheadHours: number
  events: Array<{ id: string; title: string; start: number; kind: 'event' | 'task' }> | null
  injectionText: string | null
  fetchedAt: number
  error?: string
  sceneOverridden?: boolean
}

export default function CalendarSettingsWindow() {
  const settings = useAppStore(s => s.settings)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [lookahead, setLookahead] = useState(24)
  const [maxEvents, setMaxEvents] = useState(5)
  const [mentionWhenEmpty, setMentionWhenEmpty] = useState(false)
  const [notifyOnUnsyncedChanges, setNotifyOnUnsyncedChanges] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [peek, setPeek] = useState<CalendarPeek | null>(null)
  const [peekLoading, setPeekLoading] = useState(false)
  /** 日曆行程 → 提醒的掃描狀態（`null` ＝ 還沒掃或模組未啟用） */
  const [reminderSync, setReminderSync] = useState<{ busy: boolean; text: string } | null>(null)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const cal = settings?.calendar
  const displayName = cal?.displayName
  const connected = !!displayName

  useEffect(() => {
    if (cal?.clientId) setClientId(cal.clientId)
    if (cal?.lookaheadHours) setLookahead(cal.lookaheadHours)
    if (cal?.maxEvents) setMaxEvents(cal.maxEvents)
    setMentionWhenEmpty(cal?.mentionWhenEmpty ?? false)
    setNotifyOnUnsyncedChanges(cal?.notifyOnUnsyncedChanges ?? true)
  }, [cal?.clientId, cal?.lookaheadHours, cal?.maxEvents, cal?.mentionWhenEmpty, cal?.notifyOnUnsyncedChanges])

  // 掛載時補抓一次狀態，避免錯過授權完成的事件
  useEffect(() => {
    window.api.invoke('calendar:get-status').then((status: unknown) => {
      const s = status as { connected: boolean; displayName?: string } | null
      if (s?.connected && s.displayName) setWaiting(false)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (waiting && connected) {
      setWaiting(false)
      setMsg({ type: 'ok', text: `已連結為 ${displayName}` })
    }
  }, [connected, displayName, waiting])

  // 等待授權時每 2 秒主動問一次狀態。
  // 正常情況下 settings:updated 廣播就會讓畫面更新，這只是保險 ——
  // 廣播萬一沒送到，畫面也不該永遠停在「等待授權中」。
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      window.api.invoke('calendar:get-status').then((status: unknown) => {
        const s = status as { connected: boolean; displayName?: string } | null
        if (s?.connected) {
          setWaiting(false)
          setMsg({ type: 'ok', text: s.displayName ? `已連結為 ${s.displayName}` : '已連結' })
        }
      }).catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [waiting])

  // 授權失敗時主程序會推這個事件
  useEffect(() => {
    const off = window.api.on('calendar:auth-error', (...args: unknown[]) => {
      setWaiting(false)
      setMsg({ type: 'err', text: String(args[0] ?? '授權失敗') })
    })
    return off
  }, [])

  async function handleConnect() {
    const id = clientId.trim()
    if (!id) { setMsg({ type: 'err', text: '請輸入 Client ID' }); return }
    setMsg(null)
    setWaiting(true)
    const res = await window.api.invoke('calendar:start-auth', {
      clientId: id,
      clientSecret: clientSecret.trim()
    }) as { ok: boolean; error?: string }
    if (!res?.ok) {
      setWaiting(false)
      setMsg({ type: 'err', text: res?.error ?? '無法開始授權' })
    }
  }

  async function handleDisconnect() {
    setMsg(null)
    setWaiting(false)
    setPeek(null)          // 舊的讀取結果不該留在畫面上
    setClientSecret('')
    await window.api.invoke('calendar:disconnect')
    setMsg({ type: 'ok', text: '已斷開連結。要重新連結的話，密鑰請再貼一次。' })
  }

  const refreshPeek = useCallback(async () => {
    setPeekLoading(true)
    try {
      setPeek(await window.api.invoke('calendar:peek') as CalendarPeek)
    } catch (e) {
      setPeek({
        configured: false, authenticated: false, enabled: false,
        lookaheadHours: 0, events: null, injectionText: null,
        fetchedAt: Date.now(), error: String(e)
      })
    } finally {
      setPeekLoading(false)
    }
  }, [])

  // 連結成功後自動查一次，讓使用者當場看到有沒有讀到東西
  useEffect(() => {
    if (connected) void refreshPeek()
  }, [connected, refreshPeek])

  /**
   * 把日曆行程掃成提醒（跟上面的 `refreshPeek` 是兩件完全不同的事）。
   *
   * owner 2026-08-25 實測踩到：他先來這個視窗按了「重新讀取」，以為提醒就同步好了，
   * 結果那顆只是重抓「聊天時要附給角色的行程摘要」，提醒的掃描在另一個視窗，
   * 等他想到要去按的時候第一筆提醒的時間已經過了。設計文件 §3.3 本來就警告過
   * 「抓取行程」與「產生提醒」是兩個動作、按鈕文案要能區分，實際上還是混淆了。
   *
   * 而且更早的問題是：**授權成功後根本沒有人掃過**——新使用者連好 Google 日曆，
   * 要等下一次開機或 8 小時後的定時掃描才會有提醒。
   */
  const scanReminders = useCallback(async () => {
    setReminderSync({ busy: true, text: '' })
    try {
      const r = await window.api.invoke('calendar:scan-reminders-now') as
        { created: number; updated: number; deleted: number } | { error: string } | null
      // null ＝ 模組沒啟用或沒授權，這時候不該顯示「同步完成」誤導人
      if (!r) { setReminderSync(null); return }
      if ('error' in r) { setReminderSync({ busy: false, text: `同步失敗：${r.error}` }); return }
      const total = r.created + r.updated + r.deleted
      setReminderSync({
        busy: false,
        text: total === 0
          ? '已是最新，沒有需要變更的提醒'
          : `已更新：新增 ${r.created}、修改 ${r.updated}、移除 ${r.deleted}`
      })
    } catch (e) {
      setReminderSync({ busy: false, text: `同步失敗：${String(e)}` })
    }
  }, [])

  // 一進到這個視窗就掃一次；`connected` 從 false 翻 true 也會觸發，
  // 所以「剛授權完成」那一刻同樣涵蓋到了，不必另外接授權完成的事件。
  useEffect(() => {
    if (connected) void scanReminders()
  }, [connected, scanReminders])

  async function saveOptions(next: Partial<{
    lookaheadHours: number; maxEvents: number; mentionWhenEmpty: boolean; notifyOnUnsyncedChanges: boolean
  }>) {
    await window.api.invoke('calendar:save-options', next)
    // 區間／筆數會改變抓取結果，存完立刻重查
    void refreshPeek()
  }

  function handleClose() {
    window.api.invoke('calendar:close-settings')
  }

  return (
    <div className="w-full h-full flex flex-col bg-surface rounded-2xl overflow-hidden select-none">
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-mint-40 border-b border-border shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-semibold text-primary">Google 日曆設定</span>
        <button
          type="button"
          className="w-6 h-6 rounded-full flex items-center justify-center text-secondary hover:bg-mint transition-all text-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={handleClose}
        >✕</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* 教學入口：放最上面，第一次設定的人一開窗就看得到 */}
        <button
          type="button"
          className="w-full text-sm px-4 py-2.5 rounded-2xl bg-mint-40 border border-border text-primary font-medium hover:bg-mint transition-all text-left"
          onClick={() => void window.api.invoke('shell:open-doc', 'google-calendar-setup.html')}
        >
          📖 開啟設定教學
          <span className="block text-[11px] text-secondary font-normal mt-0.5">
            第一次設定請先看這份，約 10 分鐘。含「發布應用程式」步驟 —— 沒做的話授權每 7 天會失效
          </span>
        </button>

        {/* Status */}
        <div className="rounded-xl bg-mint-40 border border-border p-4 space-y-1">
          <p className="text-xs font-medium text-secondary">連線狀態</p>
          {connected ? (
            <p className="text-sm text-primary font-semibold">已連結：{displayName}</p>
          ) : waiting ? (
            <p className="text-sm text-secondary">等待 Google 授權中…請在瀏覽器完成登入</p>
          ) : (
            <p className="text-sm text-secondary">未連結</p>
          )}
        </div>

        {/* 日曆提醒：跟下面的「目前讀到的內容」是兩件事，所以獨立一塊放在最上面 */}
        {connected && (
          <div className="rounded-xl bg-mint-40 border border-border p-4 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-secondary">日曆提醒</p>
              <button
                type="button"
                className="text-[11px] px-3 py-1 rounded-full border border-border text-secondary hover:bg-mint transition-all disabled:opacity-50"
                disabled={reminderSync?.busy}
                onClick={() => void scanReminders()}
                title="重新把日曆行程自帶的提醒設定轉成 DeST 提醒"
              >
                {reminderSync?.busy ? '同步中…' : '再同步一次'}
              </button>
            </div>
            <p className="text-sm text-primary">
              {reminderSync?.busy ? '正在把日曆行程轉成提醒…' : reminderSync?.text || '—'}
            </p>
            <p className="text-[11px] text-secondary">
              每次開啟這個視窗都會自動同步一次。要新增或取消提醒請回 Google 日曆設定。
            </p>
            <button
              type="button"
              className="w-full text-xs px-4 py-2 mt-1 rounded-xl bg-surface border border-border text-primary font-medium hover:bg-mint transition-all"
              onClick={() => void window.api.invoke('reminder:open-manager-calendar')}
            >
              開啟提醒清單 →
              <span className="block text-[11px] text-secondary font-normal mt-0.5">
                直接跳到「日曆同步」分頁，看有哪些提醒、分別排在什麼時候
              </span>
            </button>
          </div>
        )}

        {/* Credentials */}
        {!connected && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-secondary block">Client ID</label>
            <input
              type="text"
              className="input-field w-full text-sm font-mono"
              placeholder="貼上你的 Client ID"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              disabled={waiting}
            />
            <label className="text-xs font-medium text-secondary block pt-1">Client 密鑰</label>
            <input
              type="password"
              className="input-field w-full text-sm font-mono"
              placeholder="貼上同一組的 Client secret"
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              disabled={waiting}
            />
            <div className="text-[11px] text-secondary leading-relaxed space-y-1 pt-1">
              <p>在 Google Cloud Console 依序完成：</p>
              <p>1. 建立專案 → 「API 和服務」啟用 <span className="font-mono text-primary">Google Calendar API</span> 與 <span className="font-mono text-primary">Google Tasks API</span>（兩個都要）</p>
              <p>2. 「OAuth 同意畫面」選外部，把自己加入測試使用者</p>
              <p>3. 「憑證」建立 OAuth 用戶端 ID，類型選<span className="text-primary font-medium">桌面應用程式</span></p>
              <p>4. 把顯示的 Client ID 與密鑰貼到上面</p>
              <p className="pt-1">回呼網址由 DeST 自動處理，不需要自己填。</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {!connected ? (
            <button
              type="button"
              disabled={waiting || !clientId.trim()}
              className="text-sm px-4 py-2 rounded-full bg-mint text-primary font-semibold hover:bg-mint-40 border border-border transition-all disabled:opacity-50"
              onClick={handleConnect}
            >
              {waiting ? '等待授權…' : '連結 Google 帳號'}
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

        {/* Options */}
        {connected && (
          <div className="border-t border-border pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-secondary flex-1">往後看幾小時的行程</label>
              <input
                type="number"
                min={1}
                max={168}
                className="input-field w-20 text-sm text-right"
                value={lookahead}
                onChange={e => setLookahead(Number(e.target.value))}
                onBlur={() => saveOptions({ lookaheadHours: lookahead })}
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-secondary flex-1">最多帶入幾則</label>
              <input
                type="number"
                min={1}
                max={20}
                className="input-field w-20 text-sm text-right"
                value={maxEvents}
                onChange={e => setMaxEvents(Number(e.target.value))}
                onBlur={() => saveOptions({ maxEvents })}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mentionWhenEmpty}
                onChange={e => {
                  setMentionWhenEmpty(e.target.checked)
                  saveOptions({ mentionWhenEmpty: e.target.checked })
                }}
              />
              <span className="text-xs text-secondary">沒有行程時也告訴角色（會多花一點 token）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={notifyOnUnsyncedChanges}
                onChange={e => {
                  setNotifyOnUnsyncedChanges(e.target.checked)
                  saveOptions({ notifyOnUnsyncedChanges: e.target.checked })
                }}
              />
              <span className="text-xs text-secondary">行事曆有更新時提醒我同步到手機</span>
            </label>
          </div>
        )}

        {/* 讀取結果：所見即角色會拿到的內容 */}
        {connected && (
          <div className="border-t border-border pt-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-secondary">聊天時附給角色的行程摘要</p>
              <button
                type="button"
                className="text-[11px] px-3 py-1 rounded-full border border-border text-secondary hover:bg-mint-40 transition-all disabled:opacity-50"
                disabled={peekLoading}
                onClick={() => void refreshPeek()}
                title="略過快取重新向日曆查詢，只影響下面這段預覽"
              >
                {peekLoading ? '讀取中…' : '重新讀取'}
              </button>
            </div>
            {/* 這行是為了不要再跟上面的「日曆提醒」搞混（owner 2026-08-25 實測踩過） */}
            <p className="text-[11px] text-secondary">
              這是聊天時會附給角色參考的行程，跟上面的「日曆提醒」是兩回事，不會產生任何提醒。
            </p>

            {peekLoading && !peek && <p className="text-xs text-secondary">讀取中…</p>}

            {peek && (
              <>
                <p className="text-[11px] text-secondary">
                  模組{peek.enabled ? '已啟用' : '已停用'}
                  {peek.sceneOverridden && '（目前情境已覆蓋）'}
                  ｜往後 {peek.lookaheadHours} 小時
                </p>
                {peek.error ? (
                  <p className="text-xs text-[#E85D3F]">{peek.error}</p>
                ) : (
                  <pre className="text-[11px] whitespace-pre-wrap break-words bg-mint-40 border border-border rounded-xl p-2 text-primary">
                    {peek.injectionText ?? '（範圍內沒有行程或待辦，因此不會附給角色）'}
                  </pre>
                )}
                {!peek.enabled && !peek.error && (
                  <p className="text-[11px] text-secondary">
                    注意：模組目前停用，即使上面有內容也不會附給角色。
                  </p>
                )}
                <p className="text-[11px] text-secondary leading-relaxed">
                  框裡就是實際會附給角色的原文。這個檢查不會發送訊息，也不會消耗 LLM 費用。
                </p>
              </>
            )}
          </div>
        )}

        {/* Info */}
        <div className="border-t border-border pt-4 space-y-1.5 text-[11px] text-secondary leading-relaxed">
          <p>連結後，對話時會把接下來的行程與待辦附入角色的對話情境，角色就能主動提起。</p>
          <p>日曆上的「工作」屬於 Google Tasks，是另一套 API，所以兩個權限都會要求。</p>
          <p>只會讀取，不會新增、修改或刪除任何內容。</p>
          <p>Token 以系統加密儲存於本機，不會包含在備份或匯出中。</p>
          <p>未連結、離線或授權過期時會自動略過，不影響聊天。</p>
        </div>
      </div>
    </div>
  )
}
