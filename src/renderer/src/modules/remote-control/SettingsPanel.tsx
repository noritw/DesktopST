import { useEffect, useState } from 'react'
import type { Dispatch, DragEvent, ReactNode, SetStateAction } from 'react'
import type { AppSettings, RemoteCapability } from '../../types'

interface SettingsPanelProps {
  draft: AppSettings
  set: (path: string, value: unknown) => void
  setDraft: Dispatch<SetStateAction<AppSettings | null>>
  setDirty: (dirty: boolean) => void
}

interface RemoteLogDevice {
  id: string
  nickname: string
  label?: string
}

const REMOTE_INPUT_CAPABILITIES: RemoteCapability[] = [
  'remote.pointer.click',
  'remote.pointer.scroll',
  'remote.keyboard.type',
  'remote.keyboard.hotkey'
]

const REMOTE_SYSTEM_CAPABILITIES: RemoteCapability[] = [
  'remote.monitor.power',
  'remote.system.shutdown',
  'remote.system.restart'
]

const REMOTE_PROGRAM_CAPABILITIES: RemoteCapability[] = [
  'remote.program.launch',
  'remote.program.close'
]

const REMOTE_CORE_CAPABILITIES: RemoteCapability[] = [
  ...REMOTE_INPUT_CAPABILITIES,
  ...REMOTE_SYSTEM_CAPABILITIES
]

const REMOTE_CONFIRMATION_CAPABILITIES: RemoteCapability[] = [
  ...REMOTE_CORE_CAPABILITIES,
  ...REMOTE_PROGRAM_CAPABILITIES
]

function defaultRemoteControlSettings(): NonNullable<AppSettings['remoteControl']> {
  return {
    enabled: false,
    allowedCapabilities: [],
    requireConfirmation: [],
    allowedDevices: [],
    restrictToAllowedDevices: false,
    logRetention: {
      maxEntries: 500
    },
    enableInputControl: false,
    enableSystemActions: false,
    registeredPrograms: []
  }
}

function setRemoteCapabilityGroup(
  current: NonNullable<AppSettings['remoteControl']>,
  capabilities: RemoteCapability[],
  enabled: boolean
): RemoteCapability[] {
  const next = new Set(current.allowedCapabilities ?? [])
  for (const capability of capabilities) {
    if (enabled) next.add(capability)
    else next.delete(capability)
  }
  return [...next]
}

function setRemoteConfirmationGroup(
  current: NonNullable<AppSettings['remoteControl']>,
  capabilities: RemoteCapability[],
  enabled: boolean
): RemoteCapability[] {
  const next = new Set(current.requireConfirmation ?? [])
  for (const capability of capabilities) {
    if (enabled) next.add(capability)
    else next.delete(capability)
  }
  return [...next]
}

function enableRemoteProgramCapabilities(current: NonNullable<AppSettings['remoteControl']>): void {
  current.enabled = true
  current.enableInputControl = true
  current.enableSystemActions = true
  current.allowedCapabilities = setRemoteCapabilityGroup(current, REMOTE_CORE_CAPABILITIES, true)
  current.allowedCapabilities = setRemoteCapabilityGroup(current, REMOTE_PROGRAM_CAPABILITIES, true)
}

