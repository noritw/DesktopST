import { useCallback, useEffect, useState } from 'react'
import type { LlmProvider, LlmSettingsSnapshot, MemorySettingsSnapshot, ModuleToggle, WeatherSettingsSnapshot } from '@core/data'
import { MODEL_DATA_UPDATED } from '@core/llm/modelCatalog'
import MonoIcon from '@shared/MonoIcon'
import { capacitorSecrets } from '../../adapters'
import { resolveConnection } from '../connection'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from './settingsErrors'
import {
  HIGH_PRICE_GROUP_LABEL,
  NORMAL_PRICE_GROUP_LABEL,
  PROVIDERS,
  PROVIDER_KEY_PLACEHOLDER,
  PROVIDER_LABELS,
  modelOptionLabel,
  modelsFor,
  splitModelsByPrice
} from './providerInfo'
import { moduleDescription } from './moduleInfo'

/**
 * 設定（B3 階段 4；2026-08-06 依 owner 回報重整資訊架構）。
 *
 * ## 改了什麼
 *
 * 原本是「第一層 ＋ 一個叫『進階』的大雜燴」，端點、記憶、模組開關、提醒全塞在裡面，
 * owner 回報「分類太亂，容易讓新手困惑」。現在改成**平行的展開區塊**，
 * 每一塊自己一個標題，點了才展開：
 *
 *   ┌ 連線（不可收合，這是唯一必填的東西）── 供應商／模型／API Key
 *   ├ 對話            ← 回應字數／群組回應數／圖片上限
 *   ├ 天氣            ← 位置／開關／潤飾（手機可設；CWA 進階仍桌面）
 *   ├ 記憶
 *   ├ 模組開關         ← 天氣／新聞在前；Spotify／日曆只給開關
 *   └ 進階            ← 只剩自訂端點
 *
 * 「提醒」已搬到頂部 ☰ 主選單（owner 決定：它是會固定使用的功能，不是設定項）。
 *
 * ## 模型清單
 *
 * 改吃 `@core/llm/modelCatalog`，與桌面版同一份，並在每個選項標上
 * 每百萬 tokens 的參考價；高單價的另外分一組加警告，避免誤選很貴的型號。
 */
