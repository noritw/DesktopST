import { useEffect, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Reminder, ReminderSchedule, Character } from '../types'
import { useAppStore } from '../stores/useAppStore'
import MonoIcon from '../components/MonoIcon'

// ── Helpers ───────────────────────────────────────────────

function scheduleLabel(s: ReminderSchedule): string {
  if (s.type === 'startup') return '每次啟動'
  if (s.type === 'daily') {
    const hh = String(s.hour).padStart(2, '0')
    const mm = String(s.minute).padStart(2, '0')
    return `每天 ${hh}:${mm}`
  }
  if (s.type === 'interval') {
    const mins = Math.round(s.intervalMs / 60_000)
    if (mins >= 60 && mins % 60 === 0) return `每 ${mins / 60} 小時`
    if (mins >= 60) return `每 ${(mins / 60).toFixed(1)} 小時`
    return `每 ${mins} 分鐘`
  }
  if (s.type === 'once') {
    const d = new Date(s.at)
    const past = d < new Date()
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return past ? `一次性（已過期）${str}` : `一次性 ${str}`
  }
  return ''
}

function makeDefault(): Reminder {
  return {
    id: uuidv4(),
    label: '',
    prompt: '',
    schedule: { type: 'startup' },
    enabled: true,
    injectPinnedNotes: false,
    createdAt: Date.now()
  }
}

// ── Form component ────────────────────────────────────────

function ReminderForm({
  initial,
  characters,
  onSave,
  onCancel,
  desktopCharacterIds
}: {
  initial: Reminder
  characters: Character[]
  onSave: (r: Reminder) => void
  onCancel: () => void
  desktopCharacterIds: string[]
}) {
  const [label, setLabel] = useState(initial.label)
  const [charId, setCharId] = useState(initial.characterId ?? '')
  const [schedType, setSchedType] = useState<ReminderSchedule['type']>(initial.schedule.type)
  const [dailyTime, setDailyTime] = useState(() => {
    if (initial.schedule.type === 'daily') {
      return `${String(initial.schedule.hour).padStart(2, '0')}:${String(initial.schedule.minute).padStart(2, '0')}`
    }
    return '08:00'
  })
  const [intervalMins, setIntervalMins] = useState(() =>
    initial.schedule.type === 'interval' ? Math.round(initial.schedule.intervalMs / 60_000) : 30
  )
  const [onceAt, setOnceAt] = useState(() => {
    if (initial.schedule.type === 'once') {
      const d = new Date(initial.schedule.at)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0)
    return `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T09:00`
  })
  const [prompt, setPrompt] = useState(initial.prompt)
  const [injectNotes, setInjectNotes] = useState(initial.injectPinnedNotes ?? false)
  const [error, setError] = useState('')

  function buildSchedule(): ReminderSchedule {
    if (schedType === 'startup') return { type: 'startup' }
    if (schedType === 'daily') {
      const [hStr, mStr] = dailyTime.split(':')
      return { type: 'daily', hour: parseInt(hStr ?? '8'), minute: parseInt(mStr ?? '0') }
    }
    if (schedType === 'interval') {
      return { type: 'interval', intervalMs: Math.max(5, intervalMins) * 60_000 }
    }
    return { type: 'once', at: new Date(onceAt).getTime() }
  }

  function handleSave() {
    const trimmed = label.trim()
    if (!trimmed) {
      setError('請填寫提醒名稱')
      return
    }
    if (schedType === 'interval' && intervalMins < 5) {
      setError('間隔時間最短 5 分鐘')
      return
    }
    if (schedType === 'once' && new Date(onceAt) <= new Date()) {
      setError('請設定未來的時間')
      return
    }
    setError('')
    onSave({
      ...initial,
      label: trimmed,
      characterId: charId || undefined,
      schedule: buildSchedule(),
      prompt,
      injectPinnedNotes: injectNotes
    })
  }

  const inputCls = 'w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-teal'
  const labelCls = 'block text-xs font-semibold text-secondary mb-1'

  return (
    <div className="flex flex-col gap-3 p-4">
      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger-border rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div>
        <label className={labelCls}>提醒名稱</label>
        <input
          className={inputCls}
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="例：早安問候、喝水提醒、運動提醒"
          maxLength={40}
        />
      </div>

      <div>
        <label className={labelCls}>由哪個角色說話</label>
        <select className={inputCls} value={charId} onChange={e => setCharId(e.target.value)}>
          <option value="">隨機角色（桌面上有的）</option>
          {characters.filter(c => desktopCharacterIds.includes(c.id)).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelCls}>觸發時機</label>
        <select
          className={inputCls}
          value={schedType}
          onChange={e => setSchedType(e.target.value as ReminderSchedule['type'])}
        >
          <option value="startup">每次啟動程式</option>
          <option value="daily">每天固定時間</option>
          <option value="interval">間隔時間</option>
          <option value="once">一次性</option>
        </select>
      </div>

      {schedType === 'daily' && (
        <div>
          <label className={labelCls}>每天幾點</label>
          <input
            type="time"
            className={inputCls}
            value={dailyTime}
            onChange={e => setDailyTime(e.target.value)}
          />
        </div>
      )}

      {schedType === 'interval' && (
        <div>
          <label className={labelCls}>每隔幾分鐘（最少 5 分鐘）</label>
          <input
            type="number"
            className={inputCls}
            value={intervalMins}
            min={5}
            max={1440}
            onChange={e => setIntervalMins(Math.max(5, parseInt(e.target.value) || 5))}
          />
        </div>
      )}

      {schedType === 'once' && (
        <div>
          <label className={labelCls}>在什麼時候</label>
          <input
            type="datetime-local"
            className={inputCls}
            value={onceAt}
            onChange={e => setOnceAt(e.target.value)}
          />
        </div>
      )}

      <div>
        <label className={labelCls}>自訂指令（選填）</label>
        <textarea
          className={`${inputCls} resize-none`}
          rows={3}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="例：提醒我喝水"
        />
        <p className="text-[11px] text-secondary mt-1">角色說話前會收到這段指令，空白則自然發話。</p>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={injectNotes}
          onChange={e => setInjectNotes(e.target.checked)}
          className="w-4 h-4 accent-teal"
        />
        <span className="text-sm text-primary">參考桌面上的便利貼內容</span>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="flex-1 rounded-full bg-teal text-white text-sm font-semibold py-1.5 hover:opacity-90 transition-opacity"
          onClick={handleSave}
        >
          儲存
        </button>
        <button
          type="button"
          className="flex-1 rounded-full border border-border bg-surface-85 text-sm font-semibold text-primary py-1.5 hover:bg-mint transition-colors"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>
  )
}

