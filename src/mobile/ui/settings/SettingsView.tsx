import { useCallback, useEffect, useState } from 'react'
import type { LlmProvider, LlmSettingsSnapshot, MemorySettingsSnapshot, ModuleToggle, WeatherSettingsSnapshot } from '@core/data'
import { MODEL_DATA_UPDATED } from '@core/llm/modelCatalog'
import MonoIcon from '@shared/MonoIcon'
import { capacitorSecrets } from '../../adapters'
import { resolveConnection } from '../connection'
import { getData, isAttached, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { DesktopPullSection } from './DesktopPullSection'
import { describeSettingsError } from './settingsErrors'
import {
  HIGH_PRICE_GROUP_LABEL,
  LOCAL_ENDPOINT_PRESETS,
  apiKeyOptional,
  NORMAL_PRICE_GROUP_LABEL,
  PROVIDERS,
  PROVIDER_KEY_PLACEHOLDER,
  PROVIDER_LABELS,
  modelOptionLabel,
  modelsFor,
  splitModelsByPrice
} from './providerInfo'
import { moduleDescription } from './moduleInfo'

/** 即時氣象查詢的預設縣市選單，與桌面 `SettingsWindow.tsx` 同一份清單。 */
const TAIWAN_COUNTIES = [
  '臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣',
  '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣',
  '臺南市', '高雄市', '屏東縣', '臺東縣', '花蓮縣', '宜蘭縣',
  '澎湖縣', '金門縣', '連江縣'
]

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
 *   ├ 天氣            ← 位置／開關／潤飾（獨立版可定位；地震颱風查詢仍桌面）
 *   ├ 記憶
 *   ├ 模組開關         ← 天氣／新聞在前；Spotify／日曆只給開關
 *   ├ 與電腦同步       ← 可重複執行的單向拉設定（獨立版限定）
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
  const attached = useAppStore((s) => s.attached)

  const [llm, setLlm] = useState<LlmSettingsSnapshot | null>(null)
  const [memory, setMemory] = useState<MemorySettingsSnapshot | null>(null)
  const [modules, setModules] = useState<ModuleToggle[] | null>(null)
  const [weather, setWeather] = useState<WeatherSettingsSnapshot | null>(null)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<
    'chat' | 'utility' | 'weather' | 'memory' | 'modules' | 'desktop' | 'advanced' | null
  >(null)
  const [apiKeyAccess, setApiKeyAccess] = useState(false)
  const [cityDraft, setCityDraft] = useState('')
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [weatherMsg, setWeatherMsg] = useState<string | null>(null)
  const [cwaKeyDraft, setCwaKeyDraft] = useState('')
  const [cwaSavingKey, setCwaSavingKey] = useState(false)
  const [cwaTesting, setCwaTesting] = useState(false)
  const [cwaTestMsg, setCwaTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [modelDraft, setModelDraft] = useState('')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  /*
   * 端點有兩個各自獨立的編輯框，因為它們是**兩件不同的事**：
   *
   *   `localEndpointDraft`  永遠指向 `endpoints.local` —— 本機模型伺服器的網址，
   *                         主／輔助只要有一邊選了本機就要能填（兩邊共用同一個值）。
   *   `customEndpointDraft` 指向目前主供應商那格 —— 雲端改走相容代理時才用得到。
   *
   * 合成同一個 draft 的話，「主＝OpenAI 自訂代理／輔助＝本機」這種組合會互相蓋掉。
   */
  const [localEndpointDraft, setLocalEndpointDraft] = useState('')
  const [customEndpointDraft, setCustomEndpointDraft] = useState('')
  const [extraInstructionDraft, setExtraInstructionDraft] = useState('')
  const [savingModel, setSavingModel] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [savingEndpoint, setSavingEndpoint] = useState(false)
  const [savingExtraInstruction, setSavingExtraInstruction] = useState(false)

  /*
   * local 供應商沒有寫死的型號目錄，「連線」按鈕打 `GET /v1/models` 抓回來的清單
   * 存在這裡（不進 draft、不存檔，純粹是當下探測到的狀態）。主／輔助模型若都選
   * local，兩者用的是同一個 provider key（`endpoints.local`），共用同一份清單即可。
   */
  const [localModels, setLocalModels] = useState<string[]>([])
  const [testingConn, setTestingConn] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 輔助模型（提醒發話、情緒分類；群組對話一律用扮演主模型）
  const [utilityModelDraft, setUtilityModelDraft] = useState('')
  const [utilityApiKeyDraft, setUtilityApiKeyDraft] = useState('')
  const [savingUtilityModel, setSavingUtilityModel] = useState(false)
  const [savingUtilityKey, setSavingUtilityKey] = useState(false)

  /*
   * 獨立模式但金鑰保險箱沒解封（＝瀏覽器煙測，沒有 Android Keystore）：
   * API Key 會以明文落地。這種情況要當面講，不能只寫在 console。
   */
  const [standalone] = useState(() => resolveConnection().mode === 'standalone')
  const [plaintextKey] = useState(() => standalone && !capacitorSecrets.isAvailable())

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
      setLocalEndpointDraft(llmData.endpoints?.local ?? '')
      setCustomEndpointDraft(
        llmData.provider === 'local'
          ? ''
          : llmData.endpoints?.[llmData.provider] ?? llmData.endpoint ?? ''
      )
      setExtraInstructionDraft(llmData.extraInstruction ?? '')
      setApiKeyDraft('')
      setUtilityModelDraft(llmData.utilityModel)
      setUtilityApiKeyDraft('')
    } catch {
      /*
       * B-4：切換模式的空窗期間 `getData()` 會 throw「appStore not attached」，
       * 那不是真的失敗，是還沒接上。這種情況不設 `failed`——保持 `llm === null`，
       * 畫面會自然落到下面 `if (!llm) 載入中⋯⋯` 那條，`attached` 一變 true
       * 下面的 effect 就會自動重試，使用者不會看到「載入失敗」。
       * 真的接上了卻還是失敗，才是貨真價實的失敗。
       */
      if (isAttached()) setFailed(true)
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
    // `attached` 是依賴之一：切換模式的空窗期間掛進來（或本來就開著）的話，
    // 這次 load() 會安靜放棄（見上面），等 `attached` 變 true 這裡會自動重跑。
    void load()
  }, [load, attached])

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

  const saveEndpointFor = async (target: LlmProvider, value: string, current: string): Promise<void> => {
    if (value.trim() === current) return
    setSavingEndpoint(true)
    try {
      await getData().settings.setLlmEndpoint(value.trim(), target)
      await load()
      toast('已儲存端點')
    } catch (e) {
      toast(describeSettingsError(e, '儲存端點'), 'error')
    } finally {
      setSavingEndpoint(false)
    }
  }

  const saveLocalEndpoint = async (): Promise<void> => {
    if (!llm) return
    await saveEndpointFor('local', localEndpointDraft, llm.endpoints?.local ?? '')
  }

  const saveCustomEndpoint = async (): Promise<void> => {
    if (!llm || llm.provider === 'local') return
    await saveEndpointFor(
      llm.provider,
      customEndpointDraft,
      llm.endpoints?.[llm.provider] ?? llm.endpoint ?? ''
    )
  }

  const testConnection = async (): Promise<void> => {
    if (!llm) return
    setTestingConn(true)
    setTestMsg(null)
    try {
      const r = await getData().settings.testLlmConnection('local', localEndpointDraft.trim() || undefined)
      if (r.ok) {
        setLocalModels(r.models ?? [])
        setTestMsg({ ok: true, text: `已連線，找到 ${r.models?.length ?? 0} 個模型` })
      } else {
        setTestMsg({ ok: false, text: r.error })
      }
    } catch (e) {
      setTestMsg({ ok: false, text: describeSettingsError(e, '測試連線') })
    } finally {
      setTestingConn(false)
    }
  }

  const saveExtraInstruction = async (): Promise<void> => {
    if (!llm) return
    if (extraInstructionDraft === (llm.extraInstruction ?? '')) return
    setSavingExtraInstruction(true)
    try {
      await getData().settings.setLlmExtraInstruction(extraInstructionDraft)
      await load()
      toast('已儲存')
    } catch (e) {
      toast(describeSettingsError(e, '儲存補充指示'), 'error')
    } finally {
      setSavingExtraInstruction(false)
    }
  }

  const toggleUtilityEnabled = async (enabled: boolean): Promise<void> => {
    if (!llm) return
    const previous = llm
    setLlm({ ...llm, utilityEnabled: enabled })
    try {
      await getData().settings.setLlmUtilityEnabled(enabled)
      await load()
    } catch (e) {
      setLlm(previous)
      toast(describeSettingsError(e, '切換輔助模型'), 'error')
    }
  }

  const changeUtilityProvider = async (provider: LlmProvider): Promise<void> => {
    if (!llm) return
    const previous = llm
    setLlm({ ...llm, utilityProvider: provider, utilityModel: llm.utilityModels[provider] ?? '' })
    try {
      await getData().settings.setLlmUtilityProvider(provider)
      await load()
    } catch (e) {
      setLlm(previous)
      toast(describeSettingsError(e, '切換輔助供應商'), 'error')
    }
  }

  const saveUtilityModel = async (value: string): Promise<void> => {
    if (!llm) return
    const trimmed = value.trim()
    if (!trimmed || trimmed === llm.utilityModel) return
    setSavingUtilityModel(true)
    try {
      await getData().settings.setLlmUtilityModel(llm.utilityProvider, trimmed)
      await load()
      toast('已儲存輔助模型')
    } catch (e) {
      toast(describeSettingsError(e, '儲存輔助模型'), 'error')
    } finally {
      setSavingUtilityModel(false)
    }
  }

  const saveUtilityApiKey = async (): Promise<void> => {
    if (!llm || !utilityApiKeyDraft.trim()) return
    setSavingUtilityKey(true)
    try {
      await getData().settings.setLlmApiKey(llm.utilityProvider, utilityApiKeyDraft.trim())
      setUtilityApiKeyDraft('')
      await load()
      toast('已儲存 API Key')
    } catch (e) {
      toast(describeSettingsError(e, '儲存 API Key'), 'error')
    } finally {
      setSavingUtilityKey(false)
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
    patch: Partial<Omit<WeatherSettingsSnapshot, 'utilityEnabled' | 'realtimeQuery'>> & {
      realtimeQuery?: Partial<Omit<WeatherSettingsSnapshot['realtimeQuery'], 'hasCwaApiKey'>>
    },
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
      /*
       * 獨立版的定位只會因為兩件事失敗：沒給定位權限、或連不上外部服務。
       * 共用文案的「請再試一次」對前者毫無幫助——再按一百次也還是沒權限。
       */
      const standalone = !getData().capabilities.remoteControl
      toast(
        standalone
          ? '偵測位置失敗。請確認已允許定位權限並開啟網路，或直接在下方輸入城市名稱。'
          : describeSettingsError(e, '偵測位置'),
        'error'
      )
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

  const saveCwaApiKey = async (): Promise<void> => {
    if (!cwaKeyDraft.trim()) return
    setCwaSavingKey(true)
    try {
      await getData().settings.setCwaApiKey(cwaKeyDraft.trim())
      setCwaKeyDraft('')
      setCwaTestMsg(null)
      await loadWeather()
      toast('已儲存 API Key')
    } catch (e) {
      toast(describeSettingsError(e, '儲存 API Key'), 'error')
    } finally {
      setCwaSavingKey(false)
    }
  }

  const testCwaConnection = async (): Promise<void> => {
    const key = cwaKeyDraft.trim()
    if (!key) return
    setCwaTesting(true)
    setCwaTestMsg(null)
    try {
      const r = await getData().settings.testCwaApiKey(key)
      setCwaTestMsg(r.ok ? { ok: true, text: '連線成功，API Key 有效' } : { ok: false, text: r.error ?? '連線失敗' })
    } catch (e) {
      setCwaTestMsg({ ok: false, text: describeSettingsError(e, '測試連線') })
    } finally {
      setCwaTesting(false)
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

  /** local 沒有寫死目錄；「連線」測過之後改用抓回來的清單。 */
  const modelOptionsFor = (p: LlmProvider): string[] =>
    p === 'local' && localModels.length > 0 ? localModels : modelsFor(p)

  /*
   * 本機端點編輯器。**只在選了「本機」的那一區出現**——主模型選雲端時，
   * 「端點網址」擠在供應商下拉底下會讓人以為那是雲端服務要填的東西
   * （owner 2026-08-15 回報）。主／輔助各自獨立判斷，兩邊都選本機時會出現兩份，
   * 但編輯的是同一個 `endpoints.local`，存完 `load()` 會把兩邊拉回一致。
   */
  const localEndpointField = (
    <Field
      label="端點網址（必填）"
      hint="本機模型伺服器的網址。跨機連線請填該機 IP，並確認伺服器已開放區網（Ollama 需 OLLAMA_HOST=0.0.0.0）。手機不在同一個網路時會連不上。"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-[var(--text-sub)]">快速填入：</span>
        {LOCAL_ENDPOINT_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="btn-ghost px-2 py-1 text-[11px]"
            onClick={() => setLocalEndpointDraft(p.url)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="field flex-1"
          placeholder="http://localhost:11434/v1"
          value={localEndpointDraft}
          onChange={(e) => setLocalEndpointDraft(e.target.value)}
          onBlur={() => void saveLocalEndpoint()}
        />
        <button
          type="button"
          disabled={savingEndpoint || localEndpointDraft.trim() === (llm.endpoints?.local ?? '')}
          onClick={() => void saveLocalEndpoint()}
          className="btn-ghost px-4 disabled:opacity-40"
        >
          儲存
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={testingConn || !localEndpointDraft.trim()}
          onClick={() => void testConnection()}
          className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {testingConn ? '連線中…' : '連線（取得模型清單）'}
        </button>
        {testMsg && (
          <span className={`text-[11px] ${testMsg.ok ? 'text-[#4CAF50]' : 'text-[#E85D3F]'}`}>
            {testMsg.text}
          </span>
        )}
      </div>
    </Field>
  )

  const { normal, high } = splitModelsByPrice(modelOptionsFor(llm.provider))

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

        {llm.provider === 'local' && localEndpointField}

        <Field
          label="模型"
          hint={`括號內是參考價：每百萬 tokens 的美金價（輸入 / 輸出），更新於 ${MODEL_DATA_UPDATED}。`}
        >
          <select
            className="field"
            disabled={savingModel}
            value={modelOptionsFor(llm.provider).includes(modelDraft) ? modelDraft : ''}
            onChange={(e) => {
              setModelDraft(e.target.value)
              void saveModel(e.target.value)
            }}
          >
            {/* 自訂／快照型號不在目錄裡時，保留一個代表目前值的選項，避免顯示成空白 */}
            {!modelOptionsFor(llm.provider).includes(modelDraft) && (
              <option value="">
                {modelDraft || (llm.provider === 'local' ? '（先按下方「連線」取得模型清單）' : '（尚未選擇）')}
              </option>
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
            hint={apiKeyOptional(llm.provider)
              // 本機端點多半沒有 auth；顯示「尚未設定」會讓人以為還缺一步
              ? (llm.hasApiKey[llm.provider] ? '已設定。' : '不需要填。只有自架端點另外設了驗證時才需要。')
              : (llm.hasApiKey[llm.provider] ? '已設定。輸入新的內容並儲存即可覆蓋，看不到舊金鑰。' : '尚未設定。')}
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

      {/* ── 輔助模型：提醒發話、情緒分類、天氣潤飾可以改用另一組較便宜的模型 ── */}
      <Section
        title="輔助模型"
        hint={llm.utilityEnabled ? `目前：${PROVIDER_LABELS[llm.utilityProvider]}` : '沿用扮演主模型'}
        expanded={open === 'utility'}
        onToggle={() => setOpen(open === 'utility' ? null : 'utility')}
      >
        <ToggleRow
          label="提醒發話、情緒分類改用輔助模型"
          checked={llm.utilityEnabled}
          onChange={(v) => void toggleUtilityEnabled(v)}
        />
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-sub)]">
          群組對話中每位角色一律用上方扮演主模型；關閉時提醒與情緒分類也一樣。
          開啟後可以另外挑一組較便宜的模型，省主模型的用量。
        </p>

        {llm.utilityEnabled && (
          <div className="mt-2 space-y-3 border-l-2 border-[var(--border)] pl-3">
            <Field label="輔助供應商">
              <select
                className="field"
                value={llm.utilityProvider}
                onChange={(e) => void changeUtilityProvider(e.target.value as LlmProvider)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>

            {/* 輔助選本機時端點也要能在這裡填 —— 「主＝雲端／輔助＝本機」是核心情境，
                主模型那一區不會顯示端點欄位（那時主模型是雲端的） */}
            {llm.utilityProvider === 'local' && localEndpointField}

            <Field label="輔助模型">
              <select
                className="field"
                disabled={savingUtilityModel}
                value={modelOptionsFor(llm.utilityProvider).includes(utilityModelDraft) ? utilityModelDraft : ''}
                onChange={(e) => {
                  setUtilityModelDraft(e.target.value)
                  void saveUtilityModel(e.target.value)
                }}
              >
                {!modelOptionsFor(llm.utilityProvider).includes(utilityModelDraft) && (
                  <option value="">
                    {utilityModelDraft || (llm.utilityProvider === 'local' ? '（先按下方「連線」取得模型清單）' : '（尚未選擇）')}
                  </option>
                )}
                <optgroup label={NORMAL_PRICE_GROUP_LABEL}>
                  {splitModelsByPrice(modelOptionsFor(llm.utilityProvider)).normal.map((m) => (
                    <option key={m} value={m}>
                      {modelOptionLabel(m)}
                    </option>
                  ))}
                </optgroup>
                {splitModelsByPrice(modelOptionsFor(llm.utilityProvider)).high.length > 0 && (
                  <optgroup label={HIGH_PRICE_GROUP_LABEL}>
                    {splitModelsByPrice(modelOptionsFor(llm.utilityProvider)).high.map((m) => (
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
                label={`API Key（${PROVIDER_LABELS[llm.utilityProvider]}）`}
                hint={apiKeyOptional(llm.utilityProvider)
                  ? (llm.hasApiKey[llm.utilityProvider] ? '已設定。' : '不需要填。只有自架端點另外設了驗證時才需要。')
                  : (llm.hasApiKey[llm.utilityProvider]
                    ? '已設定。輸入新的內容並儲存即可覆蓋，看不到舊金鑰。'
                    : '尚未設定。')}
              >
                <div className="flex gap-2">
                  <input
                    type="password"
                    className="field flex-1"
                    placeholder={PROVIDER_KEY_PLACEHOLDER[llm.utilityProvider]}
                    value={utilityApiKeyDraft}
                    onChange={(e) => setUtilityApiKeyDraft(e.target.value)}
                  />
                  <button
                    type="button"
                    disabled={savingUtilityKey || !utilityApiKeyDraft.trim()}
                    onClick={() => void saveUtilityApiKey()}
                    className="btn-ghost px-4 disabled:opacity-40"
                  >
                    儲存
                  </button>
                </div>
                {llm.utilityProvider === llm.provider && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-sub)]">
                    輔助供應商跟扮演主模型同一家，金鑰是共用的，不必重填。
                  </p>
                )}
              </Field>
            ) : (
              <div className="rounded-[14px] bg-[var(--bg)] p-3 text-[11px] leading-relaxed text-[var(--text-sub)]">
                目前透過中繼伺服器連線，為保護金鑰安全，API Key 欄位不會顯示。改用同一個區網連線即可編輯。
              </div>
            )}
          </div>
        )}
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
            <button
              type="button"
              disabled={weatherBusy}
              onClick={() => void detectWeather()}
              className="min-h-[40px] w-full rounded-full bg-[var(--mint)] px-4 text-sm text-[var(--text)] disabled:opacity-50"
            >
              {weatherBusy ? '處理中…' : '自動偵測位置'}
            </button>
            <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
              優先用裝置定位；沒給權限時改用連線位置推估，那會粗略得多。
            </p>
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
                {weather.locationSource === 'gps'
                  ? '（裝置定位）'
                  : weather.locationSource === 'ip'
                    ? '（連線位置推估）'
                    : weather.locationSource === 'manual'
                      ? '（手動）'
                      : ''}
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
                <span className="text-[11px] text-[var(--text-sub)]">（需先在上方「輔助模型」開啟）</span>
              )}
            </label>

            {/* ── 即時氣象查詢（地震／颱風／天氣預報）── */}
            <div className="mt-2 space-y-2 rounded-[14px] bg-[var(--bg)] p-3">
              <p className="text-sm font-medium text-[var(--text)]">即時氣象查詢</p>
              <p className="text-[11px] leading-relaxed text-[var(--text-sub)]">
                偵測到「地震」「颱風」「明天天氣」等關鍵詞時，自動查詢中央氣象署取得即時資料。
              </p>
              <label
                className={`flex items-center gap-2 text-sm text-[var(--text)] ${!weather.realtimeQuery.hasCwaApiKey ? 'opacity-40' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={weather.realtimeQuery.enabled}
                  disabled={!weather.realtimeQuery.hasCwaApiKey || weatherBusy}
                  onChange={(e) =>
                    void patchWeather({ realtimeQuery: { enabled: e.target.checked } }, '切換即時氣象查詢')
                  }
                  className="h-4 w-4 accent-[var(--mint2)]"
                />
                啟用即時氣象查詢
                {!weather.realtimeQuery.hasCwaApiKey && (
                  <span className="text-[11px] text-[var(--text-sub)]">（需先填入 API Key）</span>
                )}
              </label>

              <div className="space-y-1">
                <label className="text-xs text-[var(--text-sub)]">
                  中央氣象署 API Key {weather.realtimeQuery.hasCwaApiKey && '（已設定）'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="field flex-1 font-mono"
                    placeholder="CWA-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                    value={cwaKeyDraft}
                    onChange={(e) => {
                      setCwaKeyDraft(e.target.value)
                      setCwaTestMsg(null)
                    }}
                  />
                  <button
                    type="button"
                    disabled={cwaSavingKey || !cwaKeyDraft.trim()}
                    onClick={() => void saveCwaApiKey()}
                    className="shrink-0 rounded-full border border-[var(--border)] px-4 text-sm text-[var(--text)] disabled:opacity-50"
                  >
                    {cwaSavingKey ? '儲存中…' : '儲存'}
                  </button>
                </div>
                <button
                  type="button"
                  disabled={cwaTesting || !cwaKeyDraft.trim()}
                  onClick={() => void testCwaConnection()}
                  className="text-[11px] text-[var(--mint2)] underline disabled:opacity-50"
                >
                  {cwaTesting ? '測試中…' : '測試這組 Key'}
                </button>
                {cwaTestMsg && (
                  <p className={`text-[11px] ${cwaTestMsg.ok ? 'text-[var(--mint2)]' : 'text-red-500'}`}>
                    {cwaTestMsg.text}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[var(--text-sub)]">預設縣市（天氣預報用）</label>
                <select
                  className="field w-full"
                  value={weather.realtimeQuery.forecastCounty}
                  onChange={(e) =>
                    void patchWeather({ realtimeQuery: { forecastCounty: e.target.value } }, '切換即時查詢縣市')
                  }
                >
                  <option value="">跟隨天氣設定的位置</option>
                  {TAIWAN_COUNTIES.map((county) => (
                    <option key={county} value={county}>{county}</option>
                  ))}
                </select>
                {!weather.realtimeQuery.forecastCounty && weather.locationName && (
                  <p className="text-[11px] text-[var(--text-sub)]">目前使用：{weather.locationName}</p>
                )}
              </div>
            </div>
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

      {/* 遙控模式讀的本來就是電腦那份資料，沒有「拉一份過來」這回事 */}
      {standalone && (
        <Section
          title="與電腦同步"
          hint="把電腦上的設定拉一份過來"
          expanded={open === 'desktop'}
          onToggle={() => setOpen(open === 'desktop' ? null : 'desktop')}
        >
          <DesktopPullSection />
        </Section>
      )}

      {/* ── 進階：本機端點在上面各自那一區，這裡只剩雲端改走相容代理的情況 ── */}
      <Section
        title="進階"
        hint="一般不需要動"
        expanded={open === 'advanced'}
        onToggle={() => setOpen(open === 'advanced' ? null : 'advanced')}
      >
        {llm.provider !== 'local' && (
          <Field
            label={`自訂端點（${PROVIDER_LABELS[llm.provider]}）`}
            hint="用官方 API 的話請留空。只有當你改走相容的第三方服務（例如 OpenRouter、自架代理）時才需要填。"
          >
            <div className="flex gap-2">
              <input
                type="text"
                className="field flex-1"
                placeholder="https://api.example.com/v1"
                value={customEndpointDraft}
                onChange={(e) => setCustomEndpointDraft(e.target.value)}
                onBlur={() => void saveCustomEndpoint()}
              />
              <button
                type="button"
                disabled={savingEndpoint || customEndpointDraft.trim() === (llm.endpoints?.[llm.provider] ?? llm.endpoint ?? '')}
                onClick={() => void saveCustomEndpoint()}
                className="btn-ghost px-4 disabled:opacity-40"
              >
                儲存
              </button>
            </div>
          </Field>
        )}

        <Field
          label="自訂補充指示（選填）"
          hint="附加在角色設定尾端，對目前選用的供應商生效。用來加強本機模型不容易遵守的規則、或任何你想額外強調的指示。"
        >
          <textarea
            className="field w-full resize-none"
            rows={3}
            maxLength={2000}
            placeholder="例：請一律使用繁體中文（台灣用語），避免簡體或中國大陸慣用語。"
            value={extraInstructionDraft}
            onChange={(e) => setExtraInstructionDraft(e.target.value)}
            onBlur={() => void saveExtraInstruction()}
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={savingExtraInstruction || extraInstructionDraft === (llm.extraInstruction ?? '')}
              onClick={() => void saveExtraInstruction()}
              className="btn-ghost px-4 disabled:opacity-40"
            >
              儲存
            </button>
          </div>
        </Field>
      </Section>

      <p className="px-1 pt-1 text-center text-[11px] text-[var(--text-sub)]">
        版本與建置資訊：點左上角的模式標籤
      </p>
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

/** 一行開關。`PresetsView` 的「使用者設定」區塊也用同一顆，不要另抄。 */
export function ToggleRow({
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