export function SettingsView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)

  const [llm, setLlm] = useState<LlmSettingsSnapshot | null>(null)
  const [memory, setMemory] = useState<MemorySettingsSnapshot | null>(null)
  const [modules, setModules] = useState<ModuleToggle[] | null>(null)
  const [weather, setWeather] = useState<WeatherSettingsSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<'chat' | 'weather' | 'memory' | 'modules' | 'advanced' | null>(null)
  const [apiKeyAccess, setApiKeyAccess] = useState(false)
  const [cityDraft, setCityDraft] = useState('')
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [weatherMsg, setWeatherMsg] = useState<string | null>(null)

  const [modelDraft, setModelDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [endpointDraft, setEndpointDraft] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [savingEndpoint, setSavingEndpoint] = useState(false)

  /*
   * 獨立模式但金鑰保險箱沒解封（＝瀏覽器煙測，沒有 Android Keystore）：
   * API Key 會以明文落地。這種情況要當面講，不能只寫在 console。
   */
  const [plaintextKey] = useState(
    () => resolveConnection().mode === 'standalone' && !capacitorSecrets.isAvailable()
  )

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setApiKeyAccess(getData().capabilities.apiKeyAccess)
      const [llmData, memoryData] = await Promise.all([getData().settings.getLlm(), getData().settings.getMemory()])
      setLlm({
        ...llmData,
        maxResponseTokens: llmData.maxResponseTokens ?? 400,
        maxGroupRounds: llmData.maxGroupRounds ?? 3,
        maxImagesPerMessage: llmData.maxImagesPerMessage ?? 5
      })
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
      setModules([])
    }
  }, [])

  const loadWeather = useCallback(async (): Promise<void> => {
    try {
      setWeather(await getData().settings.getWeather())
    } catch {
      setWeather(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (open === 'modules' && modules === null) void loadModules()
  }, [open, modules, loadModules])

  useEffect(() => {
    if (open === 'weather' && weather === null) void loadWeather()
  }, [open, weather, loadWeather])

  /*
   * 這個開關的真值住在快照裡（電腦端與本機共用同一個 `ui.showLlmBadge`），
   * 不另存本地 state —— 否則遙控模式下電腦改了、手機這頁不會跟著動。
   */
  const showLlmBadge = useAppStore((s) => s.snapshot?.showLlmBadge !== false)

  const toggleLlmBadge = async (): Promise<void> => {
    try {
      await getData().settings.setShowLlmBadge(!showLlmBadge)
    } catch (e) {
      toast(describeSettingsError(e, '切換模型圖示'), 'error')
    }
  }

  const changeProvider = async (provider: LlmProvider): Promise<void> => {
    if (!llm) return
    const previous = llm
    setLlm({ ...llm, provider, model: llm.models[provider] ?? '' })
    try {
      await getData().settings.setLlmProvider(provider)
      await load()
    } catch (e) {
      setLlm(previous)
      toast(describeSettingsError(e, '切換供應商'), 'error')
    }
  }

  const saveModel = async (value: string): Promise<void> => {
    if (!llm) return
    const trimmed = value.trim()
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

  const saveChatLimits = async (patch: Partial<{
    maxResponseTokens: number
    maxGroupRounds: number
    maxImagesPerMessage: number
  }>): Promise<void> => {
    if (!llm) return
    const previous = llm
    const next = {
      maxResponseTokens: patch.maxResponseTokens ?? llm.maxResponseTokens,
      maxGroupRounds: patch.maxGroupRounds ?? llm.maxGroupRounds,
      maxImagesPerMessage: patch.maxImagesPerMessage ?? llm.maxImagesPerMessage
    }
    setLlm({ ...llm, ...next })
    try {
      await getData().settings.setLlmChatLimits(next)
      // 圖片上限會影響 Composer；重抓狀態快照
      void useAppStore.getState().refresh()
    } catch (e) {
      setLlm(previous)
      toast(describeSettingsError(e, '儲存對話設定'), 'error')
    }
  }

  const toggleModule = async (m: ModuleToggle): Promise<void> => {
    if (!modules) return
    const next = modules.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x))
    setModules(next)
    try {
      await getData().settings.setModuleEnabled(m.id, !m.enabled)
      if (m.id === 'desktopst.weather') void loadWeather()
    } catch (e) {
      setModules(modules)
      toast(describeSettingsError(e, `切換「${m.label}」`), 'error')
    }
  }

  const applyWeather = async (next: WeatherSettingsSnapshot): Promise<void> => {
    setWeather(next)
    setModules((prev) =>
      prev
        ? prev.map((x) => (x.id === 'desktopst.weather' ? { ...x, enabled: next.enabled } : x))
        : prev
    )
  }

  const patchWeather = async (
    patch: Partial<Omit<WeatherSettingsSnapshot, 'utilityEnabled'>>,
    action: string
  ): Promise<void> => {
    setWeatherBusy(true)
    setWeatherMsg(null)
    try {
      await applyWeather(await getData().settings.setWeather(patch))
    } catch (e) {
      toast(describeSettingsError(e, action), 'error')
      void loadWeather()
    } finally {
      setWeatherBusy(false)
    }
  }

  const detectWeather = async (): Promise<void> => {
    setWeatherBusy(true)
    setWeatherMsg(null)
    try {
      const next = await getData().settings.detectWeatherLocation()
      await applyWeather(next)
      setWeatherMsg(`已偵測到：${next.locationName}`)
    } catch (e) {
      toast(describeSettingsError(e, '偵測位置'), 'error')
    } finally {
      setWeatherBusy(false)
    }
  }

  const geocodeWeather = async (): Promise<void> => {
    const name = cityDraft.trim()
    if (!name) return
    setWeatherBusy(true)
    setWeatherMsg(null)
    try {
      const next = await getData().settings.geocodeWeatherLocation(name)
      await applyWeather(next)
      setCityDraft('')
      setWeatherMsg(`已設定：${next.locationName}`)
    } catch (e) {
      toast(describeSettingsError(e, '查詢城市'), 'error')
    } finally {
      setWeatherBusy(false)
    }
  }

  const refreshWeatherNow = async (): Promise<void> => {
    setWeatherBusy(true)
    setWeatherMsg(null)
    try {
      const data = await getData().settings.fetchWeatherNow()
      setWeatherMsg(`${data.description} ${data.temperatureC}°C 濕度 ${data.humidity}%`)
    } catch (e) {
      toast(describeSettingsError(e, '更新天氣'), 'error')
    } finally {
      setWeatherBusy(false)
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

  const { normal, high } = splitModelsByPrice(modelsFor(llm.provider))

  return (
    <div className="space-y-4 pb-2">
      {/* ── 連線：唯一必填的一塊，永遠攤開 ────────────────── */}
      <section className="space-y-3">
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

        <Field
          label="模型"
          hint={`括號內是參考價：每百萬 tokens 的美金價（輸入 / 輸出），更新於 ${MODEL_DATA_UPDATED}。`}
        >
          <select
            className="field"
            disabled={savingModel}
            value={modelsFor(llm.provider).includes(modelDraft) ? modelDraft : ''}
            onChange={(e) => {
              setModelDraft(e.target.value)
              void saveModel(e.target.value)
            }}
          >
            {/* 自訂／快照型號不在目錄裡時，保留一個代表目前值的選項，避免顯示成空白 */}
            {!modelsFor(llm.provider).includes(modelDraft) && (
              <option value="">{modelDraft || '（尚未選擇）'}</option>
            )}
            <optgroup label={NORMAL_PRICE_GROUP_LABEL}>
              {normal.map((m) => (
                <option key={m} value={m}>
                  {modelOptionLabel(m)}
                </option>
              ))}
            </optgroup>
            {high.length > 0 && (
              <optgroup label={HIGH_PRICE_GROUP_LABEL}>
                {high.map((m) => (
                  <option key={m} value={m}>
                    {modelOptionLabel(m)}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
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
            {plaintextKey && (
              <p className="mt-2 rounded-[14px] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-[var(--text-sub)]">
                這台裝置沒有可用的金鑰保險箱，API Key 會以明文存在本機資料裡。測試用的金鑰沒問題，正式金鑰請改用 App 版。
              </p>
            )}
          </Field>
        ) : (
          <div className="rounded-[14px] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-[var(--text-sub)]">
            目前透過中繼伺服器連線，為保護金鑰安全，API Key 欄位不會顯示。改用同一個區網連線即可編輯。
          </div>
        )}
      </section>

      {/* ── 對話限制（與桌面 LLM 設定同一欄）─────────────── */}
      <Section
        title="對話"
        hint="回應長度、群組回應數、圖片上限"
        expanded={open === 'chat'}
        onToggle={() => setOpen(open === 'chat' ? null : 'chat')}
      >
        <NumberRow
          label="最大回應字數"
          value={llm.maxResponseTokens}
          min={100}
          max={1000}
          onCommit={(v) => void saveChatLimits({ maxResponseTokens: v })}
        />
        <NumberRow
          label="群組最多角色回應數"
          value={llm.maxGroupRounds}
          min={1}
          max={10}
          onCommit={(v) => void saveChatLimits({ maxGroupRounds: v })}
        />
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-sub)]">
          每次送出後群組裡最多幾位角色會回應；越大越熱鬧，也越耗 token。
        </p>
        <NumberRow
          label="單則訊息圖片上限"
          value={llm.maxImagesPerMessage}
          min={1}
          max={10}
          onCommit={(v) => void saveChatLimits({ maxImagesPerMessage: v })}
        />
        <ToggleRow
          label="顯示生成模型小圖示"
          checked={showLlmBadge}
          onChange={() => void toggleLlmBadge()}
        />
        <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
          角色名字旁邊會出現一顆小圓，標示這則回覆是哪家模型生的；點一下看完整型號。
        </p>
      </Section>

      {/* ── 天氣 ────────────────────────────────────────── */}
      <Section
        title="天氣"
        hint="所在地與是否帶進對話"
        expanded={open === 'weather'}
        onToggle={() => setOpen(open === 'weather' ? null : 'weather')}
      >
        {weather === null ? (
          <p className="text-[11px] text-[var(--text-sub)]">載入中⋯⋯</p>
        ) : (
          <div className="space-y-2">
            <ToggleRow
              label="對話中帶入天氣"
              checked={weather.enabled}
              onChange={(v) => void patchWeather({ enabled: v }, '切換天氣')}
            />
            <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
              即時氣象署查詢（CWA API Key）仍請在電腦版「設定 → 擴充」設定。
            </p>
            <button
              type="button"
              disabled={weatherBusy}
              onClick={() => void detectWeather()}
              className="min-h-[40px] w-full rounded-full bg-[var(--mint)] px-4 text-sm text-[var(--text)] disabled:opacity-50"
            >
              {weatherBusy ? '處理中…' : '自動偵測位置（IP）'}
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                className="field flex-1"
                placeholder="城市名稱，例如 Taipei"
                value={cityDraft}
                onChange={(e) => setCityDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void geocodeWeather()
                }}
              />
              <button
                type="button"
                disabled={weatherBusy || !cityDraft.trim()}
                onClick={() => void geocodeWeather()}
                className="shrink-0 rounded-full border border-[var(--border)] px-4 text-sm text-[var(--text)] disabled:opacity-50"
              >
                查詢
              </button>
            </div>
            {weather.locationName ? (
              <p className="text-[12px] text-[var(--text-sub)]">
                目前位置：
                <span className="font-medium text-[var(--text)]">{weather.locationName}</span>
                {weather.locationSource === 'ip' ? '（自動偵測）' : weather.locationSource === 'manual' ? '（手動）' : ''}
                {' '}
                <button
                  type="button"
                  disabled={weatherBusy}
                  onClick={() => void refreshWeatherNow()}
                  className="text-[var(--mint2)] underline disabled:opacity-50"
                >
                  立即更新
                </button>
              </p>
            ) : (
              <p className="text-[11px] text-[var(--text-sub)]">尚未設定位置；設定後才能開啟天氣模組。</p>
            )}
            {weatherMsg && <p className="text-[12px] text-[var(--mint2)]">{weatherMsg}</p>}
            <label className={`flex items-center gap-2 text-sm text-[var(--text)] ${!weather.utilityEnabled ? 'opacity-40' : ''}`}>
              <input
                type="checkbox"
                checked={weather.polish}
                disabled={!weather.utilityEnabled || weatherBusy}
                onChange={(e) => void patchWeather({ polish: e.target.checked }, '切換天氣潤飾')}
                className="h-4 w-4 accent-[var(--mint2)]"
              />
              用輔助模型潤飾天氣描述
              {!weather.utilityEnabled && (
                <span className="text-[11px] text-[var(--text-sub)]">（需先在電腦啟用輔助模型）</span>
              )}
            </label>
          </div>
        )}
      </Section>

      {/* ── 記憶 ────────────────────────────────────────── */}
      <Section
        title="記憶"
        hint="角色記得多少之前的對話"
        expanded={open === 'memory'}
        onToggle={() => setOpen(open === 'memory' ? null : 'memory')}
      >
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-sub)]">
          每次回話只會把最近幾則送給角色，太舊的會自動濃縮成一段摘要——這樣角色記得住重點，又不會每次都花大錢重讀整段歷史。
        </p>
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
      </Section>

      {/* ── 模組開關 ────────────────────────────────────── */}
      <Section
        title="模組開關"
        hint="角色還能知道哪些事"
        expanded={open === 'modules'}
        onToggle={() => setOpen(open === 'modules' ? null : 'modules')}
      >
        {modules === null ? (
          <p className="text-[11px] text-[var(--text-sub)]">載入中⋯⋯</p>
        ) : modules.length === 0 ? (
          <p className="text-[11px] text-[var(--text-sub)]">沒有可切換的模組。</p>
        ) : (
          <div className="space-y-3">
            {modules.map((m) => (
              <div key={m.id}>
                <ToggleRow label={m.label} checked={m.enabled} onChange={() => void toggleModule(m)} />
                {moduleDescription(m.id) && (
                  <p className="mt-0.5 pr-8 text-[11px] leading-relaxed text-[var(--text-sub)]">
                    {moduleDescription(m.id)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 進階：只剩自訂端點 ──────────────────────────── */}
      <Section
        title="進階"
        hint="一般不需要動"
        expanded={open === 'advanced'}
        onToggle={() => setOpen(open === 'advanced' ? null : 'advanced')}
      >
        <Field
          label="自訂端點"
          hint="用官方 API 的話請留空。只有當你改走相容的第三方服務（例如 OpenRouter、自架代理、本機模型）時才需要填。"
        >
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
      </Section>
    </div>
  )
}

/** 可收合的設定區塊。四塊平行、各自一個標題，取代原本那個什麼都塞的「進階」。 */
function Section({
  title,
  hint,
  expanded,
  onToggle,
  children
}: {
  title: string
  hint: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="overflow-hidden rounded-[14px] border border-[var(--border)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 bg-[var(--bg)] px-3 py-2.5 text-left active:bg-[var(--surface)]"
      >
        <MonoIcon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          className="h-4 w-4 shrink-0 text-[var(--text-sub)]"
        />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-[var(--text)]">{title}</span>
          <span className="text-[11px] text-[var(--text-sub)]">{hint}</span>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[var(--border)] bg-[var(--surface)]/30 px-3 py-3">{children}</div>
      )}
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block">
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
    <div className="mb-2 flex items-center justify-between gap-3">
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
        className="h-4 w-4 shrink-0 accent-[var(--mint2)]"
      />
    </label>
  )
}