export default function SettingsPanel({ draft, set, setDraft, setDirty }: SettingsPanelProps) {
  const [programPickerMode, setProgramPickerMode] = useState<'start-menu' | 'processes' | null>(null)
  const [programPickerLoading, setProgramPickerLoading] = useState(false)
  const [programPickerItems, setProgramPickerItems] = useState<{ name: string; path: string }[]>([])
  const [programPickerSearch, setProgramPickerSearch] = useState('')
  const [recentDevices, setRecentDevices] = useState<RemoteLogDevice[]>([])

  useEffect(() => {
    let cancelled = false
    window.api.invoke('remote:get-log')
      .then((entries: unknown) => {
        if (cancelled || !Array.isArray(entries)) return
        const seen = new Map<string, RemoteLogDevice>()
        for (const entry of entries) {
          const raw = entry as { deviceId?: unknown; deviceNickname?: unknown; deviceLabel?: unknown }
          if (typeof raw.deviceId !== 'string' || !raw.deviceId) continue
          if (seen.has(raw.deviceId)) continue
          seen.set(raw.deviceId, {
            id: raw.deviceId,
            nickname: typeof raw.deviceNickname === 'string' && raw.deviceNickname ? raw.deviceNickname : '未命名裝置',
            label: typeof raw.deviceLabel === 'string' ? raw.deviceLabel : undefined
          })
        }
        setRecentDevices([...seen.values()])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const mutateRemote = (mutator: (remote: NonNullable<AppSettings['remoteControl']>) => void) => {
    setDirty(true)
    setDraft(prev => {
      if (!prev) return prev
      const next = JSON.parse(JSON.stringify(prev)) as AppSettings
      const remote = {
        ...defaultRemoteControlSettings(),
        ...next.remoteControl
      }
      mutator(remote)
      next.remoteControl = remote
      return next
    })
  }

  const addProgram = async (path: string, fallbackName?: string) => {
    const picked = await window.api.invoke('remote:resolve-program', path) as
      { path: string; defaultName: string; iconDataUrl?: string } | null
    if (!picked) return
    mutateRemote(remote => {
      if (remote.registeredPrograms.some(p => p.path === picked.path)) return
      remote.registeredPrograms.push({
        id: crypto.randomUUID(),
        name: fallbackName ?? picked.defaultName,
        path: picked.path,
        iconDataUrl: picked.iconDataUrl,
        createdAt: Date.now()
      })
      enableRemoteProgramCapabilities(remote)
    })
  }

  const removeDevice = (id: string) => {
    mutateRemote(remote => {
      remote.allowedDevices = remote.allowedDevices.filter(device => device.id !== id)
    })
  }

  const addDevice = (device: RemoteLogDevice) => {
    mutateRemote(remote => {
      if (remote.allowedDevices.some(existing => existing.id === device.id)) return
      remote.allowedDevices.push({
        id: device.id,
        nickname: device.nickname,
        label: device.label,
        createdAt: Date.now()
      })
    })
  }

  const allowedDevices = draft.remoteControl?.allowedDevices ?? []
  const requireConfirmation = draft.remoteControl?.requireConfirmation ?? []
  const allowDeviceIds = new Set(allowedDevices.map(device => device.id))
  const deviceCandidates = recentDevices.filter(device => !allowDeviceIds.has(device.id))
  const mobileEnabled = draft.mobile?.enabled ?? false
  const remoteModuleEnabled = draft.remoteControl?.enabled ?? false
  const remoteControlsAvailable = mobileEnabled && remoteModuleEnabled
  const confirmationSet = new Set(requireConfirmation)
  const remoteConfirmationRequired = REMOTE_CONFIRMATION_CAPABILITIES.some(capability => confirmationSet.has(capability))

  const setMobileEnabled = (enabled: boolean) => {
    set('mobile', { ...(draft.mobile ?? { port: 3721, useTunnel: true }), enabled })
  }

  const setRemoteControlEnabled = (enabled: boolean) => {
    mutateRemote(remote => {
      remote.enabled = enabled
      remote.enableInputControl = enabled
      remote.enableSystemActions = enabled
      remote.allowedCapabilities = setRemoteCapabilityGroup(remote, REMOTE_CORE_CAPABILITIES, enabled)
      if (enabled && remote.registeredPrograms.length > 0) {
        remote.allowedCapabilities = setRemoteCapabilityGroup(remote, REMOTE_PROGRAM_CAPABILITIES, true)
      } else if (!enabled) {
        remote.allowedCapabilities = setRemoteCapabilityGroup(remote, REMOTE_PROGRAM_CAPABILITIES, false)
      }
    })
  }

  const setInputControlEnabled = (enabled: boolean) => {
    mutateRemote(remote => {
      remote.enableInputControl = enabled
      remote.allowedCapabilities = setRemoteCapabilityGroup(remote, REMOTE_INPUT_CAPABILITIES, enabled)
      remote.enabled = enabled || remote.enableSystemActions
    })
  }

  const setSystemActionsEnabled = (enabled: boolean) => {
    mutateRemote(remote => {
      remote.enableSystemActions = enabled
      remote.allowedCapabilities = setRemoteCapabilityGroup(remote, REMOTE_SYSTEM_CAPABILITIES, enabled)
      remote.enabled = remote.enableInputControl || enabled
    })
  }

  const setConfirmationGroup = (capabilities: RemoteCapability[], enabled: boolean) => {
    mutateRemote(remote => {
      remote.requireConfirmation = setRemoteConfirmationGroup(remote, capabilities, enabled)
    })
  }

  const setRemoteConfirmationRequired = (enabled: boolean) => {
    mutateRemote(remote => {
      remote.requireConfirmation = setRemoteConfirmationGroup(remote, REMOTE_CONFIRMATION_CAPABILITIES, enabled)
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium text-secondary">📱 手機遠端對話</p>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={mobileEnabled}
            onChange={e => setMobileEnabled(e.target.checked)}
            className="accent-teal w-4 h-4"
          />
          <span className="text-sm text-primary">啟用手機遠端對話</span>
        </label>
        {mobileEnabled && (
          <div className="ml-6 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.mobile?.useTunnel ?? true}
                onChange={e => set('mobile', { ...(draft.mobile ?? { port: 3721, enabled: true }), useTunnel: e.target.checked })}
                className="accent-teal w-4 h-4"
              />
              <span className="text-sm text-primary">使用 Cloudflare Tunnel（外網可存取）</span>
            </label>
            <p className="text-[11px] text-amber-600 leading-relaxed">
              ⚠️ QR code／配對網址等同能連進這台電腦資料的憑證，請勿截圖外流或分享給不信任的人。
              此選項預設開啟，開啟後手機會透過 relay.nori.tw 讓資料可從網際網路連入（有 token 保護）；
              只想區網內使用請取消勾選。
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-secondary">Port：</span>
              <input
                type="number"
                min={1024}
                max={65535}
                value={draft.mobile?.port ?? 3721}
                onChange={e => set('mobile', { ...(draft.mobile ?? { enabled: true, useTunnel: true }), port: Number(e.target.value) })}
                className="input-field w-24 px-2 py-1"
              />
            </div>
            {/* QR 入口只留「關於」那一個（qr-entry-merge-plan.md Q1／Q2），這裡不重複放。 */}
          </div>
        )}
      </div>

      <fieldset
        disabled={!mobileEnabled}
        className={`space-y-4 transition-opacity ${mobileEnabled ? '' : 'opacity-45 grayscale pointer-events-none'}`}
      >
        <div className="rounded-xl bg-mint-20 border border-border px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-primary">⚠️ 注意</p>
          <p className="text-xs text-secondary leading-relaxed">
            此頁設定手機端能對電腦做的事。白名單有裝置時只允許白名單裝置呼叫 remote API；未設定裝置白名單時，持有存取 token 的裝置都可使用已開啟的能力。
            {!mobileEnabled && <span className="block mt-1 text-amber-600">需先啟用上方的「手機遠端對話」，以下功能才能使用。</span>}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-secondary">權限</p>
          <label className={`flex items-start gap-2 ${mobileEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={remoteModuleEnabled}
            onChange={e => setRemoteControlEnabled(e.target.checked)}
            className="accent-teal w-4 h-4 mt-0.5"
          />
          <span className="text-sm text-primary">
            遙控模組
            <span className="block text-xs text-secondary mt-0.5">開啟時會啟用鍵鼠遙控；關閉時 mobile remote API 會拒絕操作。</span>
          </span>
        </label>
        {false && (
        <label className={`flex items-start gap-2 ${remoteControlsAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <input
            type="checkbox"
            disabled={!remoteControlsAvailable}
            checked={remoteModuleEnabled && (draft.remoteControl?.enableInputControl ?? false)}
            onChange={e => setInputControlEnabled(e.target.checked)}
            className="accent-teal w-4 h-4 mt-0.5"
          />
          <span className="text-sm text-primary">
            允許鍵鼠遙控
            <span className="block text-xs text-secondary mt-0.5">手機端可在截圖上點擊、滾動、輸入文字與送快捷鍵</span>
          </span>
        </label>
        )}
        {false && (
        <label className={`flex items-start gap-2 ${remoteControlsAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
          <input
            type="checkbox"
            disabled={!remoteControlsAvailable}
            checked={remoteModuleEnabled && (draft.remoteControl?.enableSystemActions ?? false)}
            onChange={e => setSystemActionsEnabled(e.target.checked)}
            className="accent-teal w-4 h-4 mt-0.5"
          />
          <span className="text-sm text-primary">
            允許系統動作
            <span className="block text-xs text-secondary mt-0.5">手機端可關閉 / 喚醒螢幕、關機 / 重開機</span>
          </span>
        </label>
        )}
        </div>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium text-secondary">允許裝置</p>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.remoteControl?.restrictToAllowedDevices ?? false}
            onChange={e => mutateRemote(remote => {
              remote.restrictToAllowedDevices = e.target.checked
            })}
            className="accent-teal w-4 h-4 mt-0.5"
          />
          <span className="text-sm text-primary">
            只允許指定裝置使用遙控功能
            <span className="block text-xs text-secondary mt-0.5">
              未勾選時，白名單只作為裝置紀錄；勾選後，未列入的裝置會被 remote API 拒絕。
            </span>
          </span>
        </label>
        {allowedDevices.length === 0 ? (
          <p className="text-xs text-secondary bg-surface border border-border rounded-lg px-3 py-2">
            尚未加入指定裝置；即使開啟限制，在加入裝置前也不會鎖定，避免誤把自己擋在外面。
          </p>
        ) : (
          <div className="space-y-2">
            {allowedDevices.map(device => (
              <div key={device.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-primary truncate">{device.nickname || '未命名裝置'}</p>
                  <p className="text-xs text-secondary truncate">{device.label || device.id}</p>
                  {device.lastSeenAt && (
                    <p className="text-[11px] text-secondary">最後使用：{new Date(device.lastSeenAt).toLocaleString('zh-TW')}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-secondary hover:text-primary"
                  onClick={() => removeDevice(device.id)}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
        {deviceCandidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] text-secondary">可從近期記錄加入白名單</p>
            {deviceCandidates.map(device => (
              <div key={device.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-primary truncate">{device.nickname}</p>
                  <p className="text-xs text-secondary truncate">{device.label || device.id}</p>
                </div>
                <button
                  type="button"
                  className="px-2 py-1 text-xs text-secondary hover:text-primary"
                  onClick={() => addDevice(device)}
                >
                  加入
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <p className="text-xs font-medium text-secondary">需要手機端確認</p>
        <p className="text-xs text-secondary leading-relaxed">
          勾選後，手機頁面送出該類遙控動作前會要求確認；伺服端也會拒絕未帶確認標記的請求。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className={`flex items-start gap-2 ${remoteControlsAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <input
              type="checkbox"
              disabled={!remoteControlsAvailable}
              checked={remoteConfirmationRequired}
              onChange={e => setRemoteConfirmationRequired(e.target.checked)}
              className="accent-teal w-4 h-4 mt-0.5"
            />
            <span className="text-sm text-primary">
              手機端送出動作前要求確認
              <span className="block text-xs text-secondary mt-0.5">勾選後，所有遙控動作送出前都會先確認。</span>
            </span>
          </label>
          {false && (
          <label className={`flex items-start gap-2 ${remoteControlsAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <input
              type="checkbox"
              disabled={!remoteControlsAvailable}
              checked={REMOTE_INPUT_CAPABILITIES.every(capability => confirmationSet.has(capability))}
              onChange={e => setConfirmationGroup(REMOTE_INPUT_CAPABILITIES, e.target.checked)}
              className="accent-teal w-4 h-4 mt-0.5"
            />
            <span className="text-sm text-primary">
              輸入控制
              <span className="block text-xs text-secondary mt-0.5">點擊、捲動、文字輸入與快捷鍵</span>
            </span>
          </label>
          )}
          {false && (
          <label className={`flex items-start gap-2 ${remoteControlsAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <input
              type="checkbox"
              disabled={!remoteControlsAvailable}
              checked={REMOTE_PROGRAM_CAPABILITIES.every(capability => confirmationSet.has(capability))}
              onChange={e => setConfirmationGroup(REMOTE_PROGRAM_CAPABILITIES, e.target.checked)}
              className="accent-teal w-4 h-4 mt-0.5"
            />
            <span className="text-sm text-primary">
              程式啟閉
              <span className="block text-xs text-secondary mt-0.5">啟動或關閉已登錄的程式</span>
            </span>
          </label>
          )}
          {false && (
          <label className={`flex items-start gap-2 ${remoteControlsAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
            <input
              type="checkbox"
              disabled={!remoteControlsAvailable}
              checked={REMOTE_SYSTEM_CAPABILITIES.every(capability => confirmationSet.has(capability))}
              onChange={e => setConfirmationGroup(REMOTE_SYSTEM_CAPABILITIES, e.target.checked)}
              className="accent-teal w-4 h-4 mt-0.5"
            />
            <span className="text-sm text-primary">
              系統動作
              <span className="block text-xs text-secondary mt-0.5">螢幕電源、關機與重新啟動</span>
            </span>
          </label>
          )}
        </div>
      </div>

      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-medium text-secondary">已登錄程式（白名單）</p>
          <div className="flex gap-2">
            {(['start-menu', 'processes'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                className={`px-3 py-1.5 rounded-lg text-xs border ${programPickerMode === mode ? 'bg-mint text-primary border-teal' : 'bg-surface text-primary border-border'}`}
                onClick={async () => {
                  if (programPickerMode === mode) { setProgramPickerMode(null); return }
                  setProgramPickerSearch('')
                  setProgramPickerMode(mode)
                  setProgramPickerLoading(true)
                  const channel = mode === 'start-menu' ? 'remote:list-start-menu' : 'remote:list-processes'
                  const items = await window.api.invoke(channel) as { name: string; path: string }[]
                  setProgramPickerItems(items)
                  setProgramPickerLoading(false)
                }}
              >
                {mode === 'start-menu' ? '開始選單' : '執行中程式'}
              </button>
            ))}
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg text-xs bg-surface text-primary border border-border"
              onClick={async () => {
                const picked = await window.api.invoke('remote:pick-program') as
                  { path: string; defaultName: string; iconDataUrl?: string } | null
                if (picked) await addProgram(picked.path, picked.defaultName)
              }}
            >
              瀏覽檔案
            </button>
          </div>
        </div>

        {programPickerMode && (
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <div className="p-2 border-b border-border">
              <input
                autoFocus
                type="text"
                placeholder="搜尋..."
                value={programPickerSearch}
                onChange={e => setProgramPickerSearch(e.target.value)}
                className="input-field"
              />
            </div>
            <div className="max-h-52 overflow-y-auto">
              {programPickerLoading ? (
                <p className="text-xs text-secondary text-center py-4">載入中…</p>
              ) : (() => {
                const q = programPickerSearch.toLowerCase()
                const filtered = programPickerItems.filter(i => !q || i.name.toLowerCase().includes(q))
                if (!filtered.length) return <p className="text-xs text-secondary text-center py-4">找不到</p>
                return filtered.map(item => (
                  <button
                    key={item.path}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-mint-20 border-b border-border last:border-b-0"
                    onClick={async () => {
                      setProgramPickerMode(null)
                      await addProgram(item.path, item.name)
                    }}
                  >
                    <p className="text-sm text-primary">{item.name}</p>
                    <p className="text-xs text-secondary font-mono truncate">{item.path}</p>
                  </button>
                ))
              })()}
            </div>
          </div>
        )}

        <ProgramDropZone addProgram={addProgram} hasPrograms={(draft.remoteControl?.registeredPrograms ?? []).length > 0}>
          {(draft.remoteControl?.registeredPrograms ?? []).map((prog, idx) => (
            <div key={prog.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border">
              {prog.iconDataUrl ? (
                <img src={prog.iconDataUrl} alt="" className="w-8 h-8 shrink-0" />
              ) : (
                <div className="w-8 h-8 shrink-0 rounded bg-mint-20" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <input
                  type="text"
                  value={prog.name}
                  onChange={e => {
                    const v = e.target.value
                    mutateRemote(remote => { remote.registeredPrograms[idx].name = v })
                  }}
                  className="input-field !rounded px-2 py-1"
                  placeholder="顯示名稱"
                />
                <p className="text-xs text-secondary font-mono break-all truncate" title={prog.path}>{prog.path}</p>
                <input
                  type="text"
                  value={prog.args ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    mutateRemote(remote => { remote.registeredPrograms[idx].args = v })
                  }}
                  className="input-field !rounded px-2 py-1 !text-xs font-mono"
                  placeholder="啟動參數（選填）"
                />
              </div>
              <button
                type="button"
                className="px-2 py-1 text-xs text-secondary hover:text-primary"
                onClick={() => mutateRemote(remote => { remote.registeredPrograms.splice(idx, 1) })}
              >
                刪除
              </button>
            </div>
          ))}
        </ProgramDropZone>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-secondary">遙控操作記錄</p>
          <button
            type="button"
            className="px-3 py-1.5 rounded-lg text-xs border bg-surface text-primary border-border"
            onClick={() => window.api.invoke('window:open-remote-control-log')}
          >
            查看記錄
          </button>
        </div>
      </div>
      </fieldset>
    </div>
  )
}

function ProgramDropZone({
  addProgram,
  hasPrograms,
  children
}: {
  addProgram: (path: string) => Promise<void>
  hasPrograms: boolean
  children: ReactNode
}) {
  const onDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    delete e.currentTarget.dataset.drag
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) {
      if (!/\.(exe|lnk)$/i.test(f.name)) continue
      await addProgram((f as File & { path: string }).path)
    }
  }

  if (!hasPrograms) {
    return (
      <div
        className="rounded-xl border-2 border-dashed border-border py-6 text-center space-y-1 data-[drag=over]:border-teal data-[drag=over]:bg-mint-20 transition-colors"
        onDragOver={e => { e.preventDefault(); e.currentTarget.dataset.drag = 'over' }}
        onDragLeave={e => { delete e.currentTarget.dataset.drag }}
        onDrop={onDrop}
      >
        <p className="text-sm text-secondary">尚未登錄任何程式</p>
        <p className="text-xs text-secondary opacity-60">把 .exe 或桌面捷徑（.lnk）拖進來，或點上方新增程式</p>
      </div>
    )
  }

  return (
    <div
      className="space-y-2 data-[drag=over]:outline data-[drag=over]:outline-2 data-[drag=over]:outline-teal data-[drag=over]:outline-offset-2 rounded-lg transition-all"
      onDragOver={e => { e.preventDefault(); e.currentTarget.dataset.drag = 'over' }}
      onDragLeave={e => { delete e.currentTarget.dataset.drag }}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}