// ── Card component ────────────────────────────────────────

function ReminderCard({
  reminder,
  characters,
  onToggle,
  onEdit,
  onDelete
}: {
  reminder: Reminder
  characters: Character[]
  onToggle: (id: string, enabled: boolean) => void
  onEdit: (r: Reminder) => void
  onDelete: (id: string) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const charName = reminder.characterId
    ? characters.find(c => c.id === reminder.characterId)?.name ?? '（已刪除角色）'
    : '隨機角色'

  return (
    <div className={`rounded-xl border p-3 transition-opacity ${reminder.enabled ? 'border-border bg-surface-85' : 'border-border/50 bg-surface-45 opacity-60'}`}>
      <div className="flex items-start gap-2">
        <button
          type="button"
          title={reminder.enabled ? '點選停用' : '點選啟用'}
          onClick={() => onToggle(reminder.id, !reminder.enabled)}
          className={`shrink-0 relative w-10 h-5 rounded-full border-2 transition-all duration-200 ${reminder.enabled ? 'bg-teal border-teal' : 'bg-transparent border-border'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full transition-transform duration-200 ${reminder.enabled ? 'bg-white translate-x-5' : 'bg-border translate-x-0'}`} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-primary truncate">{reminder.label}</div>
          <div className="text-xs text-secondary mt-0.5">{scheduleLabel(reminder.schedule)}</div>
          <div className="text-xs text-secondary">角色：{charName}</div>
          {reminder.injectPinnedNotes && (
            <div className="text-[11px] text-teal mt-0.5">✦ 參考便利貼</div>
          )}
        </div>
        <div className="shrink-0 flex gap-1 items-center">
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded-full bg-surface-80 border border-border-60 text-primary font-semibold hover:bg-mint transition-colors"
            onClick={() => onEdit(reminder)}
          >
            編輯
          </button>
          {confirmDelete ? (
            <span className="flex gap-1">
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 rounded-full bg-danger-soft border border-danger-border text-danger font-semibold"
                onClick={() => onDelete(reminder.id)}
              >
                確定
              </button>
              <button
                type="button"
                className="text-[11px] px-2 py-0.5 rounded-full bg-surface-80 border border-border-60 text-secondary"
                onClick={() => setConfirmDelete(false)}
              >
                取消
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="w-5 h-5 rounded-full bg-surface-60 border border-border/60 text-secondary hover:text-danger hover:bg-danger-soft flex items-center justify-center transition-colors"
              onClick={() => setConfirmDelete(true)}
              title="刪除提醒"
            >
              <MonoIcon name="trash" className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main window ───────────────────────────────────────────

export default function RemindersManagerWindow() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [editing, setEditing] = useState<Reminder | null>(null)
  const [adding, setAdding] = useState(false)
  const desktopCharacters = useAppStore(s => s.desktopCharacters ?? [])

  const reload = async () => {
    const list = await window.api.invoke('reminder:list') as Reminder[]
    setReminders(list ?? [])
  }

  useEffect(() => {
    reload()
    window.api.invoke('characters:list').then(list => setCharacters((list as Character[]) ?? []))
    const unsubUpdated = window.api.on('reminders:updated', () => reload())
    const unsubNew = window.api.on('reminder:trigger-new', () => setAdding(true))
    return () => { unsubUpdated(); unsubNew() }
  }, [])

  const handleToggle = async (id: string, enabled: boolean) => {
    await window.api.invoke('reminder:toggle', id, enabled)
    await reload()
  }

  const handleSave = async (r: Reminder) => {
    await window.api.invoke('reminder:save', r)
    setAdding(false)
    setEditing(null)
    await reload()
  }

  const handleDelete = async (id: string) => {
    await window.api.invoke('reminder:delete', id)
    await reload()
  }

  const handleClose = () => window.api.invoke('window:close-self').catch(console.error)

  const showForm = adding || editing !== null
  const formData = editing ?? makeDefault()

  return (
    <div className="relative w-full h-full flex flex-col bg-bg border border-border rounded-2xl overflow-hidden shadow-panel">
      <div className="drag-region absolute left-0 right-0 top-0 h-12" />

      {/* Header */}
      <div className="drag-region relative flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MonoIcon name="notes" className="w-4 h-4 text-secondary shrink-0" />
          <span className="text-sm font-bold text-primary truncate">提醒管理</span>
          {reminders.length > 0 && (
            <span className="text-xs text-secondary bg-mint-20 rounded-full px-2 py-0.5 shrink-0">
              {reminders.length} 則
            </span>
          )}
        </div>
        <button
          type="button"
          className="no-drag w-6 h-6 rounded-full border border-border bg-surface text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
          onClick={handleClose}
          title="關閉"
        >
          <MonoIcon name="close" className="w-3 h-3" />
        </button>
      </div>

      {/* Toolbar */}
      {!showForm && (
        <div className="no-drag flex items-center gap-2 px-3 py-2 border-b border-border bg-surface-45 shrink-0">
          <button
            type="button"
            className="rounded-full border border-border bg-surface-85 px-3 py-1 text-xs font-semibold text-primary hover:bg-mint transition-colors"
            onClick={() => setAdding(true)}
          >
            新增提醒
          </button>
        </div>
      )}

      {/* Form view */}
      {showForm && (
        <div className="no-drag flex-1 min-h-0 overflow-y-auto">
          <div className="text-xs font-semibold text-secondary px-4 pt-3 pb-1 border-b border-border">
            {editing ? '編輯提醒' : '新增提醒'}
          </div>
          <ReminderForm
            initial={formData}
            characters={characters}
            onSave={handleSave}
            onCancel={() => { setAdding(false); setEditing(null) }}
            desktopCharacterIds={desktopCharacters.map(d => d.characterId)}
          />
        </div>
      )}

      {/* List view */}
      {!showForm && (
        <div className="no-drag flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
          {reminders.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-secondary py-12">
              <MonoIcon name="notes" className="w-10 h-10 opacity-30" />
              <p className="text-sm">目前沒有提醒</p>
              <p className="text-xs opacity-70">點選「新增提醒」來設定角色定時說話。</p>
            </div>
          )}
          {reminders.map(r => (
            <ReminderCard
              key={r.id}
              reminder={r}
              characters={characters}
              onToggle={handleToggle}
              onEdit={r => setEditing(r)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  )
}
