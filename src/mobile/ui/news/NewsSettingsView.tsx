import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import MonoIcon from '@shared/MonoIcon'
import type { NewsEditableSettings, NewsScheduleSnapshot } from '@core/data'
import type { NewsSource, SpeakMode } from '@core/news/types'
import type { ReminderSchedule } from '@core/types'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeNewsError, useNewsStore } from './newsStore'
import { BREAKOUT_SECTION_ID } from '@core/news/reader'

/**
 * 新聞設定（清單 6.1 最後一項：黑名單、訂閱來源、排程）。
 *
 * ## 範圍刻意小
 *
 * 語言處理、破圈、地方新聞、學習權重那些留在桌面設定面板 ——
 * 手機上要的是「這個詞我不想再看到」「加一個 RSS」「說點什麼要不要抓新聞」
 * 這種站在路口就會想做的事（roadmap §2 目標 4：進階的不要擠進第一層）。
 * 模組總開關在「設定 → 模組開關」，這裡只顯示狀態不重複放一顆。
 *
 * ⚠️ **興趣關鍵字的新增／刪除／排序／分組已搬到「個人新聞報 → 管理關鍵字」**
 * （`NewsKeywordsPanel.tsx`，owner 2026-08-06 回報後合併）——原本這裡與那邊
 * 各自維護一份 `sources`，兩處都各自送整個陣列存檔，前後腳存檔會互相蓋過去
 * （「點頻率所有關鍵字一起被改掉」就是這樣來的）。**不要在這裡加回關鍵字管理**，
 * 只留一個地方能動 `sources` 才是真正解法，不是加防呆。
 *
 * ## 寫回方式
 *
 * 每次改動都直接送出（沒有「儲存」按鈕），失敗就退回原狀並 toast ——
 * 與角色卡編輯器那種「有草稿要存」的畫面不同，這裡每一項都是獨立的小開關。
 */

const SPEAK_OPTIONS: { value: SpeakMode; label: string; hint: string }[] = [
  { value: 'off', label: '不抓新聞', hint: '只會閒聊，不帶新聞話題' },
  { value: 'sometimes', label: '偶爾（推薦）', hint: '有時閒聊、有時帶一則新聞' },
  { value: 'always', label: '每次', hint: '每次都會挑一則新聞來聊' }
]

const LS_BREAKOUT_MEMO = 'desktopst.mobileReader.breakoutQuotaMemo'

/** 關掉熱門話題前記住的則數，打開時還原。存不了就回預設 3。 */
function readBreakoutMemo(): number {
  try {
    const n = Number(localStorage.getItem(LS_BREAKOUT_MEMO))
    return Number.isFinite(n) && n >= 1 && n <= 20 ? Math.floor(n) : 3
  } catch {
    return 3
  }
}

function writeBreakoutMemo(n: number): void {
  try {
    localStorage.setItem(LS_BREAKOUT_MEMO, String(n))
  } catch {
    /* 只是偏好 */
  }
}

