import { useCallback, useEffect, useState } from 'react'
import type { LlmProvider, LlmSettingsSnapshot, MemorySettingsSnapshot, ModuleToggle } from '@core/data'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from './settingsErrors'
import { PROVIDERS, PROVIDER_KEY_PLACEHOLDER, PROVIDER_LABELS, PROVIDER_MODEL_SUGGESTIONS } from './providerInfo'

/**
 * 設定（B3 階段 4）。
 *
 * 依 §2 目標 4 分兩層：第一層只有「供應商／模型／API Key」，
 * 其餘（endpoint、記憶參數、模組開關、提醒）收進「進階」摺疊區——
 * 新安裝的使用者不必先看懂這些名詞才能開始聊天。
 */
export function SettingsView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const push = useUiStore((s) => s.push)

  const [llm, setLlm] = useState<LlmSettingsSnapshot | null>(null)
  const [memory, setMemory] = useState<MemorySettingsSnapshot | null>(null)
  const [modules, setModules] = useState<ModuleToggle[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  // 這個畫面只能透過已就緒之後才會出現的頭像列／設定入口打開，理論上 `getData()`
  // 這時一定接好了；仍然用 try/catch 取而非直接同步呼叫，避免任何時序邊緣情況
  // 讓整個畫面崩掉（`getData()` 沒接上時會 throw）。
  const [apiKeyAccess, setApiKeyAccess] = useState(false)

  const [modelDraft, setModelDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [endpointDraft, setEndpointDraft] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [savingEndpoint, setSavingEndpoint] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setApiKeyAccess(getData().capabilities.apiKeyAccess)
      const [llmData, memoryData] = await Promise.all([getData().settings.getLlm(), getData().settings.getMemory()])
      setLlm(llmData)
      setMemory(memoryData)
      setModelDraft(llmData.model)
      setEndpointDraft(llmData.endpoint ?? '')
      setApiKeyDraft('')
    } catch {
      setFailed(true)
    }
  }, [])

  const loadModules = useCallback(async (): Promise<void> => {
    try {
      setModules(await getData().settings.listModules())
    } catch {
      // 進階區才用得到；載入失敗就留空白，不擋整頁設定。
      setModules([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (showAdvanced && modules === null) void loadModules()
  }, [showAdvanced, modules, loadModules])

  const changeProvider = async (provider: LlmProvider): Promise<void> => {
    if (!llm) return
    const previous = llm
    // 樂觀切換：下拉選單本身就是即時回饋，不必等伺服器答完才動畫面。
    setLlm({ ...llm, provider, model: llm.models[provider] ?? '' })
    try {
      await getData().settings.setLlmProvider(provider)
      await load()
    } catch (e) {
      setLlm(previous)
      toast(describeSettingsError(e, '切換供應商'), 'error')
    }
  }

  const saveModel = async (): Promise<void> => {
    if (!llm) return
    const trimmed = modelDraft.trim()
    if (!trimmed || trimmed === llm.model) return
    setSavingModel(true)
    try {
      await getData().settings.setLlmModel(llm.provider, trimmed)
      await load()
      toast('已儲存模型')
    } catch (e) {
      toast(describeSettingsError(e, '儲存模型'), 'error')
    } finally {
      setSavingModel(false)
    }
  }

  const saveApiKey = async (): Promise<void> => {
    if (!llm || !apiKeyDraft.trim()) return
    setSavingKey(true)
    try {
      await getData().settings.setLlmApiKey(llm.provider, apiKeyDraft.trim())
      setApiKeyDraft('')
      await load()
      toast('已儲存 API Key')
    } catch (e) {
      toast(describeSettingsError(e, '儲存 API Key'), 'error')
    } finally {
      setSavingKey(false)
    }
  }

  const saveEndpoint = async (): Promise<void> => {
    if (!llm) return
    if (endpointDraft.trim() === (llm.endpoint ?? '')) return
    setSavingEndpoint(true)
    try {
      await getData().settings.setLlmEndpoint(endpointDraft.trim())
      await load()
      toast('已儲存端點')
    } catch (e) {
      toast(describeSettingsError(e, '儲存端點'), 'error')
    } finally {
      setSavingEndpoint(false)
    }
  }

  const saveMemory = async (next: MemorySettingsSnapshot): Promise<void> => {
    const previous = memory
    setMemory(next)
    try {
      await getData().settings.setMemory(next)
    } catch (e) {
      setMemory(previous)
      toast(describeSettingsError(e, '儲存記憶設定'), 'error')
    }
  }

  const toggleModule = async (m: ModuleToggle): Promise<void> => {
    if (!modules) return
    const next = modules.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x))
    setModules(next)
    try {
      await getData().settings.setModuleEnabled(m.id, !m.enabled)
    } catch (e) {
      setModules(modules)
      toast(describeSettingsError(e, `切換「${m.label}」`), 'error')
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入設定失敗</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
        >
          重試
        </button>
      </div>
    )
  }

  if (!llm || !memory) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="pb-2">
      <Field label="供應商">
        <select
          className="field"
          value={llm.provider}
          onChange={(e) => void changeProvider(e.target.value as LlmProvider)}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="模型">
        <div className="flex gap-2">
          <input
            type="text"
            className="field flex-1"
            list="mobile-model-suggestions"
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            onBlur={() => void saveModel()}
          />
          <button
            type="button"
            disabled={savingModel || modelDraft.trim() === llm.model}
            onClick={() => void saveModel()}
            className="btn-ghost px-4 disabled:opacity-40"
          >
            儲存
          </button>
        </div>
        <datalist id="mobile-model-suggestions">
          {PROVIDER_MODEL_SUGGESTIONS[llm.provider].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </Field>

      {apiKeyAccess ? (
        <Field
          label={`API Key（${PROVIDER_LABELS[llm.provider]}）`}
          hint={llm.hasApiKey[llm.provider] ? '已設定。輸入新的內容並儲存即可覆蓋，看不到舊金鑰。' : '尚未設定。'}
        >
          <div className="flex gap-2">
            <input
              type="password"
              className="field flex-1"
              placeholder={PROVIDER_KEY_PLACEHOLDER[llm.provider]}
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
            />
            <button
              type="button"
              disabled={savingKey || !apiKeyDraft.trim()}
              onClick={() => void saveApiKey()}
              className="btn-ghost px-4 disabled:opacity-40"
            >
              儲存
            </button>
          </div>
        </Field>
      ) : (
        <div className="mb-4 rounded-[14px] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-[var(--text-sub)]">
          目前透過中繼伺服器連線，為保護金鑰安全，API Key 欄位不會顯示。改用與電腦同一個區網連線即可編輯。
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-1 flex w-full items-center gap-1.5 border-t border-[var(--border)] pt-3 text-sm text-[var(--text-sub)]"
      >
        <span className={showAdvanced ? 'rotate-90 transition-transform' : 'transition-transform'}>▶</span>
        進階
      </button>

      {showAdvanced && (
        <div className="mt-2">
          <Field label="自訂端點" hint="一般不需填寫；留空使用預設端點。">
            <div className="flex gap-2">
              <input
                type="text"
                className="field flex-1"
                placeholder="https://api.example.com/v1"
                value={endpointDraft}
                onChange={(e) => setEndpointDraft(e.target.value)}
                onBlur={() => void saveEndpoint()}
              />
              <button
                type="button"
                disabled={savingEndpoint || endpointDraft.trim() === (llm.endpoint ?? '')}
                onClick={() => void saveEndpoint()}
                className="btn-ghost px-4 disabled:opacity-40"
              >
                儲存
              </button>
            </div>
          </Field>

          <Field label="記憶" hint="上下文只送最近幾則訊息，超出的會自動濃縮成摘要。">
            <div className="space-y-2">
              <NumberRow
                label="保留最近幾則"
                value={memory.keepRecentN}
                min={1}
                max={200}
                onCommit={(v) => void saveMemory({ ...memory, keepRecentN: v })}
              />
              <NumberRow
                label="自動摘要門檻"
                value={memory.autoSummarizeAfter}
                min={1}
                max={500}
                onCommit={(v) => void saveMemory({ ...memory, autoSummarizeAfter: v })}
              />
              <ToggleRow
                label="自動摘要"
                checked={memory.autoSummarizeEnabled}
                onChange={(v) => void saveMemory({ ...memory, autoSummarizeEnabled: v })}
              />
            </div>
          </Field>

          <Field label="模組開關">
            {modules === null ? (
              <p className="text-[11px] text-[var(--text-sub)]">載入中⋯⋯</p>
            ) : modules.length === 0 ? (
              <p className="text-[11px] text-[var(--text-sub)]">沒有可切換的模組。</p>
            ) : (
              <div className="space-y-1.5">
                {modules.map((m) => (
                  <ToggleRow key={m.id} label={m.label} checked={m.enabled} onChange={() => void toggleModule(m)} />
                ))}
              </div>
            )}
          </Field>

          <button
            type="button"
            onClick={() => push('reminders')}
            className="mt-1 flex w-full items-center justify-between rounded-[14px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-sm text-[var(--text)]"
          >
            <span>管理提醒</span>
            <span className="text-[var(--text-sub)]">›</span>
          </button>
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="mb-4 block">
      <span className="text-xs font-semibold text-[var(--text)]">{label}</span>
      {hint && <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--text-sub)]">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function NumberRow({
  label,
  value,
  min,
  max,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])

  const commit = (): void => {
    const n = Math.round(Number(draft))
    if (!Number.isFinite(n) || n < min || n > max) {
      setDraft(String(value))
      return
    }
    if (n !== value) onCommit(n)
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-[var(--text)]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        className="field w-20 text-right"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-sm text-[var(--text)]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--mint2)]"
      />
    </label>
  )
}