export function NewsSettingsView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const [settings, setSettings] = useState<NewsEditableSettings | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setSettings(await getData().news.getSettings())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 熱門話題的開關。
   *
   * 背後就是把那一欄的配額設成 0 —— `setReaderQuota` 對 `__breakout__` 本來就
   * 允許 0（其他欄最低是 1），配額 0 的欄取不到東西也就不會顯示。
   * 這裡只是把這件**本來就做得到、但完全沒地方看得出來**的事變成一顆開關
   * （owner 2026-08-12：「熱門話題可以自己選擇開啟關閉嗎」）。
   *
   * 走 `useNewsStore` 而不是這頁自己的 `settings`：`readerBreakoutQuota` 不在
   * `NewsEditableSettings` 裡，而新聞報那份 store 本來就有，也才會即時反映到欄位上。
   */
  const breakoutQuota = useNewsStore((s) => s.readerBreakoutQuota)
  const setQuota = useNewsStore((s) => s.setQuota)
  const [breakoutBusy, setBreakoutBusy] = useState(false)
  const breakoutOn = breakoutQuota > 0

  const toggleBreakout = async (): Promise<void> => {
    setBreakoutBusy(true)
    try {
      // 關掉前記住則數，打開時還原（一律回 3 的話使用者調過的設定會被吃掉）
      if (breakoutOn) {
        writeBreakoutMemo(breakoutQuota)
        await setQuota(BREAKOUT_SECTION_ID, 0)
      } else {
        await setQuota(BREAKOUT_SECTION_ID, readBreakoutMemo())
      }
    } finally {
      setBreakoutBusy(false)
    }
  }

  /** 送出一個 partial；成功後以電腦端正規化過的結果為準（新來源的 id 就是這樣拿到的）。 */
  const save = async (
    patch: Partial<Omit<NewsEditableSettings, 'enabled'>>,
    action: string
  ): Promise<boolean> => {
    if (!settings) return false
    const prev = settings
    setSettings({ ...settings, ...patch } as NewsEditableSettings)
    setBusy(true)
    try {
      setSettings(await getData().news.saveSettings(patch))
      return true
    } catch (e) {
      setSettings(prev)
      toast(describeNewsError(e, action), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入新聞設定失敗</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]">
          重試
        </button>
      </div>
    )
  }

  if (!settings) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  const feeds = settings.sources.filter((s) => s.type === 'rss' || s.type === 'json')

  const replaceSource = (id: string, next: NewsSource | null, action: string): void => {
    const sources = next
      ? settings.sources.map((s) => (s.id === id ? next : s))
      : settings.sources.filter((s) => s.id !== id)
    void save({ sources }, action)
  }

  return (
    <div className="space-y-2 pb-2">
      {!settings.enabled && (
        <p className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-sub)]">
          新聞模組目前是關閉的，這裡改的設定會在打開之後生效。開關在「設定 → 模組開關」。
        </p>
      )}

      {/* ── 說點什麼／陪聊頻率 ───────────────────────────── */}
      <Section title="說點什麼時抓新聞" hint="按桌面「說點什麼」或手機叫角色發言時">
        <div className="space-y-1.5">
          {SPEAK_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={busy}
              onClick={() => void save({ speakButton: opt.value }, '設定陪聊頻率')}
              className={`flex w-full flex-col rounded-[14px] border px-3 py-2 text-left disabled:opacity-50 ${
                settings.speakButton === opt.value
                  ? 'border-[var(--mint2)] bg-[var(--mint)]'
                  : 'border-[var(--border)] bg-[var(--bg)]'
              }`}
            >
              <span className="text-sm text-[var(--text)]">{opt.label}</span>
              <span className="text-[11px] text-[var(--text-sub)]">{opt.hint}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* ── 熱門話題 ───────────────────────────────────── */}
      <Section title="熱門話題" hint="不跟著你的關鍵字，抓當下比較多人在看的">
        <button
          type="button"
          disabled={breakoutBusy}
          onClick={() => void toggleBreakout()}
          className={`flex w-full items-center justify-between rounded-[14px] border px-3 py-2 text-left disabled:opacity-50 ${
            breakoutOn ? 'border-[var(--mint2)] bg-[var(--mint)]' : 'border-[var(--border)] bg-[var(--bg)]'
          }`}
        >
          <span className="text-sm text-[var(--text)]">在新聞報顯示熱門話題</span>
          <span className="text-[11px] text-[var(--text-sub)]">{breakoutOn ? `${breakoutQuota} 則` : '關閉'}</span>
        </button>
        <Note>
          {breakoutOn
            ? '則數在新聞報那一欄的數字框調整。'
            : '關掉之後新聞報就不會出現「🔥 熱門話題」這一欄。'}
        </Note>
      </Section>

      <p className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-relaxed text-[var(--text-sub)]">
        興趣關鍵字（新增、排序、分組、頻率）改到上一頁「管理關鍵字」。
      </p>

      {/* ── 黑名單 ─────────────────────────────────────── */}
      <Section title="黑名單" hint="標題或摘要出現這些字就不收">
        {settings.blacklist.length === 0 ? (
          <Note>目前沒有封鎖任何字。</Note>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {settings.blacklist.map((word) => (
              <button
                key={word}
                type="button"
                disabled={busy}
                onClick={() => void save({ blacklist: settings.blacklist.filter((w) => w !== word) }, '移除黑名單')}
                className="flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border)] px-3 text-[12px] text-[var(--text-sub)] disabled:opacity-50"
              >
                {word}
                <MonoIcon name="close" className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
        <AddRow
          placeholder="新增封鎖字詞"
          busy={busy}
          onAdd={(text) => {
            if (settings.blacklist.includes(text)) return
            void save({ blacklist: settings.blacklist.concat([text]) }, '新增黑名單')
          }}
        />
      </Section>

      {/* ── 對話新聞搜尋 ───────────────────────────────── */}
      <Section title="對話新聞搜尋" hint="聊天問到時事時，回覆前先即時查一下 Google 新聞">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void save(
              { conversationSearch: { ...settings.conversationSearch, enabled: !settings.conversationSearch.enabled } },
              '設定對話新聞搜尋'
            )
          }
          className={`flex w-full items-center justify-between rounded-[14px] border px-3 py-2 text-left disabled:opacity-50 ${
            settings.conversationSearch.enabled ? 'border-[var(--mint2)] bg-[var(--mint)]' : 'border-[var(--border)] bg-[var(--bg)]'
          }`}
        >
          <span className="text-sm text-[var(--text)]">開啟</span>
          <span className="text-[11px] text-[var(--text-sub)]">{settings.conversationSearch.enabled ? '已開啟' : '已關閉'}</span>
        </button>

        <div>
          <p className="text-[12px] text-[var(--text-sub)]">觸發詞（訊息含任一詞才會判斷是否搜尋；清空＝每則都判斷）</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {settings.conversationSearch.triggerWords.length === 0 && <Note>目前無觸發詞，每則訊息都會送去判斷。</Note>}
            {settings.conversationSearch.triggerWords.map((word) => (
              <button
                key={word}
                type="button"
                disabled={busy}
                onClick={() =>
                  void save(
                    {
                      conversationSearch: {
                        ...settings.conversationSearch,
                        triggerWords: settings.conversationSearch.triggerWords.filter((w) => w !== word)
                      }
                    },
                    '移除觸發詞'
                  )
                }
                className="flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border)] px-3 text-[12px] text-[var(--text-sub)] disabled:opacity-50"
              >
                {word}
                <MonoIcon name="close" className="h-3 w-3" />
              </button>
            ))}
          </div>
          <div className="mt-1.5">
            <AddRow
              placeholder="新增觸發詞"
              busy={busy}
              onAdd={(text) => {
                if (settings.conversationSearch.triggerWords.includes(text)) return
                void save(
                  {
                    conversationSearch: {
                      ...settings.conversationSearch,
                      triggerWords: settings.conversationSearch.triggerWords.concat([text])
                    }
                  },
                  '新增觸發詞'
                )
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-sub)]">只收幾小時內的新聞（0＝不限制）</span>
          <NumberField
            label="小時"
            value={settings.conversationSearch.maxAgeHours}
            min={0}
            max={168}
            onChange={(n) =>
              void save(
                { conversationSearch: { ...settings.conversationSearch, maxAgeHours: n } },
                '設定新聞時效'
              )
            }
          />
        </div>
      </Section>

      {/* ── 訂閱來源 ───────────────────────────────────── */}
      <Section title="訂閱來源" hint="RSS 或 JSON 聚合站，與關鍵字並存">
        {feeds.length === 0 && <Note>還沒有訂閱來源。</Note>}
        {feeds.map((src) => (
          <div key={src.id} className="flex items-center gap-2 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2">
            <input
              type="checkbox"
              checked={src.enabled}
              aria-label={`啟用 ${src.label}`}
              onChange={() => replaceSource(src.id, { ...src, enabled: !src.enabled }, '切換來源')}
              className="h-4 w-4 shrink-0 accent-[var(--mint2)]"
            />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm ${src.enabled ? 'text-[var(--text)]' : 'text-[var(--text-sub)]'}`}>{src.label}</p>
              <p className="truncate text-[11px] text-[var(--text-sub)]">{src.url}</p>
            </div>
            <DeleteButton label={src.label} onConfirm={() => replaceSource(src.id, null, '刪除來源')} confirm={confirm} />
          </div>
        ))}
        <FeedAddForm
          busy={busy}
          onAdd={(label, url, type) =>
            void save(
              {
                sources: settings.sources.concat([
                  { type, label, url, weight: 'normal', enabled: true, origin: 'user' } as NewsSource
                ])
              },
              '新增來源'
            )
          }
        />
      </Section>

      {/* ── 定時陪聊 ───────────────────────────────────── */}
      <Section title="定時新聞陪聊" hint="時間到了讓角色主動挑一則新聞聊">
        <ScheduleFields />
      </Section>
    </div>
  )
}

/**
 * 定時排程。
 *
 * 與桌面設定面板同一份資料（`scheduler.ts`）：桌面選了每天 9:00，
 * 手機打開這裡看到的就是每天 9:00，不是另一套排程。
 */
function ScheduleFields(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const [state, setState] = useState<NewsScheduleSnapshot | null>(null)
  const [kind, setKind] = useState<'daily' | 'interval'>('daily')
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(0)
  const [intervalHours, setIntervalHours] = useState(3)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const s = await getData().news.getSchedule()
        setState(s)
        if (s.schedule?.type === 'daily') {
          setKind('daily'); setHour(s.schedule.hour); setMinute(s.schedule.minute)
        } else if (s.schedule?.type === 'interval') {
          setKind('interval'); setIntervalHours(Math.max(1, Math.round(s.schedule.intervalMs / 3_600_000)))
        }
      } catch {
        setState({ enabled: false })
      }
    })()
  }, [])

  if (!state) return <Note>載入中⋯⋯</Note>

  const apply = async (enabled: boolean): Promise<void> => {
    const schedule: ReminderSchedule | undefined = enabled
      ? kind === 'daily'
        ? { type: 'daily', hour, minute }
        : { type: 'interval', intervalMs: intervalHours * 3_600_000 }
      : undefined
    setBusy(true)
    try {
      await getData().news.setSchedule({ enabled, schedule })
      setState({ enabled, schedule })
      toast(enabled ? '排程已套用' : '排程已關閉')
    } catch (e) {
      toast(describeNewsError(e, '設定排程'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-[var(--text)]">
        <input
          type="checkbox"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void apply(e.target.checked)}
          className="h-4 w-4 accent-[var(--mint2)]"
        />
        啟用定時新聞陪聊
      </label>

      {state.enabled && (
        <div className="space-y-2 pl-6">
          <div className="flex gap-1.5">
            <TinyToggle label="每天固定時間" on={kind === 'daily'} onClick={() => setKind('daily')} />
            <TinyToggle label="每隔幾小時" on={kind === 'interval'} onClick={() => setKind('interval')} />
          </div>
          {kind === 'daily' ? (
            <div className="flex items-center gap-2">
              <NumberField label="時" value={hour} min={0} max={23} onChange={setHour} />
              <span className="text-[var(--text-sub)]">:</span>
              <NumberField label="分" value={minute} min={0} max={59} onChange={setMinute} />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[var(--text-sub)]">每隔</span>
              <NumberField label="小時" value={intervalHours} min={1} max={24} onChange={setIntervalHours} />
              <span className="text-[12px] text-[var(--text-sub)]">小時觸發一次</span>
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply(true)}
            className="rounded-full bg-[var(--mint)] px-4 py-2 text-[13px] text-[var(--text)] disabled:opacity-50"
          >
            {busy ? '儲存中⋯⋯' : '套用排程'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── 小元件 ──────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }): JSX.Element {
  return (
    <section className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <h3 className="text-sm font-medium text-[var(--text)]">{title}</h3>
      <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">{hint}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  )
}

function Note({ children }: { children: ReactNode }): JSX.Element {
  return <p className="text-[12px] text-[var(--text-sub)]">{children}</p>
}

function AddRow({
  placeholder, busy, onAdd
}: {
  placeholder: string
  busy: boolean
  onAdd: (text: string) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setText('')
  }
  return (
    <div className="flex gap-2">
      <input
        className="field flex-1"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // ⚠️ 組字中（注音／拼音）的 Enter 是「選字」不是「送出」，
          // 不擋的話打「獨立遊戲」會在選字時就送出半個詞。
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={submit}
        aria-label="新增"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)] disabled:opacity-50"
      >
        <MonoIcon name="plus" className="h-4 w-4" />
      </button>
    </div>
  )
}

function FeedAddForm({
  busy, onAdd
}: {
  busy: boolean
  onAdd: (label: string, url: string, type: 'rss' | 'json') => void
}): JSX.Element {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [type, setType] = useState<'rss' | 'json'>('rss')

  return (
    <div className="space-y-2 rounded-[14px] border border-dashed border-[var(--border)] p-2.5">
      <input className="field" value={label} placeholder="來源名稱" onChange={(e) => setLabel(e.target.value)} />
      <input className="field" value={url} placeholder="https://example.com/feed.xml" inputMode="url" onChange={(e) => setUrl(e.target.value)} />
      <div className="flex items-center gap-1.5">
        <TinyToggle label="RSS" on={type === 'rss'} onClick={() => setType('rss')} />
        <TinyToggle label="JSON" on={type === 'json'} onClick={() => setType('json')} />
        <button
          type="button"
          disabled={busy || !label.trim() || !url.trim()}
          onClick={() => {
            onAdd(label.trim(), url.trim(), type)
            setLabel('')
            setUrl('')
          }}
          className="ml-auto rounded-full bg-[var(--mint)] px-4 py-2 text-[13px] text-[var(--text)] disabled:opacity-50"
        >
          新增來源
        </button>
      </div>
    </div>
  )
}

function TinyToggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[12px] ${
        on ? 'border-[var(--mint2)] bg-[var(--mint)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-sub)]'
      }`}
    >
      {label}
    </button>
  )
}

function NumberField({
  label, value, min, max, onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}): JSX.Element {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Math.floor(Number(e.target.value)) || min)))}
      className="h-11 w-16 rounded-[14px] border border-[var(--border)] bg-[var(--bg)] text-center text-[16px] text-[var(--text)]"
    />
  )
}

/** 刪除一律先問。清單列上不放刪除是別的畫面的慣例，但這裡每一列本身就是一個小設定項。 */
function DeleteButton({
  label, onConfirm, confirm
}: {
  label: string
  onConfirm: () => void
  confirm: (opts: { title: string; message?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`刪除 ${label}`}
      onClick={() => {
        void confirm({
          title: `刪除「${label}」？`,
          message: '之後不會再用這一項抓新聞。可以再加回來。',
          confirmLabel: '刪除',
          destructive: true
        }).then((ok) => {
          if (ok) onConfirm()
        })
      }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--text-sub)] active:bg-[var(--border)]"
    >
      <MonoIcon name="trash" className="h-4 w-4" />
    </button>
  )
}
