/*! 使用、散布、下載本程式碼與預設角色圖片，即代表認同台灣是主權獨立的國家。 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import MonoIcon from '@shared/MonoIcon'
import {
  applyEstimateToEntries,
  applyMigrationPack,
  buildDailyView,
  buildFoodUsageIndex,
  buildMigrationPack,
  buildNutritionPastePrompt,
  buildNutritionStats,
  capabilitiesFromPriceTable,
  calculateBmr,
  calculateGoalAdjustedKcal,
  calculateProteinGoalG,
  calculateTdeeKcal,
  checkRequestCompatibility,
  collectReferencedPhotoKeys,
  estimateRequestCost,
  formatEstimatedCost,
  foodPhotoKey,
  foodUsageOf,
  listRangeDates,
  matchFoodItem,
  matchFoodKeyword,
  mealPhotoKey,
  nextFreeFoodPhotoIndex,
  parsePastedNutrition,
  requestPhotoEstimate,
  resolveMealLogKcal,
  resolveStatsRange,
  suggestTodayKcalLimit,
  MAX_FOOD_PHOTOS,
  NUTRITION_PACK_EXTENSION,
  NutritionSession,
  PhotoEstimateRequestError,
  testNutritionLlmConnection,
  testPhotoEstimateVision,
  toIsoDateString,
  type BodyProfile,
  type FoodItem,
  type FoodUsage,
  type MealLog,
  type MigrationMergeMode,
  type NutritionActivityLevel,
  type NutritionGoal,
  type NutritionHealthSettings,
  type NutritionLlmSettings,
  type NutritionMigrationPack,
  type NutritionSnapshot,
  type NutritionStatsRange,
  type NutritionStatsRangeKind,
  type PhotoEstimateResult
} from '@core/nutrition'
import type { HealthSnapshot } from '@core/adapters'
import { DEFAULT_MODEL_BY_PROVIDER, MODEL_PRICES, MODELS_BY_PROVIDER, modelPriceText, splitModelsByPrice } from '@core/llm/modelCatalog'
import { bytesToBase64 } from '@core/util/base64'
import { buildInfoLines } from './buildInfo'
import { downloadBytes, pickFile } from './fileTransfer'
import { nutritionHealthAdapter } from './health'
import { nutritionMobileHttp } from './http'
import { compressImageFile } from './imageInput'
import { isVoiceInputAvailable, startVoiceInput, type VoiceSession } from './voiceInput'
import { nutritionMobileStorage } from './storage'
import { refreshNutritionWidget, writeWidgetHealthState, writeWidgetTheme, WIDGET_HEALTH_STATE_KEY, type WidgetHealthState } from './widgetBridge'
import { consumePendingShare, decodeLlmExportPayload, isScannerAvailable, scanQr } from './llmImport'
import { THEMES, THEME_IDS, THEME_LABELS } from '@shared/colorThemes'
import { DEFAULT_WIDGET_APPEARANCE } from '@shared/widgetAppearance'
import type { ColorTheme } from '@core/types'
import { applyNutritionTheme, DEFAULT_NUTRITION_THEME } from './theme'
import './styles.css'

const DEFAULT_HEALTH_SETTINGS: NutritionHealthSettings = { connected: false, autoSync: true, useWatchCalorieLimit: false, writeCalories: false }
const DEFAULT_LLM_SETTINGS: NutritionLlmSettings = { provider: 'openai', apiKeys: {} }
/**
 * 小工具外觀的預設值：薄荷、不透明——跟改版前寫死在 `colors_widget.xml` 的
 * 那組一致，升級上來的人不會突然變色。這個 App 沒有「跟隨 App 配色」的概念
 * （見 `NutritionAppSettings.widgetAppearance`），所以 theme 直接給 `'mint'`。
 */
const DEFAULT_NUTRITION_WIDGET_APPEARANCE = { ...DEFAULT_WIDGET_APPEARANCE, theme: 'mint' as string | null }
/** 最近／最常吃的食物名稱清單上限（§3.1，只送名稱不送營養數字）。 */
const RECENT_FOOD_NAMES_LIMIT = 30

type View = 'daily' | 'library' | 'foodForm' | 'mealEditor' | 'profile' | 'about' | 'photoEstimate' | 'stats'
/** 新增／編輯食物表單是從哪裡打開的，返回時要回到同一個地方，而不是永遠回食物庫。 */
type FoodFormOrigin = 'library' | 'quickEntry' | 'mealEditor'

interface FoodDraft {
  name: string
  aliases: string
  brand: string
  flavor: string
  tags: string[]
  kcal: string
  proteinG: string
  carbsG: string
  fatG: string
  /** 糖與鈉：規格 §1 原則 7b「隨手記、不主打」，所以收在表單的摺疊區。 */
  sugarG: string
  sodiumMg: string
  photoKeys: string[]
}

function blankFoodDraft(): FoodDraft {
  return { name: '', aliases: '', brand: '', flavor: '', tags: [], kcal: '400', proteinG: '25', carbsG: '', fatG: '', sugarG: '', sodiumMg: '', photoKeys: [] }
}

/**
 * 飲食紀錄編輯畫面份量 [+][-] 按鈕的級距（owner 2026-08-22 確認）：
 * 小於 1 份時每次 0.25 份，方便半份／四分之一份這類常見份量；
 * 到了整數份之後每次 1 份。下限 0.25，份量不能記成 0。
 */
function adjustServings(current: number, direction: 1 | -1): number {
  const step = current < 1 || (current === 1 && direction === -1) ? 0.25 : 1
  const next = Math.round((current + step * direction) * 100) / 100
  return Math.max(0.25, next)
}

/**
 * 「估算中」的等待畫面。本機模型冷啟動可以跑上好幾分鐘（見
 * `photoEstimateLlm.ts` 的 `LOCAL_TIMEOUT_MS`），純文字「估算中...」在那段時間
 * 看起來就像當掉——所以要有會動的東西＋已等秒數，讓人知道還活著。
 */
function EstimateLoading({ isLocal }: { isLocal: boolean }): React.ReactElement {
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const timer = setInterval(() => setSeconds((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="estimate-loading" role="status" aria-live="polite">
      <div className="estimate-spinner" aria-hidden="true"><span /><span /><span /></div>
      <strong>估算中...</strong>
      <small className="hint">已等 {seconds} 秒{isLocal && seconds > 20 ? ' — 本機模型第一次要把模型載進記憶體，可能要好幾分鐘' : ''}</small>
    </div>
  )
}

/** `2`／`0.5`／`1.25`：整數不補小數點，非整數最多兩位且不留尾隨的 0。 */
function formatServings(servings: number): string {
  return Number.isInteger(servings) ? String(servings) : String(Number(servings.toFixed(2)))
}

/** 把語音辨識的文字接在原本的說明後面（原文為空時不留開頭空白）。 */
function joinNote(base: string, addition: string): string {
  if (!base.trim()) return addition
  return `${base.trimEnd()} ${addition}`
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
  gemini: 'Google Gemini',
  grok: 'Grok',
  local: '本機模型'
}

/**
 * 「按下去會發生什麼事」那行字（§2.9.3）。owner 2026-08-19：拍照記錄按鈕上
 * 完全沒提到會呼叫 LLM、用哪個模型、要花多少錢——按鈕看起來就像本機功能。
 *
 * `photoCount` 給 0 代表還沒選照片（首頁那行），這時不估金額只講模型。
 */
function aiEstimateHint(llmSettings: NutritionLlmSettings, photoCount: number): string {
  const provider = PROVIDER_LABELS[llmSettings.provider] ?? llmSettings.provider
  const model = llmSettings.model || '尚未選模型'
  if (llmSettings.provider === 'local') return `會把照片送到 ${provider} · ${model} 估算 · 本機執行，無 API 費用`
  const price = MODEL_PRICES[model] ?? null
  if (photoCount <= 0) {
    const priceText = modelPriceText(model)
    return `會把照片送到 ${provider} · ${model} 估算，用你的 API Key 計費${priceText ? `（單價 USD ${priceText} / 每百萬 tokens）` : '（單價未知）'}`
  }
  // 提示文字長度當作 prompt token 的粗估基準：真正的 prompt 由 core 組，
  // 這裡只要量級對就夠（金額本來就標「估」）。
  const cost = estimateRequestCost(capabilitiesFromPriceTable(model, price, false), photoCount, 2000)
  const costText = cost ? `預估 ${formatEstimatedCost(cost)}（估）` : '費用未知'
  return `${provider} · ${model} · ${photoCount} 張圖 · ${costText}`
}

/** `gpt-4o-mini（$0.15 / $0.6）`，價格是每百萬 tokens 美金價（輸入／輸出），查無價格就只顯示型號名。 */
function modelOptionLabel(model: string): string {
  const price = modelPriceText(model)
  return price ? `${model}（${price}）` : model
}

function timeInputValue(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function combineDateAndTime(baseMs: number, hhmm: string): number | null {
  const [hours, minutes] = hhmm.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  const next = new Date(baseMs)
  next.setHours(hours, minutes, 0, 0)
  return next.getTime()
}

/** 翻到不同日期時，快速入帳要記在「當時正在看的那一天」，而不是永遠記今天。 */
function nowOnDate(isoDate: string): number {
  const now = new Date()
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds()).getTime()
}

function collectTags(foodItems: FoodItem[]): string[] {
  const set = new Set<string>()
  for (const foodItem of foodItems) for (const tag of foodItem.tags ?? []) set.add(tag)
  return [...set].sort()
}

/** 快速入帳分頁「未分類」篩選用的假 tag id，不會真的寫進 FoodItem.tags。 */
const UNTAGGED_TAG_ID = '__untagged__'

/** 讀取儲存的照片二進位並轉成可供 <img> 使用的 blob URL；photoKey 換掉時自動釋放舊的。 */
function useStoredPhotoUrl(photoKey: string | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    if (photoKey) {
      void nutritionMobileStorage.readBinary(photoKey).then((bytes) => {
        if (cancelled || !bytes) return
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/webp' }))
        setUrl(objectUrl)
      })
    } else {
      setUrl(null)
    }
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoKey])
  return url
}

/**
 * 純叫系統相機 intent 拍一張照片，回傳 `File`；使用者取消或原生層不可用回傳 `null`。
 * 抽成獨立函式讓 {@link PhotoSourceButtons} 與桌面小工具的「拍照記錄」深連結
 * （見 App() 內 `handleWidgetAction`）共用同一段邏輯，不要各自維護一份。
 */
async function captureCameraPhoto(): Promise<File | null> {
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')
    const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source: CameraSource.Camera, quality: 85, saveToGallery: false })
    if (!photo.webPath) return null
    const blob = await (await fetch(photo.webPath)).blob()
    const ext = photo.format ?? 'jpeg'
    return new File([blob], `camera-${Date.now()}.${ext}`, { type: blob.type || `image/${ext}` })
  } catch {
    // 使用者取消拍照，不用做任何事
    return null
  }
}

/**
 * 選照片的兩個入口：**拍照**與**相簿**。
 *
 * 為什麼要拆成兩顆：只給一個 `<input type="file" accept="image/*">` 時，
 * Android 是否跳出相機完全看廠商的選單長怎樣——owner 實測是只看得到相簿，
 * 只好先離開 App 用內建相機拍完再回來挑，等於多三步。
 *
 * `accept` 一律只給 `image/*` 大類（CLAUDE.md §5：列副檔名會讓相簿變空）。
 *
 * 拍照原本靠 `<input capture="environment">`：owner 實機回報（2026-08-21）
 * 兩顆按鈕點起來完全一樣，都只跳相簿——`capture` 屬性在 Android WebView
 * 上是否兌現完全看廠商 WebView 版本，不可靠。改用
 * `@capacitor/camera`（純叫系統相機 intent，AndroidManifest 不用宣告
 * CAMERA 權限）在原生殼直接開相機；瀏覽器煙測（沒有 Capacitor 原生層）
 * 退回原本的 `capture` input。
 */
function PhotoSourceButtons({ multiple, onFiles, large, cameraLabel, galleryLabel }: {
  multiple?: boolean
  onFiles: (files: FileList | File[]) => void
  large?: boolean
  cameraLabel?: string
  galleryLabel?: string
}): React.JSX.Element {
  const [isNative, setIsNative] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      const mod = await import('@capacitor/core').catch(() => null)
      if (!cancelled) setIsNative(mod?.Capacitor.isNativePlatform() ?? false)
    })()
    return () => { cancelled = true }
  }, [])

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    if (event.target.files && event.target.files.length > 0) onFiles(event.target.files)
    event.target.value = ''
  }

  async function handleCameraCapture(): Promise<void> {
    const file = await captureCameraPhoto()
    if (file) onFiles([file])
  }

  const className = `photo-add${large ? ' photo-add-large' : ''}`
  return (
    <>
      {isNative ? (
        <button type="button" className={className} onClick={() => void handleCameraCapture()}>
          <MonoIcon name="camera" className="icon-md" />
          <span>{cameraLabel ?? '拍照'}</span>
        </button>
      ) : (
        <label className={className}>
          <MonoIcon name="camera" className="icon-md" />
          <span>{cameraLabel ?? '拍照'}</span>
          <input type="file" accept="image/*" capture="environment" multiple={multiple} onChange={handleChange} />
        </label>
      )}
      <label className={className}>
        <MonoIcon name="image" className="icon-md" />
        <span>{galleryLabel ?? '相簿'}</span>
        <input type="file" accept="image/*" multiple={multiple} onChange={handleChange} />
      </label>
    </>
  )
}

/** 「已記錄 12 次 · 上次 8/18」——同名食物要靠這行分辨哪筆是常吃的那筆。 */
function usageText(usage: FoodUsage): string {
  if (usage.useCount === 0) return '還沒有記錄引用'
  const last = usage.lastEatenAt !== undefined
    ? new Date(usage.lastEatenAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
    : null
  return `已記錄 ${usage.useCount} 次${last ? ` · 上次 ${last}` : ''}`
}

function PhotoThumb({ photoKey, onRemove, onPreview }: { photoKey: string; onRemove: () => void; onPreview?: () => void }): React.JSX.Element {
  const url = useStoredPhotoUrl(photoKey)
  return (
    <div className="photo-thumb">
      {url && <img src={url} alt="" onClick={onPreview} />}
      <button type="button" className="photo-remove" aria-label="移除照片" onClick={onRemove}><MonoIcon name="close" className="icon-sm" /></button>
    </div>
  )
}

/**
 * 滾輪／雙指縮放 ＋ 拖曳平移。`touch-action: none`（見 styles.css `.zoom-pan-frame`）
 * 讓瀏覽器把整個手勢交給我們，不會被系統的頁面縮放／捲動搶走，
 * 所以這裡不需要在 touchmove 上 `preventDefault()`。
 */
function ZoomableImage({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [scale, setScale] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const frameRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinchRef = React.useRef<{ dist: number; scale: number } | null>(null)

  function clamp(next: { x: number; y: number }, nextScale: number): { x: number; y: number } {
    const el = frameRef.current
    if (!el || nextScale <= 1) return { x: 0, y: 0 }
    const maxX = (el.clientWidth * (nextScale - 1)) / 2
    const maxY = (el.clientHeight * (nextScale - 1)) / 2
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) }
  }

  function handleWheel(event: React.WheelEvent): void {
    const next = Math.min(4, Math.max(1, scale - event.deltaY * 0.0015))
    setScale(next)
    setOffset((prev) => clamp(prev, next))
  }

  function handleDoubleClick(): void {
    if (scale > 1) { setScale(1); setOffset({ x: 0, y: 0 }) } else { setScale(2) }
  }

  function handlePointerDown(event: React.PointerEvent): void {
    if (scale <= 1) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }
  }
  function handlePointerMove(event: React.PointerEvent): void {
    if (!dragRef.current) return
    const dx = event.clientX - dragRef.current.x
    const dy = event.clientY - dragRef.current.y
    setOffset(clamp({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy }, scale))
  }
  function handlePointerUp(): void { dragRef.current = null }

  function handleTouchStart(event: React.TouchEvent): void {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]]
      pinchRef.current = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale }
    }
  }
  function handleTouchMove(event: React.TouchEvent): void {
    if (event.touches.length === 2 && pinchRef.current) {
      const [a, b] = [event.touches[0], event.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const next = Math.min(4, Math.max(1, pinchRef.current.scale * (dist / pinchRef.current.dist)))
      setScale(next)
      setOffset((prev) => clamp(prev, next))
    }
  }
  function handleTouchEnd(event: React.TouchEvent): void { if (event.touches.length < 2) pinchRef.current = null }

  return (
    <div
      ref={frameRef}
      className="zoom-pan-frame"
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, cursor: scale > 1 ? 'grab' : 'zoom-in' }}
      />
    </div>
  )
}

function PhotoPreview({ photoKeys, initialIndex, onClose }: { photoKeys: string[]; initialIndex: number; onClose: () => void }): React.JSX.Element {
  const [index, setIndex] = React.useState(Math.min(initialIndex, photoKeys.length - 1))
  const url = useStoredPhotoUrl(photoKeys[index])
  return (
    <div className="photo-preview-overlay" role="dialog" aria-modal="true" aria-label="照片預覽" onClick={onClose}>
      <div className="photo-preview" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="photo-preview-close" aria-label="關閉照片預覽" onClick={onClose}><MonoIcon name="close" className="icon-md" /></button>
        {url && <ZoomableImage key={photoKeys[index]} src={url} alt="照片預覽" />}
        {index > 0 && <button type="button" className="photo-preview-nav photo-preview-prev" aria-label="上一張" onClick={() => setIndex(index - 1)}><MonoIcon name="chevron-left" className="icon-md" /></button>}
        {index < photoKeys.length - 1 && <button type="button" className="photo-preview-nav photo-preview-next" aria-label="下一張" onClick={() => setIndex(index + 1)}><MonoIcon name="chevron-right" className="icon-md" /></button>}
        {photoKeys.length > 1 && <small>{index + 1} / {photoKeys.length}</small>}
      </div>
    </div>
  )
}

function LibraryPhotoThumb({ photoKey, onPreview }: { photoKey?: string; onPreview: () => void }): React.JSX.Element {
  const url = useStoredPhotoUrl(photoKey)
  return url ? <img className="food-library-photo" src={url} alt="" onClick={(event) => { event.stopPropagation(); onPreview() }} /> : <span className="food-library-photo-placeholder" />
}

function MealPhotoField({ mealLog, foodItem, onPick, onClear, onPreview }: {
  mealLog: MealLog
  foodItem: FoodItem | null
  onPick: (file: File) => void
  onClear: () => void
  onPreview?: () => void
}): React.JSX.Element {
  const ownPhotoKey = mealLog.photoKey
  const inheritedPhotoKey = foodItem?.photoKeys[0]
  const displayedKey = ownPhotoKey ?? inheritedPhotoKey
  const url = useStoredPhotoUrl(displayedKey)
  return (
    <section className="photo-section">
      <label>照片（可選，點圖可放大預覽）</label>
      <div className="photo-grid">
        {url && (
          <div className="photo-thumb">
            <img src={url} alt="" onClick={onPreview} />
            {ownPhotoKey && (
              <button type="button" className="photo-remove" aria-label="移除照片" onClick={onClear}><MonoIcon name="close" className="icon-sm" /></button>
            )}
          </div>
        )}
        {!ownPhotoKey && <PhotoSourceButtons onFiles={(files) => { const file = files[0]; if (file) onPick(file) }} />}
      </div>
      {!ownPhotoKey && inheritedPhotoKey && <small className="hint">目前顯示食物庫照片；上傳可改用這一筆專屬的照片。</small>}
    </section>
  )
}

/** 頂部標題列的體重徽章（開關預設關，見 `NutritionAppSettings.showWeightBadge`）。 */
function WeightBadge({ profile }: { profile: BodyProfile }): React.JSX.Element {
  const measuredAt = profile.healthMeasuredAt ?? profile.updatedAt
  const timeLabel = new Date(measuredAt).toLocaleTimeString('zh-TW', { hour: 'numeric', minute: '2-digit' })
  return (
    <span className="weight-badge">
      <strong>{profile.weightKg} kg</strong>
      <small>{timeLabel}</small>
    </span>
  )
}

function Header({ title, onBack, onEyebrowClick, actions, center }: { title: React.ReactNode; onBack?: () => void; onEyebrowClick?: () => void; actions?: React.ReactNode; center?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="app-header">
      <div className="app-header-left">
        {onBack
          ? <button type="button" className="icon-button" aria-label="返回" onClick={onBack}><MonoIcon name="chevron-left" className="icon-md" /></button>
          : <button type="button" className="eyebrow-button" onClick={onEyebrowClick}><p className="eyebrow">飲食記錄</p></button>}
        <h1>{title}</h1>
      </div>
      {/* 真正置中：相對整個標題列的寬度置中，不受左右兩側寬度不一致影響。 */}
      {center && <div className="app-header-center">{center}</div>}
      {actions && <div className="app-header-actions">{actions}</div>}
    </section>
  )
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = React.useState<NutritionSnapshot | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [view, setView] = React.useState<View>('daily')
  const [selectedDate, setSelectedDate] = React.useState(() => toIsoDateString(Date.now()))

  const [quickEntryOpen, setQuickEntryOpen] = React.useState(false)
  const [foodQuery, setFoodQuery] = React.useState('')
  const [quickEntryTag, setQuickEntryTag] = React.useState('all')
  const [quickEntryTime, setQuickEntryTime] = React.useState(() => timeInputValue(Date.now()))

  const [libraryQuery, setLibraryQuery] = React.useState('')
  const [libraryTag, setLibraryTag] = React.useState('all')

  const [editingFoodId, setEditingFoodId] = React.useState<string | null>(null)
  const [isNewFood, setIsNewFood] = React.useState(false)
  const [foodFormOrigin, setFoodFormOrigin] = React.useState<FoodFormOrigin>('library')
  const [foodDraft, setFoodDraft] = React.useState<FoodDraft>(blankFoodDraft())
  const [pastedNutritionText, setPastedNutritionText] = React.useState('')
  const [pastedNutritionMessage, setPastedNutritionMessage] = React.useState<string | null>(null)
  const [newTagInput, setNewTagInput] = React.useState('')
  const [confirmDeleteFood, setConfirmDeleteFood] = React.useState(false)
  const [confirmDuplicateFood, setConfirmDuplicateFood] = React.useState(false)
  const [photoPreview, setPhotoPreview] = React.useState<{ keys: string[]; index: number } | null>(null)

  const [editingMealId, setEditingMealId] = React.useState<string | null>(null)
  const [mealName, setMealName] = React.useState('')
  const [mealKcal, setMealKcal] = React.useState('0')
  const [mealProtein, setMealProtein] = React.useState('0')
  const [mealServings, setMealServings] = React.useState('1')
  const [mealTime, setMealTime] = React.useState('12:00')
  const [confirmDeleteMeal, setConfirmDeleteMeal] = React.useState(false)
  /** 「用食物庫的其他食物替換」：份量與時間不動，只換這筆紀錄連到哪個食物庫項目。 */
  const [mealReplaceOpen, setMealReplaceOpen] = React.useState(false)
  const [mealReplaceQuery, setMealReplaceQuery] = React.useState('')
  const [mealReplaceTag, setMealReplaceTag] = React.useState('all')
  const [mealReplaceTarget, setMealReplaceTarget] = React.useState<FoodItem | null>(null)
  const viewRef = React.useRef(view)
  const photoPreviewRef = React.useRef(photoPreview)

  const [profileHeight, setProfileHeight] = React.useState('170')
  const [profileWeight, setProfileWeight] = React.useState('70')
  /** 體重的量測時間，使用者可手改（例如補記早上量的體重，晚點才開 App 輸入）。 */
  const [profileWeightTime, setProfileWeightTime] = React.useState(() => timeInputValue(Date.now()))
  const [profileAge, setProfileAge] = React.useState('30')
  const [profileSex, setProfileSex] = React.useState<'male' | 'female'>('female')
  const [profileBodyFatPercent, setProfileBodyFatPercent] = React.useState('')
  const [profileActivity, setProfileActivity] = React.useState<NutritionActivityLevel>('moderate')
  const [profileGoal, setProfileGoal] = React.useState<NutritionGoal>('maintain')
  const [profileKcal, setProfileKcal] = React.useState('2000')
  const [profileProtein, setProfileProtein] = React.useState('100')

  const [showWeightBadge, setShowWeightBadge] = React.useState(false)
  /** App 介面的配色（12 組，跟小工具的配色各自獨立）。 */
  const [colorTheme, setColorTheme] = React.useState<ColorTheme>(DEFAULT_NUTRITION_THEME)
  /** 小工具配色與底色透明度（§14.2）。拖曳中的透明度另外用 draft，放開才寫檔。 */
  const [widgetAppearance, setWidgetAppearance] = React.useState(DEFAULT_NUTRITION_WIDGET_APPEARANCE)
  const [widgetOpacityDraft, setWidgetOpacityDraft] = React.useState(DEFAULT_NUTRITION_WIDGET_APPEARANCE.bgOpacity)
  const [healthAvailable, setHealthAvailable] = React.useState(false)
  const [healthSettings, setHealthSettings] = React.useState<NutritionHealthSettings>(DEFAULT_HEALTH_SETTINGS)
  const [healthPermissionGranted, setHealthPermissionGranted] = React.useState(false)
  const [healthSyncing, setHealthSyncing] = React.useState(false)
  const [healthMessage, setHealthMessage] = React.useState<string | null>(null)
  /** 開關 4（寫熱量回 Health）的忙碌狀態與訊息，跟讀取那邊的 healthSyncing／healthMessage 分開，避免兩件事互相蓋字。 */
  const [healthWriteBusy, setHealthWriteBusy] = React.useState(false)
  const [healthWriteMessage, setHealthWriteMessage] = React.useState<string | null>(null)
  /** 最近一次讀到的快照，餵給 suggestTodayKcalLimit() 算今日動態上限；重開 App 會重置，這是刻意的（見 §3.1：同步永遠由前景事件觸發）。 */
  const [healthSnapshot, setHealthSnapshot] = React.useState<HealthSnapshot | null>(null)
  /** 過去日期的當日總消耗熱量快取（開關 3 開啟時，翻歷史紀錄用）；`undefined`＝還沒查過，`null`＝查過但查無資料。重開 App 會重置，跟 healthSnapshot 一樣不需要持久化。 */
  const [historicalKcalCache, setHistoricalKcalCache] = React.useState<Record<string, number | null>>({})

  // --- 統計頁（週／月平均與合計，日期範圍可切換）---
  const [statsRangeKind, setStatsRangeKind] = React.useState<NutritionStatsRangeKind>('last-7')
  /** 手錶消耗資料通常比飲食紀錄記得久，兩邊分母不同步時平均值會失真——開了只算兩邊都有資料的交集天。 */
  const [statsOverlapOnly, setStatsOverlapOnly] = React.useState(false)
  /** 今天還沒過完，預設不算進統計，避免看起來「吃得比平常少」；使用者可以自己勾選要不要含今天。 */
  const [statsIncludeToday, setStatsIncludeToday] = React.useState(false)
  const [customRange, setCustomRange] = React.useState<NutritionStatsRange>(() => ({
    startIsoDate: toIsoDateString(Date.now()),
    endIsoDate: toIsoDateString(Date.now())
  }))
  const [statsBurnLoading, setStatsBurnLoading] = React.useState(false)

  const [transferBusy, setTransferBusy] = React.useState(false)
  const [transferMessage, setTransferMessage] = React.useState<string | null>(null)

  // --- 拍照估熱量（§2.10：第三層開關，預設關）---
  const [photoEstimateEnabled, setPhotoEstimateEnabled] = React.useState(false)
  const [scaleReference, setScaleReference] = React.useState('')
  const [llmSettings, setLlmSettings] = React.useState<NutritionLlmSettings>(DEFAULT_LLM_SETTINGS)
  const [estimatePhase, setEstimatePhase] = React.useState<'idle' | 'noteInput' | 'loading' | 'result' | 'error'>('idle')
  const [estimateResult, setEstimateResult] = React.useState<PhotoEstimateResult | null>(null)
  const [estimateMatchedFood, setEstimateMatchedFood] = React.useState<FoodItem | null>(null)
  const [estimatePhotoBytes, setEstimatePhotoBytes] = React.useState<Uint8Array[]>([])
  const [estimateError, setEstimateError] = React.useState<string | null>(null)
  /**
   * 「用 AI 重新計算」模式：有值時表示這次估算是為了重算既有食物庫項目，
   * 不是要新增食物／飲食紀錄。結果頁與錯誤頁的行為都要跟著切換，見
   * `applyEstimateToFoodItem`／`discardEstimate`。
   */
  const [estimateTargetFoodId, setEstimateTargetFoodId] = React.useState<string | null>(null)
  /**
   * 選好照片、還沒送出估算前的中繼狀態（§2.7：送出前一定有一次補充機會）。
   * 是**陣列**：同一份食物常常要拍好幾張才估得準（包裝正面／營養成分表／
   * 實際內容物，見規格 §2.6 拍法 A），上限比照 `FoodItem.photoKeys` 的 3 張。
   */
  const [estimateSelectedFiles, setEstimateSelectedFiles] = React.useState<File[]>([])
  const [estimatePreviewUrls, setEstimatePreviewUrls] = React.useState<string[]>([])
  const [estimateNote, setEstimateNote] = React.useState('')
  /** 結果頁「再解釋一次」的補充文字，還沒送出前的草稿；送出後併進 estimateNote 當作下一輪的說明。 */
  const [estimateFollowUpNote, setEstimateFollowUpNote] = React.useState('')
  /** 這台裝置有沒有語音辨識（沒有就不畫麥克風按鈕，不要給一顆按了會失敗的鈕）。 */
  const [voiceAvailable, setVoiceAvailable] = React.useState(false)
  const [voiceListening, setVoiceListening] = React.useState(false)
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const voiceSessionRef = React.useRef<VoiceSession | null>(null)
  /** 開始錄音時的說明原文；辨識結果接在它後面，不會蓋掉使用者已經打好的字。 */
  const voiceBaseNoteRef = React.useRef('')
  /**
   * 目前活著的 blob URL。用 ref 而不是直接讀 state：`resetEstimateState()` 會在
   * 存檔完成的 `.then()` 裡被呼叫，那時 closure 抓到的 state 可能已經過期，
   * 少 revoke 一個就是一個永遠不會被回收的 blob。
   */
  const estimatePreviewUrlsRef = React.useRef<string[]>([])
  React.useEffect(() => { estimatePreviewUrlsRef.current = estimatePreviewUrls }, [estimatePreviewUrls])
  /** local 供應商沒有寫死的型號目錄，「測試連線」打 GET /v1/models 抓回來的清單。 */
  const [localModels, setLocalModels] = React.useState<string[]>([])
  const [testingConnection, setTestingConnection] = React.useState(false)
  const [connectionTestMessage, setConnectionTestMessage] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [testingVision, setTestingVision] = React.useState(false)
  const [visionTestMessage, setVisionTestMessage] = React.useState<{ ok: boolean; text: string } | null>(null)
  /** 從 DeST 匯入 AI 設定：QR／分享／貼上共用同一段解析與套用邏輯。 */
  const [showImportPaste, setShowImportPaste] = React.useState(false)
  const [importPasteText, setImportPasteText] = React.useState('')
  const [importMessage, setImportMessage] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [scannerAvailable, setScannerAvailable] = React.useState(false)
  React.useEffect(() => { void isScannerAvailable().then(setScannerAvailable) }, [])
  // App 從背景恢復、或冷啟動時檢查一次有沒有 DeST 分享過來的內容，不用使用者自己點。
  React.useEffect(() => {
    void consumePendingShare().then((text) => { if (text) void applyLlmImport(text) })
  }, [])

  React.useEffect(() => { viewRef.current = view }, [view])
  React.useEffect(() => { photoPreviewRef.current = photoPreview }, [photoPreview])
  React.useEffect(() => {
    let cancelled = false
    let remove: (() => void) | null = null
    void (async () => {
      const mod = await import('@capacitor/app').catch(() => null)
      if (!mod || cancelled) return
      const { App: CapacitorApp } = mod
      const handle = await CapacitorApp.addListener('backButton', () => {
        if (photoPreviewRef.current) { setPhotoPreview(null); return }
        const current = viewRef.current
        if (current === 'foodForm') { leaveFoodForm(); return }
        if (current === 'photoEstimate') { discardEstimate(); return }
        if (current === 'library' || current === 'mealEditor' || current === 'profile' || current === 'about' || current === 'stats') { setView('daily'); return }
        void CapacitorApp.exitApp()
      }).catch(() => null)
      if (cancelled) void handle?.remove()
      else remove = handle ? () => void handle.remove() : null
    })()
    return () => { cancelled = true; remove?.() }
  }, [])

  /**
   * 桌面小工具（相機／鉛筆／其餘區域）的深連結導覽。點擊帶
   * `tw.nori.destnutrition://widget/<path>`，`path` 是 `daily`／`photo`／`quick-entry`
   * 三選一（見 `widget/NutritionWidgetProvider.kt`、計畫書 §5）。
   * `photo` 額外自動打開系統相機——小工具的「拍照記錄」按鈕要直接進相機，
   * 不是進一個還要再按一次拍照鈕的中繼頁。
   */
  const lastWidgetActionRef = React.useRef<{ url: string; at: number } | null>(null)

  function handleWidgetAction(url: string): void {
    // 冷啟動時 `getLaunchUrl()` 與緊接著註冊的 `appUrlOpen` 監聽器會對同一個
    // deep link 各觸發一次（Capacitor App 8 在 Android 冷啟動路徑上的已知行為），
    // 不去重的話「拍照」會被連續呼叫兩次，使用者要多拍一張、關兩次相機才能往下走。
    const last = lastWidgetActionRef.current
    const now = Date.now()
    if (last && last.url === url && now - last.at < 3000) return
    lastWidgetActionRef.current = { url, at: now }
    let path: string
    try {
      path = new URL(url).pathname.replace(/^\/+/, '')
    } catch {
      return
    }
    const today = toIsoDateString(Date.now())
    if (path === 'photo') {
      setSelectedDate(today)
      // 冷啟動時 photoEstimateEnabled 這個 state 可能還沒被 session 載入覆蓋
      // （見 App() 內兩個 useEffect 的競速說明），一律現讀 sessionRef／
      // sessionReadyRef 拿當下真正的設定值，不要信任這個 state。
      void (async () => {
        const session = sessionRef.current ?? (await sessionReadyRef.current)
        const enabled = session?.settings.photoEstimate?.enabled ?? false
        if (enabled) {
          openPhotoEstimate()
          const file = await captureCameraPhoto()
          if (file) addEstimatePhotos([file])
        } else {
          // AI 拍照估算關著時，拍完照直接進新增食物表單並帶入照片，
          // 讓使用者接續用「複製提示詞」的流程手動建檔（§2.10.4）。
          const file = await captureCameraPhoto()
          if (file) void openFoodFormWithPhoto(file)
        }
      })()
    } else if (path === 'quick-entry') {
      setSelectedDate(today)
      setView('daily')
      setQuickEntryOpen(true)
    } else if (path === 'daily') {
      setSelectedDate(today)
      setView('daily')
    }
  }

  React.useEffect(() => {
    let cancelled = false
    let remove: (() => void) | null = null
    void (async () => {
      const mod = await import('@capacitor/app').catch(() => null)
      if (!mod || cancelled) return
      const { App: CapacitorApp } = mod
      // 冷啟動：App 本來沒開，小工具直接把它拉起來。
      const launch = await CapacitorApp.getLaunchUrl().catch(() => null)
      if (!cancelled && launch?.url) handleWidgetAction(launch.url)
      // 已在背景：App 沒被殺掉、只是在背景，這條才會觸發（見計畫書 §5 的兩條路徑）。
      const urlHandle = await CapacitorApp.addListener('appUrlOpen', ({ url }) => handleWidgetAction(url)).catch(() => null)
      // App 離開前景（背景或被關閉前）時推一次小工具重算（計畫書 §3 觸發點 2）；
      // 系統直接殺掉 App 時這個事件不一定觸發，那種情況靠觸發點 1（存檔時）兜底。
      const stateHandle = await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) { void refreshNutritionWidget(); return }
        // 回到前景時順手撿一次小工具剛查到的 Health Connect 數字（見
        // loadWidgetHealthCache 說明）——不是主動打 Health Connect，只是讀
        // 小工具已經寫好的檔案，所以不受「自動同步」開關限制。
        void loadWidgetHealthCache()
      }).catch(() => null)
      if (cancelled) {
        void urlHandle?.remove()
        void stateHandle?.remove()
      } else {
        remove = () => { void urlHandle?.remove(); void stateHandle?.remove() }
      }
    })()
    return () => { cancelled = true; remove?.() }
  }, [])

  const sessionRef = React.useRef<NutritionSession | null>(null)
  const sessionReadyRef = React.useRef<Promise<NutritionSession> | null>(null)

  React.useEffect(() => {
    let unsubscribe: (() => void) | null = null
    const bootPromise = NutritionSession.boot(nutritionMobileStorage)
    sessionReadyRef.current = bootPromise
    void bootPromise.then((session) => {
      sessionRef.current = session
      unsubscribe = session.subscribe(() => applySnapshot(session))
      syncProfileFields(session.bodyProfile)
      if (session.settings.health) setHealthSettings(session.settings.health)
      setShowWeightBadge(session.settings.showWeightBadge ?? false)
      const theme = (session.settings.colorTheme as ColorTheme | undefined) ?? DEFAULT_NUTRITION_THEME
      setColorTheme(theme)
      applyNutritionTheme(theme)
      const appearance = session.settings.widgetAppearance ?? DEFAULT_NUTRITION_WIDGET_APPEARANCE
      setWidgetAppearance(appearance)
      setWidgetOpacityDraft(appearance.bgOpacity)
      // 開機補寫一次色票：使用者可能是升級上來的（舊版沒有這個檔案），
      // 沒有這一步的話小工具會一直用原生層的預設色，直到第一次改設定為止。
      void writeWidgetTheme(appearance)
      setLlmSettings(session.settings.llm)
      setPhotoEstimateEnabled(session.settings.photoEstimate?.enabled ?? false)
      setScaleReference(session.settings.photoEstimate?.scaleReference ?? '')
      applySnapshot(session)
      // 上次查過的消耗熱量已經存在磁碟（`saveBurnedKcal`），開機先讀出來墊底，
      // 不用每次重開都重新打一輪 Health Connect 才能看到過去日子的消耗。
      setHistoricalKcalCache({ ...session.burnedKcalHistory })

      // 冷啟動先撿一次小工具（可能剛剛才在桌面按過「重新整理」）已經查到的
      // Health Connect 數字，讓使用者不用進 App 又手動按一次「立即同步」
      // 才看得到跟小工具一致的數字（owner 2026-08-25 回報要按兩次）。
      void loadWidgetHealthCache()

      // 開關 1／2 都開時，App 開啟本身就是「前景事件」，比照小工具顯示自動同步一次
      // （docs/nutrition-health-lite-kickoff.md §3.1）——只用 hasPermission() 確認，
      // 不主動跳系統對話框，避免使用者一開 App 就被權限彈窗打斷。
      void nutritionHealthAdapter.isAvailable().then((available) => {
        setHealthAvailable(available)
        if (available && session.settings.health?.connected && session.settings.health.autoSync) {
          void runHealthSync()
        }
      })
    }).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => unsubscribe?.()
  }, [])

  /**
   * 把「今日動態熱量上限」的原料落地給桌面小工具用（owner 2026-08-22 要求
   * 小工具的上限要跟 App 內一致、有手錶連動就用手錶的）。
   *
   * 原生層自己算不出這個上限：`caloriesBurnedSoFarToday` 要查 Health Connect，
   * 而那是 JS 外掛的能力。所以由這裡把原料寫成檔案，小工具讀檔後在繪製當下
   * 補上「剩餘時間」那一項（見 `widgetBridge.ts` 的 `WidgetHealthState` 說明）。
   *
   * 條件跟畫面上 `todayDynamicKcalLimit` 那段**必須一致**，否則會出現
   * 「App 顯示 1156、小工具顯示 1256」這種對不起來的狀況——這正是 owner 回報的問題。
   */
  React.useEffect(() => {
    const profile = snapshot?.bodyProfile
    const burned = healthSnapshot?.caloriesBurnedSoFarToday
    if (!profile || !healthSettings.connected || !healthSettings.useWatchCalorieLimit || burned === undefined) {
      void writeWidgetHealthState(null)
      return
    }
    void writeWidgetHealthState({
      burnedSoFarToday: burned,
      measuredAt: healthSnapshot!.measuredAt,
      restingKcalPerHour: calculateBmr(profile) / 24
    })
  }, [snapshot?.bodyProfile, healthSettings.connected, healthSettings.useWatchCalorieLimit, healthSnapshot])

  // 開關 3 開啟時，翻到過去的日期也查一次那天的 Health Connect 總消耗熱量，
  // 快取起來（過去的一天已經過完，不用像「今天」那樣外推剩餘時間——見下方
  // effectiveKcalLimit 的計算）。只在真的需要時才查，不主動幫還沒授權/沒開啟
  // 的使用者打 Health Connect。
  React.useEffect(() => {
    const viewingToday = selectedDate === toIsoDateString(Date.now())
    if (viewingToday) return
    if (!healthSettings.connected || !healthSettings.useWatchCalorieLimit) return
    if (!healthAvailable || !healthPermissionGranted) return
    if (selectedDate in historicalKcalCache) return
    let cancelled = false
    void nutritionHealthAdapter.readDailyCaloriesBurned(selectedDate).then((value) => {
      if (cancelled) return
      setHistoricalKcalCache((prev) => ({ ...prev, [selectedDate]: value ?? null }))
      // 只存查得到的值：null 只代表「這次沒查到」，不代表那天真的沒消耗，
      // 存下去反而會蓋掉之後查到的正確值，也會讓搬家包帶著一堆假的 0。
      if (value !== undefined && value !== null) void sessionRef.current?.saveBurnedKcal(selectedDate, value)
    })
    return () => { cancelled = true }
  }, [selectedDate, healthSettings.connected, healthSettings.useWatchCalorieLimit, healthAvailable, healthPermissionGranted, historicalKcalCache])

  /** 統計頁目前看的區間；`custom` 以外都由今天推算，跨過午夜重開頁面自然更新。 */
  const statsRange: NutritionStatsRange = statsRangeKind === 'custom'
    ? customRange
    : resolveStatsRange(statsRangeKind, toIsoDateString(Date.now()))

  // 統計頁的「消耗」逐日補齊：只查還沒查過、且已經到了的日子，查到的結果沿用
  // 跟翻日曆同一份快取（historicalKcalCache），翻回同一天不會再打一次
  // Health Connect。沒連接／沒授權就整段跳過，不主動幫使用者要權限。
  React.useEffect(() => {
    if (view !== 'stats') return
    if (!healthSettings.connected || !healthAvailable || !healthPermissionGranted) return
    const todayIso = toIsoDateString(Date.now())
    const missing = listRangeDates(statsRange).filter((iso) => iso <= todayIso && !(iso in historicalKcalCache))
    if (missing.length === 0) return
    let cancelled = false
    setStatsBurnLoading(true)
    void (async () => {
      const fetched: Record<string, number | null> = {}
      for (const iso of missing) {
        if (cancelled) return
        const value = await nutritionHealthAdapter.readDailyCaloriesBurned(iso).catch(() => undefined)
        fetched[iso] = value ?? null
        // 同上：只有真的查到值才存進搬家包會帶走的那份歷史記錄。
        if (value !== undefined && value !== null) void sessionRef.current?.saveBurnedKcal(iso, value)
      }
      if (cancelled) return
      setHistoricalKcalCache((prev) => ({ ...prev, ...fetched }))
      setStatsBurnLoading(false)
    })()
    return () => { cancelled = true; setStatsBurnLoading(false) }
  }, [view, statsRange.startIsoDate, statsRange.endIsoDate, healthSettings.connected, healthAvailable, healthPermissionGranted, historicalKcalCache])

  /**
   * 搬家匯入等情境會讓 `session.bodyProfile` 在開機以後才變動，
   * 「身體資料」頁的輸入框卻是各自獨立的 controlled state——不重新同步的話，
   * 頁面會停在舊值（新裝置甚至是空白預設值），使用者按下儲存還會用舊值
   * 把剛匯入的資料蓋掉。跟桌面版同一個坑（2026-08-24）。
   */
  function syncProfileFields(bodyProfile: BodyProfile | null): void {
    if (!bodyProfile) return
    setProfileHeight(String(bodyProfile.heightCm))
    setProfileWeight(String(bodyProfile.weightKg))
    setProfileWeightTime(timeInputValue(bodyProfile.healthMeasuredAt ?? bodyProfile.updatedAt))
    setProfileAge(String(bodyProfile.ageYears))
    setProfileSex(bodyProfile.sex)
    setProfileBodyFatPercent(bodyProfile.bodyFatPercent ? String(bodyProfile.bodyFatPercent) : '')
    setProfileActivity(bodyProfile.activityLevel)
    setProfileGoal(bodyProfile.goal)
    setProfileKcal(String(bodyProfile.dailyKcalLimit))
    setProfileProtein(String(bodyProfile.dailyProteinGoalG))
  }

  function applySnapshot(session: NutritionSession): void {
    setSnapshot({
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings,
      burnedKcalHistory: { ...session.burnedKcalHistory }
    })
  }

  async function runAction(action: (session: NutritionSession) => Promise<void>): Promise<void> {
    const session = sessionRef.current
    if (!session) return
    setSaving(true)
    try {
      await action(session)
      // 存檔成功就順手推小工具重算（計畫書 §3 觸發點 1）——用「所有存檔動作都推」
      // 換取簡單可靠，比逐一分辨「這次存檔到底動到 MealLog 沒」便宜也不容易漏。
      void refreshNutritionWidget()
      // 同一個理由：不逐一分辨這次存檔動到哪幾筆 MealLog，每次存檔後掃一遍
      // 「還沒寫進 Health 的記錄」全部補推。開關關閉或沒有待寫記錄時是快速的 no-op。
      void writeMealLogsToHealthIfNeeded(session)
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  /**
   * 把還沒寫進 Health 的飲食記錄（`healthWrittenAt` 是 `undefined` 的那些）逐筆補推熱量。
   * 這支同時扮演兩個角色：①開關 4 剛打開時，目前所有記錄都是「還沒寫過」，
   * 這次掃描就是一次性的歷史補寫 ②之後每次存檔都會再掃一次，新記錄隨手補推。
   * 不主動要權限——沒有寫入權限時安靜跳過，等使用者自己按「補寫」或重新開啟開關。
   *
   * `verbose` 只在使用者主動觸發（開關剛打開／手動補寫按鈕）時給 `true`：
   * `runAction` 每次存檔都會呼叫這支，若「沒權限」「沒待寫記錄」這類情況也跳訊息，
   * 會在使用者做其他不相干操作時無端跳字；但使用者主動按按鈕卻完全沒反應
   * 又會像壞掉一樣，所以兩種情境要分開處理。
   */
  async function writeMealLogsToHealthIfNeeded(session: NutritionSession, verbose = false): Promise<void> {
    const settings = session.settings.health
    if (!settings?.connected || !settings.writeCalories) return
    const pending = session.mealLogs.filter((mealLog) => mealLog.healthWrittenAt === undefined)
    if (pending.length === 0) { if (verbose) setHealthWriteMessage('沒有待補寫的記錄'); return }
    const available = await nutritionHealthAdapter.isAvailable()
    if (!available) { if (verbose) setHealthWriteMessage('這台裝置偵測不到 Health Connect'); return }
    const hasPerm = await nutritionHealthAdapter.hasWritePermission()
    if (!hasPerm) { if (verbose) setHealthWriteMessage('尚未取得寫入權限，請重新開啟上面的開關授權'); return }

    const foodItemMap = new Map(session.foodItems.map((foodItem) => [foodItem.id, foodItem]))
    const patched = new Map<string, MealLog>()
    let writtenCount = 0
    let failedCount = 0
    for (const mealLog of pending) {
      const kcal = resolveMealLogKcal(mealLog, foodItemMap.get(mealLog.foodItemId))
      // 沒有熱量可算（例如食物庫項目已被刪除）也標記完成，避免每次存檔都重掃同一筆。
      if (kcal === undefined || kcal <= 0) { patched.set(mealLog.id, { ...mealLog, healthWrittenAt: Date.now() }); continue }
      const ok = await nutritionHealthAdapter.writeCalories(kcal, mealLog.eatenAt)
      if (ok) { patched.set(mealLog.id, { ...mealLog, healthWrittenAt: Date.now() }); writtenCount++ }
      else failedCount++
    }
    if (patched.size > 0) {
      await session.replaceSnapshot({
        foodItems: [...session.foodItems],
        mealLogs: session.mealLogs.map((mealLog) => patched.get(mealLog.id) ?? mealLog),
        bodyProfile: session.bodyProfile,
        settings: session.settings,
        burnedKcalHistory: { ...session.burnedKcalHistory }
      })
    }
    if (writtenCount > 0) setHealthWriteMessage(`已補寫 ${writtenCount} 筆熱量到 Health${failedCount > 0 ? `（${failedCount} 筆失敗，下次會重試）` : ''}`)
    else if (verbose) setHealthWriteMessage(failedCount > 0 ? `補寫失敗 ${failedCount} 筆，詳情看 adb logcat` : '沒有需要補寫的記錄')
  }

  function toggleHealthWriteCalories(writeCalories: boolean): void {
    updateHealthSettings({ writeCalories })
    if (!writeCalories) { setHealthWriteMessage(null); return }
    setHealthWriteBusy(true)
    setHealthWriteMessage(null)
    void (async () => {
      try {
        const granted = await nutritionHealthAdapter.hasWritePermission()
          || await nutritionHealthAdapter.requestWritePermission()
        if (!granted) { setHealthWriteMessage('尚未授權寫入權限，先前記錄還沒補寫'); return }
        const session = sessionRef.current
        if (session) await writeMealLogsToHealthIfNeeded(session, true)
      } catch (error: unknown) {
        setHealthWriteMessage(`補寫失敗：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setHealthWriteBusy(false)
      }
    })()
  }

  /**
   * 開關 1（連接 Health）到開關 2/3 都靠這個存設定，用 `sessionRef.current` 現讀現存，
   * 不要用 `healthSettings` 這個 React state 當寫入來源——同一個 tick 裡連續呼叫時
   * state 還沒更新，會讀到舊值（`runAction`／`session.saveSettings` 是同步先落地
   * `this.snapshot.settings` 才 await 存檔，`sessionRef.current.settings` 隨時是最新的）。
   */
  function updateHealthSettings(patch: Partial<NutritionHealthSettings>): void {
    const current = sessionRef.current?.settings.health ?? DEFAULT_HEALTH_SETTINGS
    const next = { ...current, ...patch }
    setHealthSettings(next)
    void runAction(async (session) => {
      await session.saveSettings({ ...session.settings, health: next })
    })
  }

  function updateShowWeightBadge(next: boolean): void {
    setShowWeightBadge(next)
    void runAction(async (session) => {
      await session.saveSettings({ ...session.settings, showWeightBadge: next })
    })
  }

  /**
   * App 介面配色。先套用給即時回饋再寫檔——比照 DeST 的 ThemePicker 慣例。
   * 跟小工具的配色是**兩個獨立設定**，改這個不會動到小工具。
   */
  function updateColorTheme(next: ColorTheme): void {
    setColorTheme(next)
    applyNutritionTheme(next)
    void runAction(async (session) => {
      await session.saveSettings({ ...session.settings, colorTheme: next })
    })
  }

  /**
   * 小工具配色與底色透明度（`docs/mobile-android-widget-plan.md` §14.2）。
   * 用 DeST 的 12 組配色，但**跟 DeST 各存各的**——owner 明講兩邊可以設不同顏色。
   */
  function updateWidgetAppearance(patch: Partial<{ theme: string | null; bgOpacity: number }>): void {
    const current = sessionRef.current?.settings.widgetAppearance ?? DEFAULT_NUTRITION_WIDGET_APPEARANCE
    const next = { ...current, ...patch }
    setWidgetAppearance(next)
    void runAction(async (session) => {
      await session.saveSettings({ ...session.settings, widgetAppearance: next })
      // 設定存好之後要**同時**把色票落地並叫原生重繪，否則要等下一次存飲食紀錄才會變。
      await writeWidgetTheme(next)
      await refreshNutritionWidget()
    })
  }

  function updatePhotoEstimateEnabled(next: boolean): void {
    setPhotoEstimateEnabled(next)
    void runAction(async (session) => {
      // 展開既有的 photoEstimate 再覆蓋 enabled——直接寫 `{ enabled: next }`
      // 會把同一層的 scaleReference 一起洗掉（關掉再開啟就要重填）。
      await session.saveSettings({
        ...session.settings,
        photoEstimate: { ...session.settings.photoEstimate, enabled: next }
      })
    })
  }

  /** 比例尺校正說明：填一次、之後每次估算自動帶入，不必每張照片重打。 */
  function updateScaleReference(next: string): void {
    setScaleReference(next)
    void runAction(async (session) => {
      await session.saveSettings({
        ...session.settings,
        photoEstimate: { enabled: session.settings.photoEstimate?.enabled ?? false, scaleReference: next || undefined }
      })
    })
  }

  /** 同一顆存檔動作用在四個欄位上（§2.10.1：開關開啟時同一頁就能設 nutrition.llm）。 */
  function updateLlmSettings(patch: Partial<NutritionLlmSettings>): void {
    const next = { ...llmSettings, ...patch }
    setLlmSettings(next)
    setConnectionTestMessage(null)
    setVisionTestMessage(null)
    void runAction(async (session) => {
      await session.saveSettings({ ...session.settings, llm: next })
    })
  }

  /**
   * 套用從 DeST 掃 QR／分享／貼上拿到的設定字串。三種管道都收斂到這一支，
   * 不是這個格式就顯示「看不懂」，不會安靜地什麼都不做。
   *
   * ⚠️ 一定要現拿 `sessionRef.current ?? await sessionReadyRef.current`、
   * 用 `session.settings.llm` 當合併基準，**不能**走 `updateLlmSettings`／
   * 讀 `llmSettings` state——冷啟動時分享面板送進來的內容會在 session 開機
   * 完成前就被 `consumePendingShare()` 讀到，那時 `sessionRef.current`
   * 還是 null，`runAction` 會直接靜默 return（見它的定義），畫面卻已經因為
   * `setLlmSettings` 樂觀更新而顯示「已從 DeST 匯入」——金鑰其實沒有真的存進去，
   * session 稍後開機完成又會用磁碟上（沒有金鑰）的舊設定蓋回來（實測回報：
   * 2026-08-25 owner 用分享匯入，畫面顯示成功但 API Key 沒有真的過去）。
   */
  async function applyLlmImport(text: string): Promise<void> {
    const payload = decodeLlmExportPayload(text)
    if (!payload) {
      setImportMessage({ ok: false, text: '看不懂這段內容，確認是從 DeST 手機版「匯出設定給食記」拿到的 QR 或分享內容。' })
      return
    }
    const session = sessionRef.current ?? (await sessionReadyRef.current)
    if (!session) {
      setImportMessage({ ok: false, text: '匯入失敗：App 還沒準備好，稍後再試一次。' })
      return
    }
    // 帶走所有 DeST 已經填過金鑰的供應商，不是只有它目前使用中那一組——
    // 食記自己也能切供應商，只給一組的話其他家還是得手動填一次。
    const base = session.settings.llm
    const next: NutritionLlmSettings = {
      ...base,
      provider: payload.provider,
      model: payload.models?.[payload.provider] ?? base.model,
      endpoints: { ...base.endpoints, ...payload.endpoints },
      apiKeys: { ...base.apiKeys, ...payload.keys }
    }
    setLocalModels([])
    setConnectionTestMessage(null)
    setLlmSettings(next)
    await session.saveSettings({ ...session.settings, llm: next })
    void refreshNutritionWidget()
    setImportPasteText('')
    setShowImportPaste(false)
    const names = Object.keys(payload.keys).map((p) => PROVIDER_LABELS[p] ?? p)
    const summary = names.length > 0 ? names.join('、') : (PROVIDER_LABELS[payload.provider] ?? payload.provider)
    setImportMessage({ ok: true, text: `已從 DeST 匯入 ${summary} 的設定。` })
  }

  async function scanLlmImport(): Promise<void> {
    setImportMessage(null)
    const value = await scanQr().catch(() => null)
    if (value) await applyLlmImport(value)
  }

  /** 切換供應商時自動帶出該家最便宜的預設模型，不留舊供應商的型號卡在欄位裡。 */
  function changeLlmProvider(provider: string): void {
    setLocalModels([])
    updateLlmSettings({ provider, model: DEFAULT_MODEL_BY_PROVIDER[provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER] ?? '' })
  }

  /** local 供應商抓實際模型清單；其餘供應商純粹驗證 API Key／端點是否有效。 */
  async function testLlmConnection(): Promise<void> {
    setTestingConnection(true)
    setConnectionTestMessage(null)
    try {
      const result = await testNutritionLlmConnection(llmSettings, nutritionMobileHttp)
      if (result.ok) {
        setLocalModels(result.models ?? [])
        setConnectionTestMessage({ ok: true, text: `已連線${result.models ? `，找到 ${result.models.length} 個模型` : ''}` })
      } else {
        setConnectionTestMessage({ ok: false, text: result.error ?? '連線失敗' })
      }
    } finally {
      setTestingConnection(false)
    }
  }

  // --- 補充說明的語音輸入（§1 原則「不打字」：講比打快得多）---
  React.useEffect(() => {
    void isVoiceInputAvailable().then(setVoiceAvailable)
  }, [])

  /** 離開拍照流程時一定要收掉錄音，不然麥克風會一直開著。 */
  React.useEffect(() => {
    return () => { void voiceSessionRef.current?.stop() }
  }, [])

  async function toggleVoiceInput(): Promise<void> {
    setVoiceError(null)
    const session = voiceSessionRef.current
    if (session) {
      voiceSessionRef.current = null
      setVoiceListening(false)
      const finalText = await session.stop()
      if (finalText) setEstimateNote(joinNote(voiceBaseNoteRef.current, finalText))
      return
    }
    try {
      voiceBaseNoteRef.current = estimateNote
      setVoiceListening(true)
      voiceSessionRef.current = await startVoiceInput((partial) => {
        setEstimateNote(joinNote(voiceBaseNoteRef.current, partial))
      })
    } catch (error) {
      voiceSessionRef.current = null
      setVoiceListening(false)
      setVoiceError(error instanceof Error ? error.message : String(error))
    }
  }

  /** 「一鍵測試能不能傳圖」：設定半天結果模型不支援讀圖太浪費，先送一張測試圖片驗證。 */
  async function testLlmVision(): Promise<void> {
    setTestingVision(true)
    setVisionTestMessage(null)
    try {
      const result = await testPhotoEstimateVision(llmSettings, nutritionMobileHttp)
      setVisionTestMessage({
        ok: result.ok,
        text: result.ok ? `這個模型可以讀圖（回覆：${result.reply}）` : (result.error ?? '無法讀圖')
      })
    } finally {
      setTestingVision(false)
    }
  }

  /**
   * 小工具「重新整理」按鈕（原生層，見 `NutritionWidgetProvider.kt` 的
   * `refreshHealthCaloriesIfNeeded`）點下去會直接問 Health Connect、把結果寫進
   * `widget-health.json`，但那份資料 App 這邊本來完全不會去讀——使用者在桌面
   * 按過小工具的重新整理之後，回到 App 畫面看到的還是舊數字，得再按一次
   * App 內的「立即同步」，等於同一件事按兩次（owner 2026-08-25 回報）。
   *
   * 這支只是讀那個檔案、把 `caloriesBurnedSoFarToday`／`measuredAt` 併入
   * `healthSnapshot`——**不會**主動打 Health Connect，所以跟「自動同步」開關
   * 無關，兩者都可以呼叫。只在讀到的數字比目前手上的新時才套用，避免拿
   * 舊快取蓋掉剛剛才查到的更新結果。
   */
  async function loadWidgetHealthCache(): Promise<void> {
    const cached = await nutritionMobileStorage.readJson<WidgetHealthState>(WIDGET_HEALTH_STATE_KEY)
    if (!cached) return
    setHealthSnapshot((prev) => {
      if (prev && prev.measuredAt >= cached.measuredAt) return prev
      return { ...(prev ?? {}), caloriesBurnedSoFarToday: cached.burnedSoFarToday, measuredAt: cached.measuredAt }
    })
  }

  /**
   * 讀一次 Health Connect 快照，體重／體脂直接寫回 BodyProfile（owner 明講「直接
   * 同步」，不需要跟手動編輯衝突的規則——同步永遠是使用者觸發的，見
   * docs/nutrition-health-lite-kickoff.md §5.2）。`requestPermissionIfNeeded` 只在
   * 使用者剛打開開關 1 那一刻傳 true，其餘呼叫（自動同步／手動同步按鈕）只用
   * `hasPermission()` 確認，不會無緣無故再跳系統對話框。
   */
  async function runHealthSync(options: { requestPermissionIfNeeded?: boolean } = {}): Promise<void> {
    const session = sessionRef.current
    const health = session?.settings.health
    if (!session || !health?.connected) return
    setHealthSyncing(true)
    setHealthMessage(null)
    try {
      const available = await nutritionHealthAdapter.isAvailable()
      setHealthAvailable(available)
      if (!available) {
        setHealthMessage('這台裝置偵測不到 Health Connect')
        return
      }

      let granted = await nutritionHealthAdapter.hasPermission()
      if (!granted && options.requestPermissionIfNeeded) {
        granted = await nutritionHealthAdapter.requestPermission()
      }
      setHealthPermissionGranted(granted)
      if (!granted) {
        setHealthMessage('尚未授權讀取權限，飲食紀錄其餘功能不受影響')
        return
      }

      const snap = await nutritionHealthAdapter.readSnapshot()
      setHealthSnapshot(snap)
      await runAction(async (activeSession) => {
        const current = activeSession.bodyProfile
        if (!current) return // 還沒建立身體資料，沒地方寫體重/體脂——請使用者先在「身體資料」頁建立一次
        await activeSession.saveBodyProfile({
          ...current,
          weightKg: snap.weightKg ?? current.weightKg,
          bodyFatPercent: snap.bodyFatPercent ?? current.bodyFatPercent,
          healthSyncedAt: Date.now(),
          healthMeasuredAt: snap.measuredAt,
          updatedAt: Date.now()
        })
      })
      if (snap.weightKg !== undefined) {
        setProfileWeight(String(snap.weightKg))
        setProfileWeightTime(timeInputValue(snap.measuredAt))
      }
      if (snap.bodyFatPercent !== undefined) setProfileBodyFatPercent(String(snap.bodyFatPercent))
      setHealthMessage(`已同步（${new Date().toLocaleTimeString('zh-TW', { hour: 'numeric', minute: '2-digit' })}）`)
    } catch (error: unknown) {
      setHealthMessage(`同步失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setHealthSyncing(false)
    }
  }

  function toggleHealthConnected(connected: boolean): void {
    updateHealthSettings({ connected })
    if (connected) void runHealthSync({ requestPermissionIfNeeded: true })
  }

  function quickEntryEatenAt(): number {
    const base = nowOnDate(selectedDate)
    return combineDateAndTime(base, quickEntryTime) ?? base
  }

  function logMeal(foodItem: FoodItem): void {
    void runAction(async (session) => {
      const eatenAt = quickEntryEatenAt()
      await session.saveMealLog({
        id: `meal-${eatenAt}-${Math.round(Math.random() * 1e6)}`,
        foodItemId: foodItem.id,
        servings: 1,
        eatenAt,
        createdAt: eatenAt,
        updatedAt: eatenAt
      })
    }).then(() => { setQuickEntryOpen(false); setFoodQuery('') })
  }

  /**
   * 照片刪除延到儲存才真的動檔案：使用者按返回放棄編輯時，
   * 這個編輯階段新上傳、還沒存進食物庫的照片要清掉，避免孤兒檔案。
   * 被標記刪除但還沒儲存的照片維持不動（使用者可能放棄編輯，檔案要保留）。
   */
  const pendingDeletePhotoKeysRef = React.useRef<string[]>([])
  const sessionAddedPhotoKeysRef = React.useRef<string[]>([])

  /** 依照打開表單時記下的 foodFormOrigin，回到「進來的地方」而不是永遠回食物庫。 */
  function returnFromFoodForm(): void {
    if (foodFormOrigin === 'quickEntry') { setView('daily'); setQuickEntryOpen(true) }
    else if (foodFormOrigin === 'mealEditor') { setView('mealEditor') }
    else { setView('library') }
  }

  function leaveFoodForm(): void {
    const orphaned = sessionAddedPhotoKeysRef.current
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    setConfirmDeleteFood(false)
    setConfirmDuplicateFood(false)
    if (orphaned.length > 0) void Promise.all(orphaned.map((key) => nutritionMobileStorage.remove(key)))
    returnFromFoodForm()
  }

  function openFoodForm(foodItem: FoodItem | null, origin: FoodFormOrigin = 'library'): void {
    const id = foodItem?.id ?? `food-${Date.now()}`
    setEditingFoodId(id)
    setIsNewFood(!foodItem)
    setFoodFormOrigin(origin)
    setConfirmDeleteFood(false)
    setConfirmDuplicateFood(false)
    setNewTagInput('')
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    setFoodDraft(foodItem ? {
      name: foodItem.name,
      aliases: foodItem.aliases.join(', '),
      brand: foodItem.brand ?? '',
      flavor: foodItem.flavor ?? '',
      tags: foodItem.tags ?? [],
      kcal: String(foodItem.perServing.kcal),
      proteinG: String(foodItem.perServing.proteinG),
      carbsG: foodItem.perServing.carbsG !== undefined ? String(foodItem.perServing.carbsG) : '',
      fatG: foodItem.perServing.fatG !== undefined ? String(foodItem.perServing.fatG) : '',
      sugarG: foodItem.perServing.sugarG !== undefined ? String(foodItem.perServing.sugarG) : '',
      sodiumMg: foodItem.perServing.sodiumMg !== undefined ? String(foodItem.perServing.sodiumMg) : '',
      photoKeys: [...foodItem.photoKeys]
    } : blankFoodDraft())
    setPastedNutritionText('')
    setPastedNutritionMessage(null)
    setView('foodForm')
  }

  /**
   * 小工具拍照按鈕在 AI 拍照估算關閉時的落地：直接開「新增食物」表單並把剛拍的照片帶入，
   * 讓使用者接續用「複製提示詞」手動建檔（§2.10.4／§5）。
   */
  async function openFoodFormWithPhoto(file: File): Promise<void> {
    const id = `food-${Date.now()}`
    setEditingFoodId(id)
    setIsNewFood(true)
    setFoodFormOrigin('quickEntry')
    setConfirmDeleteFood(false)
    setConfirmDuplicateFood(false)
    setNewTagInput('')
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    setFoodDraft(blankFoodDraft())
    setPastedNutritionText('')
    setPastedNutritionMessage(null)
    setView('foodForm')
    const bytes = await compressImageFile(file)
    const key = foodPhotoKey(id, 0)
    await nutritionMobileStorage.writeBinary(key, bytes)
    sessionAddedPhotoKeysRef.current.push(key)
    setFoodDraft((prev) => ({ ...prev, photoKeys: [key] }))
  }

  /**
   * §2.10.3：從別的 AI／網頁複製一段文字回來自動填欄位。
   * **純本機正則、零網路請求**（`parsePastedNutrition`），解析不出來就當沒事、
   * 不跳錯誤——使用者照常手打。只填數字欄，不動名稱／品牌（那些猜錯的代價比較高）。
   */
  function applyPastedNutrition(text: string): void {
    setPastedNutritionText(text)
    const parsed = parsePastedNutrition(text)
    const filled: string[] = []
    setFoodDraft((prev) => {
      const next = { ...prev }
      if (parsed.kcal !== undefined) { next.kcal = String(parsed.kcal); filled.push('熱量') }
      if (parsed.proteinG !== undefined) { next.proteinG = String(parsed.proteinG); filled.push('蛋白質') }
      if (parsed.carbsG !== undefined) { next.carbsG = String(parsed.carbsG); filled.push('碳水') }
      if (parsed.fatG !== undefined) { next.fatG = String(parsed.fatG); filled.push('脂肪') }
      if (parsed.sugarG !== undefined) { next.sugarG = String(parsed.sugarG); filled.push('糖') }
      if (parsed.sodiumMg !== undefined) { next.sodiumMg = String(parsed.sodiumMg); filled.push('鈉') }
      return next
    })
    setPastedNutritionMessage(filled.length > 0 ? `已填入：${filled.join('、')}（可以再手動改）` : null)
  }

  /** §2.10.4：一鍵複製提示詞，貼到使用者自己常用的 AI 對話，不用手打也不用多付 API 費用。 */
  async function copyNutritionPrompt(): Promise<void> {
    const label = [foodDraft.name.trim(), [foodDraft.brand.trim(), foodDraft.flavor.trim()].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join('，')
    const prompt = buildNutritionPastePrompt(label)
    try {
      await navigator.clipboard.writeText(prompt)
      setPastedNutritionMessage('提示詞已複製，貼到你常用的 AI 對話（可以自己附上照片），算完把回覆貼回這裡')
    } catch {
      setPastedNutritionMessage('複製失敗，請手動選取文字複製')
    }
  }

  function toggleFoodTag(tag: string): void {
    setFoodDraft((prev) => ({
      ...prev,
      tags: prev.tags.includes(tag) ? prev.tags.filter((t) => t !== tag) : [...prev.tags, tag]
    }))
  }

  function addCustomFoodTag(): void {
    const tag = newTagInput.trim()
    if (!tag) return
    setFoodDraft((prev) => (prev.tags.includes(tag) ? prev : { ...prev, tags: [...prev.tags, tag] }))
    setNewTagInput('')
  }

  async function addFoodPhotos(files: FileList | File[]): Promise<void> {
    if (!editingFoodId) return
    const selected = Array.from(files).slice(0, MAX_FOOD_PHOTOS - foodDraft.photoKeys.length)
    const keys: string[] = []
    for (const file of selected) {
      const bytes = await compressImageFile(file)
      const key = foodPhotoKey(editingFoodId, nextFreeFoodPhotoIndex(editingFoodId, [...foodDraft.photoKeys, ...keys]))
      await nutritionMobileStorage.writeBinary(key, bytes)
      keys.push(key)
      sessionAddedPhotoKeysRef.current.push(key)
      // 剛移除的舊照片可能跟這張新照片撞到同一個 key（同一個 slot 先刪後補）——
      // 這裡剛把新內容寫進這個 key，絕對不能讓存檔後的「待刪除」清單再把它砍掉。
      pendingDeletePhotoKeysRef.current = pendingDeletePhotoKeysRef.current.filter((k) => k !== key)
    }
    if (keys.length > 0) setFoodDraft((prev) => ({ ...prev, photoKeys: [...prev.photoKeys, ...keys] }))
  }

  async function removeFoodPhoto(index: number): Promise<void> {
    const key = foodDraft.photoKeys[index]
    if (key) {
      if (sessionAddedPhotoKeysRef.current.includes(key)) {
        // 這張是這次編輯才剛上傳、還沒存檔的照片，可以直接刪，不留孤兒檔。
        sessionAddedPhotoKeysRef.current = sessionAddedPhotoKeysRef.current.filter((k) => k !== key)
        await nutritionMobileStorage.remove(key)
      } else {
        // 這張是已經存檔的舊照片，延到按下儲存才真的刪檔，放棄編輯時才不會少一張。
        pendingDeletePhotoKeysRef.current.push(key)
      }
    }
    setFoodDraft((prev) => ({ ...prev, photoKeys: prev.photoKeys.filter((_, i) => i !== index) }))
  }

  function saveFoodDraft(alsoLogToday: boolean): void {
    if (!editingFoodId) return
    const id = editingFoodId
    const name = foodDraft.name.trim()
    const kcal = Number(foodDraft.kcal)
    const proteinG = Number(foodDraft.proteinG)
    const carbsG = foodDraft.carbsG.trim() ? Number(foodDraft.carbsG) : undefined
    const fatG = foodDraft.fatG.trim() ? Number(foodDraft.fatG) : undefined
    const sugarG = foodDraft.sugarG.trim() ? Number(foodDraft.sugarG) : undefined
    const sodiumMg = foodDraft.sodiumMg.trim() ? Number(foodDraft.sodiumMg) : undefined
    if (!name || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    if (carbsG !== undefined && !Number.isFinite(carbsG)) return
    if (fatG !== undefined && !Number.isFinite(fatG)) return
    if (sugarG !== undefined && !Number.isFinite(sugarG)) return
    if (sodiumMg !== undefined && !Number.isFinite(sodiumMg)) return
    const finalPhotoKeys = foodDraft.photoKeys.slice(0, MAX_FOOD_PHOTOS)
    void runAction(async (session) => {
      const now = Date.now()
      const existing = session.foodItems.find((item) => item.id === id)
      await session.saveFoodItem({
        id,
        name,
        aliases: foodDraft.aliases.split(',').map((v) => v.trim()).filter(Boolean),
        brand: foodDraft.brand.trim() || undefined,
        flavor: foodDraft.flavor.trim() || undefined,
        tags: foodDraft.tags,
        perServing: { kcal, proteinG, carbsG, fatG, sugarG, sodiumMg },
        photoKeys: finalPhotoKeys as FoodItem['photoKeys'],
        source: existing?.source ?? 'user',
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      })
      if (alsoLogToday) {
        const eatenAt = quickEntryEatenAt()
        await session.saveMealLog({
          id: `meal-${eatenAt}-${Math.round(Math.random() * 1e6)}`,
          foodItemId: id,
          servings: 1,
          eatenAt,
          createdAt: eatenAt,
          updatedAt: eatenAt
        })
      }
    }).then(() => {
      // 保險：即使前面漏接，也絕對不能刪到「最後實際存檔用到」的 key
      // （例如同一張照片先移除又在同一次編輯補回同一個 slot）。
      const toDelete = pendingDeletePhotoKeysRef.current.filter((key) => !finalPhotoKeys.includes(key))
      pendingDeletePhotoKeysRef.current = []
      sessionAddedPhotoKeysRef.current = []
      if (toDelete.length > 0) void Promise.all(toDelete.map((key) => nutritionMobileStorage.remove(key)))
      if (alsoLogToday) { setQuickEntryOpen(false); setFoodQuery(''); setView('daily') } else { returnFromFoodForm() }
    })
  }

  function deleteFoodConfirmed(): void {
    if (!editingFoodId) return
    const id = editingFoodId
    const orphaned = sessionAddedPhotoKeysRef.current
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    void runAction(async (session) => {
      await session.removeFoodItem(id)
      if (orphaned.length > 0) await Promise.all(orphaned.map((key) => nutritionMobileStorage.remove(key)))
    }).then(() => { setConfirmDeleteFood(false); setView('library') })
  }

  function duplicateFoodConfirmed(): void {
    if (!editingFoodId) return
    const newId = `food-${Date.now()}`
    const name = foodDraft.name.trim()
    const kcal = Number(foodDraft.kcal)
    const proteinG = Number(foodDraft.proteinG)
    const carbsG = foodDraft.carbsG.trim() ? Number(foodDraft.carbsG) : undefined
    const fatG = foodDraft.fatG.trim() ? Number(foodDraft.fatG) : undefined
    const sugarG = foodDraft.sugarG.trim() ? Number(foodDraft.sugarG) : undefined
    const sodiumMg = foodDraft.sodiumMg.trim() ? Number(foodDraft.sodiumMg) : undefined
    if (!name || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    if (carbsG !== undefined && !Number.isFinite(carbsG)) return
    if (fatG !== undefined && !Number.isFinite(fatG)) return
    if (sugarG !== undefined && !Number.isFinite(sugarG)) return
    if (sodiumMg !== undefined && !Number.isFinite(sodiumMg)) return

    void runAction(async (session) => {
      const now = Date.now()
      // 照片一定要複製成新食物自己的檔案，不能沿用原食物的 key——
      // 否則原食物的照片被刪除／改動時，這個「另存」出來的食物會跟著壞掉。
      const sourceKeys = foodDraft.photoKeys.slice(0, MAX_FOOD_PHOTOS)
      const newPhotoKeys: string[] = []
      for (let i = 0; i < sourceKeys.length; i++) {
        const bytes = await nutritionMobileStorage.readBinary(sourceKeys[i])
        if (bytes) {
          const newKey = foodPhotoKey(newId, i)
          await nutritionMobileStorage.writeBinary(newKey, bytes)
          newPhotoKeys.push(newKey)
        }
      }
      await session.saveFoodItem({
        id: newId,
        name,
        aliases: foodDraft.aliases.split(',').map((v) => v.trim()).filter(Boolean),
        brand: foodDraft.brand.trim() || undefined,
        flavor: foodDraft.flavor.trim() || undefined,
        tags: foodDraft.tags,
        perServing: { kcal, proteinG, carbsG, fatG, sugarG, sodiumMg },
        photoKeys: newPhotoKeys as FoodItem['photoKeys'],
        source: 'user',
        createdAt: now,
        updatedAt: now
      })
    }).then(() => {
      setConfirmDuplicateFood(false)
      const newFood = snapshot?.foodItems.find((item) => item.id === newId)
      if (newFood) {
        // 「另存為新食物」後回到食物庫清單，讓使用者看到新建立的食物
        setView('library')
      }
    })
  }

  function openMealEditor(mealLog: MealLog, foodItem: FoodItem | null, name: string): void {
    setEditingMealId(mealLog.id)
    setMealName(name)
    setMealKcal(String(mealLog.override?.kcal ?? foodItem?.perServing.kcal ?? 0))
    setMealProtein(String(mealLog.override?.proteinG ?? foodItem?.perServing.proteinG ?? 0))
    setMealServings(String(mealLog.servings))
    setMealTime(timeInputValue(mealLog.eatenAt))
    setConfirmDeleteMeal(false)
    // 上一次編輯若中途放棄替換食物，這幾個 state 不會自己清掉——不重設的話，
    // 下次打開任何一筆飲食紀錄都會被殘留的 mealReplaceTarget 直接跳出確認視窗。
    setMealReplaceOpen(false)
    setMealReplaceTarget(null)
    setMealReplaceQuery('')
    setMealReplaceTag('all')
    setView('mealEditor')
  }

  function saveMealEdit(scope: 'meal' | 'food'): void {
    if (!editingMealId) return
    const servings = Number(mealServings)
    const kcal = Number(mealKcal)
    const proteinG = Number(mealProtein)
    const name = mealName.trim()
    if (!name || !Number.isFinite(servings) || servings <= 0 || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    const editingLog = editingMealId ? snapshot?.mealLogs.find((log) => log.id === editingMealId) : undefined
    if (!editingLog) return
    const eatenAt = combineDateAndTime(editingLog.eatenAt, mealTime)
    if (eatenAt === null) return
    void runAction(async (session) => {
      const current = session.mealLogs.find((log) => log.id === editingMealId)
      if (!current) return
      if (scope === 'food') {
        const foodItem = session.foodItems.find((item) => item.id === current.foodItemId)
        if (foodItem) {
          await session.saveFoodItem({ ...foodItem, name, perServing: { ...foodItem.perServing, kcal, proteinG }, updatedAt: Date.now() })
        }
        await session.saveMealLog({ ...current, servings, eatenAt, override: undefined, updatedAt: Date.now() })
      } else {
        await session.saveMealLog({ ...current, servings, eatenAt, override: { name, kcal, proteinG }, updatedAt: Date.now() })
      }
    }).then(() => setView('daily'))
  }

  /**
   * 「用食物庫的其他食物替換」：只換這筆紀錄連到哪個食物庫項目，份量與時間不動、
   * 清掉既有的 override（改吃新食物庫項目的值）。選好立即存檔（owner 2026-08-22 確認），
   * 不用等按「儲存」——這是整理重複食物庫項目的操作，跟其他欄位編輯的語意不一樣。
   */
  function replaceMealFood(newFoodItem: FoodItem): void {
    if (!editingMealId) return
    void runAction(async (session) => {
      const current = session.mealLogs.find((log) => log.id === editingMealId)
      if (!current) return
      await session.saveMealLog({ ...current, foodItemId: newFoodItem.id, override: undefined, updatedAt: Date.now() })
    }).then(() => {
      setMealReplaceOpen(false)
      setMealReplaceTarget(null)
      setMealName(newFoodItem.name)
      setMealKcal(String(newFoodItem.perServing.kcal))
      setMealProtein(String(newFoodItem.perServing.proteinG))
    })
  }

  function deleteMeal(): void {
    if (!editingMealId) return
    const id = editingMealId
    void runAction(async (session) => {
      await session.removeMealLog(id)
    }).then(() => { setConfirmDeleteMeal(false); setView('daily') })
  }

  async function pickMealPhoto(file: File): Promise<void> {
    if (!editingMealId) return
    const id = editingMealId
    const bytes = await compressImageFile(file)
    const key = mealPhotoKey(id)
    await nutritionMobileStorage.writeBinary(key, bytes)
    await runAction(async (session) => {
      const current = session.mealLogs.find((log) => log.id === id)
      if (current) await session.saveMealLog({ ...current, photoKey: key, updatedAt: Date.now() })
      const foodItem = current ? session.foodItems.find((item) => item.id === current.foodItemId) : undefined
      if (foodItem && foodItem.photoKeys.length === 0) {
        const foodKey = foodPhotoKey(foodItem.id, 0)
        await nutritionMobileStorage.writeBinary(foodKey, bytes)
        await session.saveFoodItem({ ...foodItem, photoKeys: [foodKey], updatedAt: Date.now() })
      }
    })
  }

  async function clearMealPhoto(): Promise<void> {
    if (!editingMealId) return
    const id = editingMealId
    const current = snapshot?.mealLogs.find((log) => log.id === id)
    if (current?.photoKey) await nutritionMobileStorage.remove(current.photoKey)
    await runAction(async (session) => {
      const target = session.mealLogs.find((log) => log.id === id)
      if (target) await session.saveMealLog({ ...target, photoKey: undefined, updatedAt: Date.now() })
    })
  }

  // --- 拍照估熱量：三步正常路徑（開相機 1、快門 1、估算 1、存入 1）---
  // 規格 docs/nutrition-photo-estimate-plan.md §2.1。P2 範圍：單張照片、單份食物；
  // 多份食物／送出前補充頁／相簿補記留給後續分期（§7 P2.6／P3.5）。

  function resetEstimateState(): void {
    setEstimatePhase('idle')
    setEstimateResult(null)
    setEstimateMatchedFood(null)
    setEstimatePhotoBytes([])
    setEstimateError(null)
    setEstimateSelectedFiles([])
    setEstimateNote('')
    setEstimateFollowUpNote('')
    setEstimateTargetFoodId(null)
    for (const url of estimatePreviewUrlsRef.current) URL.revokeObjectURL(url)
    estimatePreviewUrlsRef.current = []
    setEstimatePreviewUrls([])
  }

  function openPhotoEstimate(): void {
    resetEstimateState()
    setView('photoEstimate')
  }

  /**
   * 食物庫編輯畫面的「用 AI 重新計算」入口：帶著這筆食物既有的照片直接進補充說明頁，
   * 沒有照片時退回 `idle` 讓使用者自己拍/選。結果頁與錯誤頁靠 `estimateTargetFoodId`
   * 判斷這是重算模式，不是新增食物／飲食紀錄。
   */
  async function openPhotoEstimateForFood(foodId: string, photoKeys: string[]): Promise<void> {
    resetEstimateState()
    setEstimateTargetFoodId(foodId)
    if (photoKeys.length > 0) {
      const files: File[] = []
      for (const key of photoKeys) {
        const bytes = await nutritionMobileStorage.readBinary(key)
        if (bytes) files.push(new File([new Uint8Array(bytes)], key, { type: 'image/webp' }))
      }
      if (files.length > 0) addEstimatePhotos(files)
    }
    setView('photoEstimate')
  }

  function discardEstimate(): void {
    const targetId = estimateTargetFoodId
    const targetFood = targetId ? snapshot?.foodItems.find((item) => item.id === targetId) : undefined
    resetEstimateState()
    if (targetFood) { openFoodForm(targetFood, 'library'); return }
    setView('daily')
  }

  /**
   * 選好照片後先進補充說明頁，不直接送出（§2.7：文字比讓模型從圖上猜準得多）。
   * 可以重複呼叫加照片（上限 MAX_FOOD_PHOTOS），一次多選也吃得下。
   */
  function addEstimatePhotos(files: FileList | File[]): void {
    const incoming = Array.from(files)
    if (incoming.length === 0) return
    // ⚠️ 建立 blob URL 這種副作用**不能**放進 setState 的 updater 裡：
    // updater 必須是純函式，StrictMode 會刻意雙呼叫來抓這種寫法，結果就是
    // 每張照片被建兩個 URL（畫面出現 6 張縮圖、而且洩漏 blob）。
    const accepted = incoming.slice(0, MAX_FOOD_PHOTOS - estimateSelectedFiles.length)
    if (accepted.length === 0) return
    const urls = accepted.map((file) => URL.createObjectURL(file))
    setEstimateSelectedFiles((prev) => [...prev, ...accepted])
    setEstimatePreviewUrls((prev) => [...prev, ...urls])
    setEstimatePhase('noteInput')
  }

  function removeEstimatePhoto(index: number): void {
    const target = estimatePreviewUrls[index]
    if (target) URL.revokeObjectURL(target)
    setEstimateSelectedFiles((prev) => prev.filter((_, i) => i !== index))
    setEstimatePreviewUrls((prev) => prev.filter((_, i) => i !== index))
  }

  /** 只送名稱，不送營養數字／體重／上限等個資（§3.1）。 */
  function recentFoodNames(): string[] {
    if (!snapshot) return []
    return [...snapshot.foodItems]
      .sort((a, b) => (b.lastEatenAt ?? 0) - (a.lastEatenAt ?? 0) || (b.useCount ?? 0) - (a.useCount ?? 0))
      .slice(0, RECENT_FOOD_NAMES_LIMIT)
      .map((item) => item.name)
  }

  /**
   * 送出估算請求的共用邏輯，`noteText` 由呼叫端決定（首次估算 vs 結果頁補充說明再估算，
   * 見 `submitEstimate()`／`submitFollowUpEstimate()`）。照片一律沿用已選的那批，
   * 補充說明不對就是解釋不夠，不是換照片。
   */
  async function runEstimateRequest(noteText: string): Promise<void> {
    const files = estimateSelectedFiles
    if (files.length === 0) return
    // §2.9.4：本機先擋掉必然失敗的組合，照片與說明都保留不丟。
    const issues = checkRequestCompatibility(
      capabilitiesFromPriceTable(llmSettings.model ?? '', null, llmSettings.provider === 'local'),
      {
        photoCount: files.length,
        hasApiKey: Boolean(llmSettings.apiKeys[llmSettings.provider]?.trim()),
        isLocalModel: llmSettings.provider === 'local'
      }
    )
    if (!llmSettings.model) {
      setEstimateError('還沒選模型，請先到設定裡選一個支援讀圖的模型')
      setEstimatePhase('error')
      return
    }
    const blocking = issues.find((issue) => issue.kind === 'missing-api-key')
    if (blocking) {
      setEstimateError('這個供應商還沒填 API Key，請先到設定填好再估算（照片與說明都還在）')
      setEstimatePhase('error')
      return
    }
    setEstimatePhase('loading')
    setEstimateError(null)
    try {
      // 補充說明再估算沿用第一次的照片，不用重壓縮。
      const bytesList = estimatePhotoBytes.length === files.length
        ? estimatePhotoBytes
        : await Promise.all(files.map((file) => compressImageFile(file)))
      setEstimatePhotoBytes(bytesList)
      setEstimateNote(noteText)
      const results = await requestPhotoEstimate({
        llmSettings,
        photos: bytesList.map((bytes) => ({ slot: 1, base64: bytesToBase64(bytes), mimeType: 'image/webp' })),
        note: noteText || undefined,
        recentNames: recentFoodNames(),
        scaleReference: scaleReference.trim() || undefined,
        http: nutritionMobileHttp
      })
      const result = results[0]
      if (!result) throw new PhotoEstimateRequestError('模型沒有回傳可用的結果')
      // 重算既有食物庫項目時不用名稱比對既有食物——目標食物已經確定，比對只會誤導使用者。
      const candidates = !estimateTargetFoodId && result.name ? matchFoodItem(result.name, result.brand, snapshot?.foodItems ?? []) : []
      setEstimateMatchedFood(candidates.length === 1 ? candidates[0] : null)
      setEstimateResult(result)
      setEstimatePhase('result')
    } catch (error) {
      setEstimateError(error instanceof Error ? error.message : String(error))
      setEstimatePhase('error')
    }
  }

  /** 「估算」：補充說明可留白直接送，留白就純依圖片判斷。多張照片一律當成同一份食物（slot 1）。 */
  async function submitEstimate(): Promise<void> {
    await runEstimateRequest(estimateNote.trim())
  }

  /**
   * 結果頁「這樣不對，再解釋一次」：把補充文字接在既有說明後面重送一次估算，
   * 不限次數（AI 有時候會誤解照片或文字，講清楚為止）。重算完一樣回到結果頁，
   * 可以繼續補充、存入、或改用手動編輯。
   */
  async function submitFollowUpEstimate(): Promise<void> {
    const clarification = estimateFollowUpNote.trim()
    if (!clarification) return
    const combinedNote = estimateNote.trim() ? `${estimateNote.trim()}\n補充：${clarification}` : clarification
    setEstimateFollowUpNote('')
    await runEstimateRequest(combinedNote)
  }

  /** 「存入」：一顆按鈕完成兩筆寫入，不讓使用者選要不要建食物庫（§2.2）。 */
  function saveEstimateResult(): void {
    if (!estimateResult) return
    const result = estimateResult
    const matchedFood = estimateMatchedFood
    const photoBytes = estimatePhotoBytes
    void runAction(async (session) => {
      const now = Date.now()
      const newFoodItemId = `food-${now}`
      const newMealLogId = `meal-${now}-${Math.round(Math.random() * 1e6)}`
      let photoKeys: FoodItem['photoKeys'] = []
      let mealPhotoKeyValue: string | undefined
      if (photoBytes.length > 0) {
        if (matchedFood) {
          // 命中既有食物時不動食物庫的照片，只把第一張留成這一餐的紀錄照。
          mealPhotoKeyValue = mealPhotoKey(newMealLogId)
          await nutritionMobileStorage.writeBinary(mealPhotoKeyValue, photoBytes[0])
        } else {
          const keys: string[] = []
          for (let i = 0; i < photoBytes.length && i < MAX_FOOD_PHOTOS; i++) {
            const key = foodPhotoKey(newFoodItemId, i)
            await nutritionMobileStorage.writeBinary(key, photoBytes[i])
            keys.push(key)
          }
          photoKeys = keys as FoodItem['photoKeys']
        }
      }
      const { foodItem, mealLog } = applyEstimateToEntries(result, {
        matchedFoodItem: matchedFood,
        newFoodItemId,
        newMealLogId,
        now,
        eatenAt: now,
        eatenAtSource: 'now',
        servings: result.servings ?? 1,
        photoKeys,
        mealPhotoKey: mealPhotoKeyValue
      })
      if (foodItem) await session.saveFoodItem(foodItem)
      await session.saveMealLog(mealLog)
    }).then(() => {
      resetEstimateState()
      setView('daily')
    })
  }

  /** 「不對，我改」：帶著估算結果與照片跳進既有的食物表單，不重造一套編輯 UI（§4.1）。 */
  async function openFoodFormFromEstimate(): Promise<void> {
    if (!estimateResult) return
    const result = estimateResult
    const id = `food-${Date.now()}`
    setEditingFoodId(id)
    setIsNewFood(true)
    setFoodFormOrigin('quickEntry')
    setConfirmDeleteFood(false)
    setConfirmDuplicateFood(false)
    setNewTagInput('')
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    const photoKeys: string[] = []
    for (let i = 0; i < estimatePhotoBytes.length && i < MAX_FOOD_PHOTOS; i++) {
      const key = foodPhotoKey(id, i)
      await nutritionMobileStorage.writeBinary(key, estimatePhotoBytes[i])
      sessionAddedPhotoKeysRef.current.push(key)
      photoKeys.push(key)
    }
    setFoodDraft({
      name: result.name ?? '',
      aliases: '',
      brand: result.brand ?? '',
      flavor: result.flavor ?? '',
      tags: [],
      kcal: result.perServing ? String(result.perServing.kcal) : '',
      proteinG: result.perServing ? String(result.perServing.proteinG) : '',
      carbsG: result.perServing?.carbsG !== undefined ? String(result.perServing.carbsG) : '',
      fatG: result.perServing?.fatG !== undefined ? String(result.perServing.fatG) : '',
      sugarG: result.perServing?.sugarG !== undefined ? String(result.perServing.sugarG) : '',
      sodiumMg: result.perServing?.sodiumMg !== undefined ? String(result.perServing.sodiumMg) : '',
      photoKeys
    })
    resetEstimateState()
    setPastedNutritionText('')
    setPastedNutritionMessage(null)
    setView('foodForm')
  }

  /**
   * 「用 AI 重新計算」的存檔：只更新 `estimateTargetFoodId` 這筆食物庫資料，
   * 不新增飲食紀錄——這是重算食物庫，不是記一筆新的飲食。照片沿用原本的
   * `photoKeys`，不重寫檔案。
   */
  function applyEstimateToFoodItem(): void {
    if (!estimateResult || !estimateTargetFoodId || !snapshot) return
    const result = estimateResult
    const existing = snapshot.foodItems.find((item) => item.id === estimateTargetFoodId)
    if (!existing) return
    const updated: FoodItem = {
      ...existing,
      name: result.name?.trim() || existing.name,
      brand: result.brand ?? existing.brand,
      flavor: result.flavor ?? existing.flavor,
      perServing: result.perServing ?? existing.perServing,
      source: 'llm-photo-edited',
      updatedAt: Date.now()
    }
    void runAction(async (session) => { await session.saveFoodItem(updated) }).then(() => {
      resetEstimateState()
      openFoodForm(updated, 'library')
    })
  }

  function saveProfile(applyTdee: boolean): void {
    const heightCm = Number(profileHeight)
    const weightKg = Number(profileWeight)
    const ageYears = Number(profileAge)
    const bodyFatPercent = profileBodyFatPercent ? Number(profileBodyFatPercent) : undefined
    const tdeeEstimate = calculateTdeeKcal({ heightCm, weightKg, ageYears, sex: profileSex, bodyFatPercent, activityLevel: profileActivity })
    const dailyKcalLimit = applyTdee ? calculateGoalAdjustedKcal(tdeeEstimate, profileGoal) : Number(profileKcal)
    const dailyProteinGoalG = applyTdee
      ? calculateProteinGoalG({ weightKg, ageYears, activityLevel: profileActivity })
      : Number(profileProtein)
    if (![heightCm, weightKg, ageYears, dailyKcalLimit, dailyProteinGoalG].every(Number.isFinite)) return
    void runAction(async (session) => {
      const current = session.bodyProfile
      await session.saveBodyProfile({
        id: current?.id ?? 'body-profile',
        heightCm,
        weightKg,
        ageYears,
        sex: profileSex,
        bodyFatPercent,
        activityLevel: profileActivity,
        goal: profileGoal,
        tdeeEstimate,
        dailyKcalLimit,
        dailyProteinGoalG,
        // 保留 Health 同步留下的時間戳，手動改身高/體重不該把「上次同步」抹掉。
        healthSyncedAt: current?.healthSyncedAt,
        // 量測時間可手改（例如補記早上量的體重）；套用今天的日期＋使用者輸入的時分。
        healthMeasuredAt: combineDateAndTime(Date.now(), profileWeightTime) ?? current?.healthMeasuredAt,
        createdAt: current?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      })
    }).then(() => {
      setProfileKcal(String(dailyKcalLimit))
      setProfileProtein(String(dailyProteinGoalG))
    })
  }

  async function exportPack(): Promise<void> {
    if (!snapshot) return
    setTransferBusy(true)
    setTransferMessage(null)
    try {
      const photoKeys = collectReferencedPhotoKeys(snapshot)
      const photoBytes = new Map<string, Uint8Array>()
      for (const key of photoKeys) {
        const bytes = await nutritionMobileStorage.readBinary(key)
        if (bytes) photoBytes.set(key, bytes)
      }
      const pack = buildMigrationPack(snapshot, photoBytes)
      const bytes = new TextEncoder().encode(JSON.stringify(pack))
      const filename = `飲食記錄搬家包-${toIsoDateString(Date.now())}${NUTRITION_PACK_EXTENSION}`
      await downloadBytes(bytes, filename, 'application/json')
      setTransferMessage('已匯出，請透過分享面板存到你要的地方（例如傳到電腦）。')
    } catch (error) {
      setTransferMessage(`匯出失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTransferBusy(false)
    }
  }

  async function importPack(mode: MigrationMergeMode): Promise<void> {
    const file = await pickFile()
    if (!file) return
    setTransferBusy(true)
    setTransferMessage(null)
    try {
      const pack = JSON.parse(await file.text()) as NutritionMigrationPack
      if (!pack || !Array.isArray(pack.foodItems)) throw new Error('不是有效的搬家包')
      await runAction(async (session) => {
        const { snapshot: merged, photosToWrite } = applyMigrationPack(
          {
            foodItems: [...session.foodItems],
            mealLogs: [...session.mealLogs],
            bodyProfile: session.bodyProfile,
            settings: session.settings,
            burnedKcalHistory: { ...session.burnedKcalHistory }
          },
          pack,
          mode
        )
        for (const { key, bytes } of photosToWrite) await nutritionMobileStorage.writeBinary(key, bytes)
        await session.replaceSnapshot(merged)
        syncProfileFields(session.bodyProfile)
        setLlmSettings(session.settings.llm)
      })
      setTransferMessage(mode === 'fill-only' ? '已補上本機沒有的資料。' : '已用匯入的資料覆蓋較舊的本機紀錄。')
    } catch (error) {
      setTransferMessage(`匯入失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTransferBusy(false)
    }
  }

  if (loadError) return <main className="shell"><p>飲食資料載入失敗</p><p className="hint">{loadError}</p></main>
  if (!snapshot) return <main className="shell"><p>載入飲食資料中...</p></main>

  const daily = buildDailyView(snapshot.mealLogs, snapshot.foodItems, selectedDate)
  // 引用次數一律由餐次現算，不吃 FoodItem.useCount 快取——這個數字的用途就是
  // 「這筆重複資料能不能刪」，看到過期的快取比看不到還糟。
  const foodUsage = buildFoodUsageIndex(snapshot.mealLogs)
  const bodyProfile = snapshot.bodyProfile
  // 開關 3 開啟時：正在看今天套 suggestTodayKcalLimit()（已消耗＋剩餘時間外推）；
  // 翻到過去的日期則直接用那天的 Health Connect 總消耗熱量本人（那天已經過完，
  // 沒有「剩餘時間」可外推，degenerate 成單純的當日總量）。兩者都查不到資料時
  // 退回固定的 bodyProfile.dailyKcalLimit。
  const isViewingToday = selectedDate === toIsoDateString(Date.now())
  const todayDynamicKcalLimit = bodyProfile && healthSettings.useWatchCalorieLimit && healthSnapshot && isViewingToday
    ? suggestTodayKcalLimit(bodyProfile, healthSnapshot, Date.now())
    : null
  const historicalCaloriesBurned = !isViewingToday && healthSettings.useWatchCalorieLimit
    ? historicalKcalCache[selectedDate]
    : undefined
  const historicalDynamicKcalLimit = historicalCaloriesBurned !== undefined && historicalCaloriesBurned !== null
    ? Math.round(historicalCaloriesBurned)
    : null
  const dynamicKcalLimit = todayDynamicKcalLimit ?? historicalDynamicKcalLimit
  const effectiveKcalLimit = dynamicKcalLimit ?? bodyProfile?.dailyKcalLimit
  const date = new Date(`${selectedDate}T12:00:00`)
  const dateLabel = date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const shiftDate = (days: number) => {
    date.setDate(date.getDate() + days)
    setSelectedDate(toIsoDateString(date.getTime()))
  }
  const tags = collectTags(snapshot.foodItems)
  const untaggedFoodCount = snapshot.foodItems.filter((item) => (item.tags ?? []).length === 0).length
  const quickEntryTagFiltered = quickEntryTag === 'all'
    ? snapshot.foodItems
    : quickEntryTag === UNTAGGED_TAG_ID
      ? snapshot.foodItems.filter((item) => (item.tags ?? []).length === 0)
      : snapshot.foodItems.filter((item) => (item.tags ?? []).includes(quickEntryTag))
  const quickFoods = foodQuery.trim() ? matchFoodKeyword(foodQuery, quickEntryTagFiltered).map((match) => match.foodItem) : quickEntryTagFiltered
  const libraryFoods = snapshot.foodItems.filter((foodItem) => {
    if (libraryTag === UNTAGGED_TAG_ID) {
      if ((foodItem.tags ?? []).length > 0) return false
    } else if (libraryTag !== 'all' && !(foodItem.tags ?? []).includes(libraryTag)) {
      return false
    }
    if (!libraryQuery.trim()) return true
    return matchFoodKeyword(libraryQuery, [foodItem]).length > 0
  })

  if (view === 'library') {
    return (
      <main className="shell">
        <Header title="食物庫" onBack={() => setView('daily')} />
        <section className="library-toolbar">
          <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="搜尋名稱或別名" />
          <select value={libraryTag} onChange={(event) => setLibraryTag(event.target.value)}>
            <option value="all">全部分類</option>
            {untaggedFoodCount > 0 && <option value={UNTAGGED_TAG_ID}>未分類（{untaggedFoodCount}）</option>}
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </section>
        <button type="button" className="primary full-width" onClick={() => openFoodForm(null)}>
          <MonoIcon name="plus" className="icon-sm" /> 新增食物
        </button>
        <section className="food-library">
          {libraryFoods.length === 0 ? <p className="empty">還沒有符合的食物</p> : libraryFoods.map((foodItem) => (
            <button type="button" className="food-library-row" key={foodItem.id} onClick={() => openFoodForm(foodItem)}>
              <LibraryPhotoThumb photoKey={foodItem.photoKeys[0]} onPreview={() => setPhotoPreview({ keys: [...foodItem.photoKeys], index: 0 })} />
              <div>
                <strong>{foodItem.name}</strong>
                <small>{[foodItem.brand, foodItem.flavor].filter(Boolean).join(' · ') || '尚未填寫辨識資訊'}</small>
                <small className="food-usage">{usageText(foodUsageOf(foodUsage, foodItem.id))}</small>
                {(foodItem.tags ?? []).length > 0 && (
                  <div className="tag-row">{foodItem.tags!.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</div>
                )}
              </div>
              <span className="food-library-kcal">{foodItem.perServing.kcal} kcal<br /><small>{foodItem.perServing.proteinG} g 蛋白</small></span>
              <MonoIcon name="edit" className="icon-sm" />
            </button>
          ))}
        </section>
        {photoPreview && <PhotoPreview photoKeys={photoPreview.keys} initialIndex={photoPreview.index} onClose={() => setPhotoPreview(null)} />}
      </main>
    )
  }

  if (view === 'foodForm') {
    const allTagOptions = Array.from(new Set([...tags, ...foodDraft.tags])).sort()
    return (
      <main className="shell">
        <Header title={isNewFood ? '新增食物' : '編輯食物'} onBack={leaveFoodForm} />
        {!isNewFood && editingFoodId && (
          <p className="food-usage-banner">{usageText(foodUsageOf(foodUsage, editingFoodId))}</p>
        )}
        <section className="food-form">
          <label>食物名稱<input value={foodDraft.name} onChange={(event) => setFoodDraft({ ...foodDraft, name: event.target.value })} /></label>
          <label>別名（用逗號分隔）<input value={foodDraft.aliases} onChange={(event) => setFoodDraft({ ...foodDraft, aliases: event.target.value })} /></label>

          <div className="tag-picker">
            <label>分類標籤</label>
            {allTagOptions.length === 0
              ? <small className="hint">還沒有標籤，直接在下面新增第一個</small>
              : (
                <div className="tag-options">
                  {allTagOptions.map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      className={`tag-choice${foodDraft.tags.includes(tag) ? ' selected' : ''}`}
                      onClick={() => toggleFoodTag(tag)}
                    >{tag}</button>
                  ))}
                </div>
              )}
            <div className="tag-new">
              <input value={newTagInput} onChange={(event) => setNewTagInput(event.target.value)} placeholder="新增標籤" />
              <button type="button" onClick={addCustomFoodTag} disabled={!newTagInput.trim()}>新增</button>
            </div>
          </div>

          <label>品牌／店家<input value={foodDraft.brand} onChange={(event) => setFoodDraft({ ...foodDraft, brand: event.target.value })} /></label>
          <label>口味<input value={foodDraft.flavor} onChange={(event) => setFoodDraft({ ...foodDraft, flavor: event.target.value })} /></label>
          <label>每份熱量（kcal）<input value={foodDraft.kcal} onChange={(event) => setFoodDraft({ ...foodDraft, kcal: event.target.value })} inputMode="decimal" /></label>
          <label>每份蛋白質（g）<input value={foodDraft.proteinG} onChange={(event) => setFoodDraft({ ...foodDraft, proteinG: event.target.value })} inputMode="decimal" /></label>
          <label>每份碳水化合物（g，可留空）<input value={foodDraft.carbsG} onChange={(event) => setFoodDraft({ ...foodDraft, carbsG: event.target.value })} inputMode="decimal" /></label>
          <label>每份脂肪（g，可留空）<input value={foodDraft.fatG} onChange={(event) => setFoodDraft({ ...foodDraft, fatG: event.target.value })} inputMode="decimal" /></label>
          {/* 糖與鈉：隨手記、不主打（規格 §1 原則 7b），所以收在摺疊區不佔第一眼視線。 */}
          <details className="more-nutrition">
            <summary>更多（糖、鈉）</summary>
            <label>每份糖（g，可留空）<input value={foodDraft.sugarG} onChange={(event) => setFoodDraft({ ...foodDraft, sugarG: event.target.value })} inputMode="decimal" /></label>
            <label>每份鈉（mg，可留空）<input value={foodDraft.sodiumMg} onChange={(event) => setFoodDraft({ ...foodDraft, sodiumMg: event.target.value })} inputMode="decimal" /></label>
          </details>

          {/* §2.10.3：在別的地方算好，貼回來就自動填。純本機解析，不呼叫任何模型。 */}
          <details className="paste-nutrition">
            <summary>貼上營養資訊自動填欄位</summary>
            <button type="button" className="copy-prompt-button" onClick={() => void copyNutritionPrompt()}>
              複製提示詞
            </button>
            <textarea
              value={pastedNutritionText}
              onChange={(event) => applyPastedNutrition(event.target.value)}
              placeholder="貼上例如：熱量 320 大卡，蛋白質 18 克，碳水 34g，脂肪 12 公克，糖 5g，鈉 610mg"
              rows={3}
            />
            <small className="hint">{pastedNutritionMessage ?? '按「複製提示詞」貼到你常用的 AI，算完把回覆貼回這裡就會自動填；抓不到數字不會有任何影響，照常手打即可。不會連網、不會呼叫 AI。'}</small>
          </details>

          <div className="photo-section">
            <label>照片（最多 {MAX_FOOD_PHOTOS} 張，可留空）</label>
            <div className="photo-grid">
              {foodDraft.photoKeys.map((key, index) => (
                <PhotoThumb key={key} photoKey={key} onRemove={() => void removeFoodPhoto(index)} onPreview={() => setPhotoPreview({ keys: foodDraft.photoKeys, index })} />
              ))}
              {foodDraft.photoKeys.length < MAX_FOOD_PHOTOS && (
                <PhotoSourceButtons multiple onFiles={(files) => void addFoodPhotos(files)} />
              )}
            </div>
            {photoEstimateEnabled && !isNewFood && editingFoodId && (
              <button
                type="button"
                className="ai-recalc-button"
                disabled={saving}
                onClick={() => void openPhotoEstimateForFood(editingFoodId, foodDraft.photoKeys)}
              >
                <MonoIcon name="camera" className="icon-sm" /> 用 AI 重新計算
              </button>
            )}
          </div>

          <button type="button" className="primary" disabled={saving || !foodDraft.name.trim()} onClick={() => saveFoodDraft(false)}>
            {isNewFood ? '加入食物庫' : '保存食物修改'}
          </button>
          {isNewFood && (
            <button type="button" className="primary" disabled={saving || !foodDraft.name.trim()} onClick={() => saveFoodDraft(true)}>
              同時新增到食物庫和今日記錄
            </button>
          )}
        </section>
        {!isNewFood && (
          <section className="danger-zone">
            <button type="button" disabled={saving || !foodDraft.name.trim()} onClick={() => setConfirmDuplicateFood(true)}>
              <MonoIcon name="copy" className="icon-sm" /> 另存為新食物
            </button>
            <button type="button" className="danger" disabled={saving} onClick={() => setConfirmDeleteFood(true)}>
              <MonoIcon name="trash" className="icon-sm" /> 刪除這個食物
            </button>
          </section>
        )}
        {confirmDuplicateFood && (
          <div className="confirm-overlay" role="dialog" aria-modal="true">
            <div className="confirm-card">
              <strong>另存「{foodDraft.name}」為新食物</strong>
              <p>目前編輯的所有資料（名稱、營養數據、照片）都會被儲存到新食物。原來的食物保持不變。</p>
              <div className="confirm-actions">
                <button type="button" onClick={() => setConfirmDuplicateFood(false)}>取消</button>
                <button type="button" className="primary" disabled={saving} onClick={duplicateFoodConfirmed}>確定儲存為新食物</button>
              </div>
            </div>
          </div>
        )}
        {confirmDeleteFood && (
          <div className="confirm-overlay" role="dialog" aria-modal="true">
            <div className="confirm-card">
              <strong>確定要刪除「{foodDraft.name}」嗎？</strong>
              {/* 先講被引用幾次再講後果：owner 砍錯過重複資料，數字要在按下去之前看到。 */}
              <p>
                {editingFoodId && foodUsageOf(foodUsage, editingFoodId).useCount > 0
                  ? `這筆食物已被 ${foodUsageOf(foodUsage, editingFoodId).useCount} 筆飲食紀錄引用，刪除後那些紀錄會變成「已刪除的食物」（紀錄本身不會消失）。`
                  : '這筆食物還沒有被任何飲食紀錄引用，刪除不會影響既有紀錄。'}
              </p>
              <p>此動作無法復原。</p>
              <div className="confirm-actions">
                <button type="button" onClick={() => setConfirmDeleteFood(false)}>取消</button>
                <button type="button" className="danger" disabled={saving} onClick={deleteFoodConfirmed}>確定刪除</button>
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  if (view === 'mealEditor' && !snapshot.mealLogs.some((log) => log.id === editingMealId)) {
    // 這筆紀錄已經不在了（例如被刪除後編輯畫面還沒退出），下一輪 effect 再導回今日飲食，
    // 避免在 render 過程中直接呼叫 setState。
    queueMicrotask(() => setView('daily'))
  }

  if (view === 'mealEditor') {
    const editingMealLog = snapshot.mealLogs.find((log) => log.id === editingMealId)
    if (!editingMealLog) return <main className="shell"><p>載入中...</p></main>
    const linkedFoodItem = snapshot.foodItems.find((item) => item.id === editingMealLog.foodItemId) ?? null
    const mealReplaceTagFiltered = mealReplaceTag === 'all'
      ? snapshot.foodItems
      : snapshot.foodItems.filter((item) => (item.tags ?? []).includes(mealReplaceTag))
    const mealReplaceCandidates = (mealReplaceQuery.trim()
      ? matchFoodKeyword(mealReplaceQuery, mealReplaceTagFiltered).map((match) => match.foodItem)
      : mealReplaceTagFiltered
    ).filter((item) => item.id !== editingMealLog.foodItemId)
    return (
      <main className="shell">
        <Header title="編輯飲食紀錄" onBack={() => setView('daily')} />
        <section className="food-form">
          <label>食物名稱<input value={mealName} onChange={(event) => setMealName(event.target.value)} /></label>
          <label>每份熱量（kcal）<input value={mealKcal} onChange={(event) => setMealKcal(event.target.value)} inputMode="decimal" /></label>
          <label>每份蛋白質（g）<input value={mealProtein} onChange={(event) => setMealProtein(event.target.value)} inputMode="decimal" /></label>
          <label>份量（份）
            <div className="servings-stepper">
              <button type="button" aria-label="減少份量" onClick={() => setMealServings(String(adjustServings(Number(mealServings) || 1, -1)))}>−</button>
              <input value={mealServings} onChange={(event) => setMealServings(event.target.value)} inputMode="decimal" />
              <button type="button" aria-label="增加份量" onClick={() => setMealServings(String(adjustServings(Number(mealServings) || 1, 1)))}>＋</button>
            </div>
          </label>
          <label>時間<input type="time" value={mealTime} onChange={(event) => setMealTime(event.target.value)} /></label>
          <button type="button" onClick={() => { setMealReplaceQuery(''); setMealReplaceTag('all'); setMealReplaceOpen(true) }}>
            <MonoIcon name="refresh" className="icon-sm" /> 用食物庫的其他食物替換
          </button>
          <small className="hint">替換後份量與時間不變，只改這筆紀錄連到哪個食物庫項目。</small>
        </section>
        {mealReplaceOpen && (
          <div className="quick-entry-overlay" role="dialog" aria-modal="true" onClick={() => setMealReplaceOpen(false)}>
            <section className="quick-entry-card" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="quick-entry-close" aria-label="關閉" onClick={() => setMealReplaceOpen(false)}><MonoIcon name="close" className="icon-md" /></button>
              <div className="quick-entry-header">
                <strong>選擇要替換成的食物</strong>
              </div>
              {tags.length > 0 && (
                <div className="tag-options">
                  <button type="button" className={`tag-choice${mealReplaceTag === 'all' ? ' selected' : ''}`} onClick={() => setMealReplaceTag('all')}>全部</button>
                  {tags.map((tag) => (
                    <button type="button" key={tag} className={`tag-choice${mealReplaceTag === tag ? ' selected' : ''}`} onClick={() => setMealReplaceTag(tag)}>{tag}</button>
                  ))}
                </div>
              )}
              <input value={mealReplaceQuery} onChange={(event) => setMealReplaceQuery(event.target.value)} placeholder="搜尋名稱或別名" autoFocus />
              <div className="food-options">
                {mealReplaceCandidates.length === 0 ? (
                  <div className="empty"><p>找不到食物。</p></div>
                ) : mealReplaceCandidates.map((foodItem) => (
                  <button type="button" className="food-option" key={foodItem.id} disabled={saving} onClick={() => { setMealReplaceOpen(false); setMealReplaceTarget(foodItem) }}>
                    <span className="food-option-name">
                      <strong>{foodItem.name}</strong>
                      {(foodItem.brand || foodItem.flavor) && (
                        <small>{[foodItem.brand, foodItem.flavor].filter(Boolean).join(' · ')}</small>
                      )}
                    </span>
                    <span className="food-option-stats">
                      <small className="food-option-macro">{foodItem.perServing.kcal} kcal</small>
                      <small className="food-option-macro">{foodItem.perServing.proteinG} g 蛋白</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
        {mealReplaceTarget && (
          <div className="confirm-overlay" role="dialog" aria-modal="true">
            <div className="confirm-card">
              <strong>確定要用「{mealReplaceTarget.name}」替換嗎？</strong>
              <p>目前連結的食物「{linkedFoodItem?.name ?? '（已刪除的食物）'}」會換成「{mealReplaceTarget.name}」，份量與時間保留不變。</p>
              <div className="confirm-actions">
                <button type="button" onClick={() => setMealReplaceTarget(null)}>取消</button>
                <button type="button" className="primary" disabled={saving} onClick={() => replaceMealFood(mealReplaceTarget)}>確定替換</button>
              </div>
            </div>
          </div>
        )}
        <MealPhotoField
          mealLog={editingMealLog}
          foodItem={linkedFoodItem}
          onPick={(file) => void pickMealPhoto(file)}
          onClear={() => void clearMealPhoto()}
          onPreview={
            editingMealLog.photoKey || linkedFoodItem?.photoKeys[0]
              ? () => setPhotoPreview({ keys: editingMealLog.photoKey ? [editingMealLog.photoKey] : linkedFoodItem?.photoKeys[0] ? [linkedFoodItem.photoKeys[0]] : [], index: 0 })
              : undefined
          }
        />
        {photoPreview && <PhotoPreview photoKeys={photoPreview.keys} initialIndex={photoPreview.index} onClose={() => setPhotoPreview(null)} />}
        <section className="scope-choice">
          <button type="button" disabled={saving} onClick={() => saveMealEdit('meal')}>只儲存到當日飲食</button>
          <small>只影響這一筆紀錄，食物庫不會改變</small>
          <button type="button" className="primary" disabled={saving} onClick={() => saveMealEdit('food')}>更新食物庫資料</button>
          <small>食物庫也會更新，之後每次吃這個食物都會套用新數值</small>
        </section>
        {linkedFoodItem && (
          <section className="library-data-section">
            <strong>食物庫資料</strong>
            <p className="hint">
              品牌、口味、別名、標籤、碳水／脂肪與照片存在食物庫裡，不屬於這筆飲食紀錄——在這裡編輯會更新食物庫，之後每次吃「{linkedFoodItem.name}」都會套用新內容，不會只改今天這一筆。
            </p>
            <div className="library-data-preview">
              <span>{[linkedFoodItem.brand, linkedFoodItem.flavor].filter(Boolean).join(' · ') || '尚未填寫品牌／口味'}</span>
              {(linkedFoodItem.tags ?? []).length > 0 && (
                <div className="tag-row">{linkedFoodItem.tags!.map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}</div>
              )}
            </div>
            <button type="button" disabled={saving} onClick={() => openFoodForm(linkedFoodItem, 'mealEditor')}>
              <MonoIcon name="edit" className="icon-sm" /> 編輯食物庫資料
            </button>
          </section>
        )}
        <section className="danger-zone">
          <button type="button" className="danger" disabled={saving} onClick={() => setConfirmDeleteMeal(true)}>
            <MonoIcon name="trash" className="icon-sm" /> 刪除這筆飲食紀錄
          </button>
        </section>
        {confirmDeleteMeal && (
          <div className="confirm-overlay" role="dialog" aria-modal="true">
            <div className="confirm-card">
              <strong>確定要刪除這筆飲食紀錄嗎？</strong>
              <p>此動作無法復原。</p>
              <div className="confirm-actions">
                <button type="button" onClick={() => setConfirmDeleteMeal(false)}>取消</button>
                <button type="button" className="danger" disabled={saving} onClick={deleteMeal}>確定刪除</button>
              </div>
            </div>
          </div>
        )}
      </main>
    )
  }

  if (view === 'profile') {
    return (
      <main className="shell">
        <Header title="身體資料與每日目標" onBack={() => setView('daily')} />
        <section className="food-form">
          <label>身高（cm）<input value={profileHeight} onChange={(event) => setProfileHeight(event.target.value)} inputMode="decimal" /></label>
          <label>體重（kg）<input value={profileWeight} onChange={(event) => setProfileWeight(event.target.value)} inputMode="decimal" /></label>
          <label>量測時間<input type="time" value={profileWeightTime} onChange={(event) => setProfileWeightTime(event.target.value)} /></label>
          <label>年齡（歲）<input value={profileAge} onChange={(event) => setProfileAge(event.target.value)} inputMode="numeric" /></label>
          <label>性別
            <select value={profileSex} onChange={(event) => setProfileSex(event.target.value as 'male' | 'female')}>
              <option value="female">女性</option>
              <option value="male">男性</option>
            </select>
          </label>
          <label>體脂率（%，選填）<input value={profileBodyFatPercent} onChange={(event) => setProfileBodyFatPercent(event.target.value)} inputMode="decimal" placeholder="留空時使用 Mifflin 公式" /></label>
          <label>活動量
            <select value={profileActivity} onChange={(event) => setProfileActivity(event.target.value as NutritionActivityLevel)}>
              <option value="sedentary">久坐</option>
              <option value="light">輕度</option>
              <option value="moderate">中度</option>
              <option value="active">高度</option>
              <option value="very-active">非常高度</option>
            </select>
          </label>
          <label>目標
            <select value={profileGoal} onChange={(event) => setProfileGoal(event.target.value as NutritionGoal)}>
              <option value="lose-weight">減重</option>
              <option value="gain-muscle">增肌減脂</option>
              <option value="maintain">維持體重</option>
              <option value="gain-weight">增重</option>
            </select>
          </label>
          <label>每日熱量上限（kcal）<input value={profileKcal} onChange={(event) => setProfileKcal(event.target.value)} inputMode="decimal" /></label>
          <label>每日蛋白質目標（g）<input value={profileProtein} onChange={(event) => setProfileProtein(event.target.value)} inputMode="decimal" /></label>
          <button type="button" disabled={saving} onClick={() => saveProfile(false)}>保存目標</button>
          <button type="button" className="primary" disabled={saving} onClick={() => saveProfile(true)}>計算並套用 TDEE／蛋白質建議</button>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={showWeightBadge}
              disabled={saving}
              onChange={(event) => updateShowWeightBadge(event.target.checked)}
            />
            <span>在頂部顯示目前體重與量測時間</span>
          </label>
          <p className="hint">
            以上數值為概略估算，僅供參考，非醫療或營養專業建議。若有慢性腎臟病、肝病、懷孕哺乳或其他需限制蛋白質攝取的狀況，請諮詢醫師或營養師再調整。
            <br />
            蛋白質基礎值參考衛生福利部國民健康署《國人膳食營養素參考攝取量》第八版；熱量與蛋白質的活動量加成為一般經驗法則。
          </p>
        </section>

        {/* App 介面的配色。跟下面的小工具配色是兩個獨立設定。 */}
        <section className="health-sync-section">
          <strong>介面配色</strong>
          <p className="hint">跟 DeST 主程式同一組 12 色，但各自獨立，可以設成不一樣的顏色。</p>
          <div className="widget-theme-grid">
            {THEME_IDS.map((id) => {
              const t = THEMES[id]
              const active = colorTheme === id
              return (
                <button
                  key={id}
                  type="button"
                  className={`widget-theme-swatch${active ? ' active' : ''}`}
                  disabled={saving}
                  aria-pressed={active}
                  style={{ background: t.bg }}
                  onClick={() => updateColorTheme(id)}
                >
                  <span className="widget-theme-dots">
                    {[t.mint, t.mint2, t.userBubble].map((c, i) => (
                      <span key={i} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="widget-theme-label" style={{ color: t.text }}>{THEME_LABELS[id] ?? id}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/*
          桌面小工具的外觀（§14.2）。用 DeST 的 12 組配色，但跟 DeST 各存各的——
          owner 明講「兩邊可以設定不同顏色」；也跟上面的 App 配色各自獨立。
        */}
        <section className="health-sync-section">
          <strong>桌面小工具外觀</strong>
          <p className="hint">配色與底色透明度。跟 DeST 主程式各自獨立，可以設成不一樣的顏色。</p>
          <div className="widget-theme-grid">
            {THEME_IDS.map((id) => {
              const t = THEMES[id]
              const active = (widgetAppearance.theme ?? 'mint') === id
              return (
                <button
                  key={id}
                  type="button"
                  className={`widget-theme-swatch${active ? ' active' : ''}`}
                  disabled={saving}
                  aria-pressed={active}
                  style={{ background: t.bg }}
                  onClick={() => updateWidgetAppearance({ theme: id })}
                >
                  <span className="widget-theme-dots">
                    {[t.mint, t.mint2, t.userBubble].map((c, i) => (
                      <span key={i} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="widget-theme-label" style={{ color: t.text }}>{THEME_LABELS[id] ?? id}</span>
                </button>
              )
            })}
          </div>
          <label className="widget-opacity-row">
            <span>底色透明度：{widgetOpacityDraft}%</span>
            {/* 拖曳中只動本地 state，放開才寫檔＋叫原生重繪（每動一格就寫會很卡）。 */}
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={widgetOpacityDraft}
              disabled={saving}
              onChange={(event) => setWidgetOpacityDraft(Number(event.target.value))}
              onPointerUp={() => updateWidgetAppearance({ bgOpacity: widgetOpacityDraft })}
              onTouchEnd={() => updateWidgetAppearance({ bgOpacity: widgetOpacityDraft })}
            />
          </label>
          <p className="hint">調到 0% 就只剩數字浮在桌布上。文字顏色不受透明度影響。</p>
        </section>

        <section className="health-sync-section">
          <strong>AI 拍照估算</strong>
          <p className="hint">
            拍一張照，用你自己的 API Key 呼叫模型估算熱量與蛋白質。<strong>每次估算都會產生費用</strong>（本地模型除外）。
            也可以在自己平常用的 AI 那邊估好，回來手打即可，不需要開這個。
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={photoEstimateEnabled}
              disabled={saving}
              onChange={(event) => updatePhotoEstimateEnabled(event.target.checked)}
            />
            <span>開啟 AI 拍照估算</span>
          </label>
          {photoEstimateEnabled && (() => {
            const catalogModels = llmSettings.provider === 'local' ? [] : (MODELS_BY_PROVIDER[llmSettings.provider as keyof typeof MODELS_BY_PROVIDER] ?? [])
            const modelOptions = llmSettings.provider === 'local' ? localModels : catalogModels
            const { normal, high } = splitModelsByPrice(modelOptions)
            return (
              <>
                <div className="llm-import-box">
                  <p className="hint">如果手機上有裝 DeST，可以直接把它的 AI 設定匯入，不用在這裡重填一次。</p>
                  <div className="llm-import-actions">
                    {scannerAvailable && (
                      <button type="button" onClick={() => void scanLlmImport()}>掃描 DeST 的 QR</button>
                    )}
                    <button type="button" onClick={() => setShowImportPaste((v) => !v)}>貼上匯入文字</button>
                  </div>
                  {showImportPaste && (
                    <div className="llm-import-paste">
                      <textarea
                        value={importPasteText}
                        onChange={(event) => setImportPasteText(event.target.value)}
                        placeholder="貼上 DeST「匯出設定給食記」分享出來的文字"
                        rows={2}
                      />
                      <button type="button" onClick={() => void applyLlmImport(importPasteText)} disabled={!importPasteText.trim()}>匯入</button>
                    </div>
                  )}
                  {importMessage && (
                    <small className={importMessage.ok ? 'hint' : 'hint danger-text'}>{importMessage.text}</small>
                  )}
                </div>

                <label>供應商
                  <select value={llmSettings.provider} onChange={(event) => changeLlmProvider(event.target.value)}>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Anthropic Claude</option>
                    <option value="gemini">Google Gemini</option>
                    <option value="grok">Grok</option>
                    <option value="local">本機（Ollama／LM Studio 等）</option>
                  </select>
                </label>
                {llmSettings.provider !== 'local' && (
                  <label>API Key<input type="password" value={llmSettings.apiKeys[llmSettings.provider] ?? ''} onChange={(event) => updateLlmSettings({ apiKeys: { ...llmSettings.apiKeys, [llmSettings.provider]: event.target.value } })} /></label>
                )}
                {llmSettings.provider === 'local' ? (
                  <label>端點（本機模型必填）<input value={llmSettings.endpoints?.[llmSettings.provider] ?? ''} onChange={(event) => updateLlmSettings({ endpoints: { ...llmSettings.endpoints, [llmSettings.provider]: event.target.value } })} placeholder="例如 http://localhost:11434/v1" /></label>
                ) : (
                  <details className="advanced-endpoint">
                    <summary>進階：自訂端點（一般不需要，除非你走相容代理）</summary>
                    <label>端點<input value={llmSettings.endpoints?.[llmSettings.provider] ?? ''} onChange={(event) => updateLlmSettings({ endpoints: { ...llmSettings.endpoints, [llmSettings.provider]: event.target.value } })} placeholder={`留空＝官方 ${PROVIDER_LABELS[llmSettings.provider] ?? llmSettings.provider} API`} /></label>
                  </details>
                )}
                <button type="button" disabled={testingConnection} onClick={() => void testLlmConnection()}>
                  {testingConnection ? '連線測試中...' : (llmSettings.provider === 'local' ? '測試連線（抓模型清單）' : '測試連線')}
                </button>
                {connectionTestMessage && (
                  <small className={connectionTestMessage.ok ? 'hint' : 'hint danger-text'}>
                    {connectionTestMessage.text}
                    {connectionTestMessage.ok && llmSettings.provider !== 'local' && '（雲端只列前 5 筆佐證連線成功，實際可選的模型看下面的下拉清單）'}
                  </small>
                )}

                <label>模型（需支援讀圖，Vision）
                  {modelOptions.length > 0 ? (
                    <select value={llmSettings.model ?? ''} onChange={(event) => updateLlmSettings({ model: event.target.value })}>
                      <option value="">請選擇</option>
                      {normal.map((m) => <option key={m} value={m}>{modelOptionLabel(m)}</option>)}
                      {high.length > 0 && (
                        <optgroup label="⚠ 高單價">
                          {high.map((m) => <option key={m} value={m}>{modelOptionLabel(m)}</option>)}
                        </optgroup>
                      )}
                    </select>
                  ) : (
                    <small className="hint">
                      {llmSettings.provider === 'local' ? '按上面「測試連線」抓這個端點實際有的模型' : '選好供應商後這裡會列出模型清單'}
                    </small>
                  )}
                </label>
                <label>或手動輸入模型 ID（清單沒有的新模型／自訂 ID）
                  <input value={llmSettings.model ?? ''} onChange={(event) => updateLlmSettings({ model: event.target.value })} placeholder="例如 gpt-4o-mini" />
                </label>

                <button type="button" disabled={testingVision || !llmSettings.model} onClick={() => void testLlmVision()}>
                  {testingVision ? '測試中...' : '一鍵測試能不能傳圖'}
                </button>
                {visionTestMessage && <small className={visionTestMessage.ok ? 'hint' : 'hint danger-text'}>{visionTestMessage.ok ? '✅ ' : '❌ '}{visionTestMessage.text}</small>}

                <label>比例尺校正（可留白，填一次就好）
                  <textarea
                    value={scaleReference}
                    onChange={(event) => setScaleReference(event.target.value)}
                    onBlur={() => updateScaleReference(scaleReference)}
                    placeholder="例如：照片裡的手是我的，手掌寬約 7 公分（比一般成人小），請以此換算食物尺寸"
                    rows={3}
                  />
                </label>
                <small className="hint">
                  拿手或其他東西當比例尺時，模型預設會套「一般成人」的尺寸。
                  你的手若比一般人小，食物會被放大——<strong>體積是長度的三次方，差 20% 就是熱量差約 1.7 倍</strong>。
                  在這裡寫一次，之後每次估算都會自動附上。
                </small>
              </>
            )
          })()}
        </section>

        <section className="health-sync-section">
          <strong>Health 同步</strong>
          <p className="hint">
            讀 Android 的 Health Connect（Google Health 背後同一份資料）：手錶、體重計只要有寫進去就讀得到。
            已驗證 Pixel Watch 與 MovingLife，其他品牌未實測。
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={healthSettings.connected}
              disabled={saving || healthSyncing}
              onChange={(event) => toggleHealthConnected(event.target.checked)}
            />
            <span>和 Health Connect 同步</span>
          </label>
          {!healthAvailable && (
            <p className="hint">這台裝置目前偵測不到 Health Connect，開啟也不會生效。</p>
          )}
          {healthSettings.connected && (
            <>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={healthSettings.autoSync}
                  disabled={saving || healthSyncing}
                  onChange={(event) => updateHealthSettings({ autoSync: event.target.checked })}
                />
                <span>自動同步（開啟 App 時自動讀取最新資料）</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={healthSettings.useWatchCalorieLimit}
                  disabled={saving || healthSyncing}
                  onChange={(event) => updateHealthSettings({ useWatchCalorieLimit: event.target.checked })}
                />
                <span>以手錶消耗熱量做為當日上限（今日快覽會動態顯示，不會覆蓋上面手動設定的上限）</span>
              </label>
              {!healthPermissionGranted && (
                <button type="button" disabled={healthSyncing} onClick={() => void runHealthSync({ requestPermissionIfNeeded: true })}>
                  尚未授權，點一下開啟權限
                </button>
              )}
              <button type="button" disabled={healthSyncing} onClick={() => void runHealthSync()}>
                {healthSyncing ? '同步中...' : '立即同步'}
              </button>
              <p className="hint">
                上次同步：{bodyProfile?.healthSyncedAt
                  ? new Date(bodyProfile.healthSyncedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : '尚未同步過'}
              </p>
              {healthMessage && <p className="hint">{healthMessage}</p>}
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={healthSettings.writeCalories}
                  disabled={saving || healthWriteBusy}
                  onChange={(event) => toggleHealthWriteCalories(event.target.checked)}
                />
                <span>把吃的熱量寫回 Health（只寫熱量，不含蛋白質／脂肪／碳水——外掛限制）</span>
              </label>
              {healthSettings.writeCalories && (
                <>
                  <p className="hint">
                    開啟時已把當時的所有記錄補寫一次；之後新增或修改的記錄會自動補推，
                    同一筆只會寫一次，不會因為編輯而重複。
                  </p>
                  <button
                    type="button"
                    disabled={healthWriteBusy}
                    onClick={() => {
                      const session = sessionRef.current
                      if (!session) return
                      setHealthWriteBusy(true)
                      setHealthWriteMessage(null)
                      void writeMealLogsToHealthIfNeeded(session, true).finally(() => setHealthWriteBusy(false))
                    }}
                  >
                    {healthWriteBusy ? '補寫中...' : '手動補寫一次'}
                  </button>
                </>
              )}
              {healthWriteMessage && <p className="hint">{healthWriteMessage}</p>}
            </>
          )}
        </section>
      </main>
    )
  }

  if (view === 'about') {
    const info = buildInfoLines()
    return (
      <main className="shell">
        <Header title="關於" onBack={() => setView('daily')} />
        <section className="food-form">
          <strong>{info.title}</strong>
          {info.detail && <small className="hint">{info.detail}</small>}
          <small className="hint">要看「更新了沒」看建置時間，不是版本號——debug 版重打幾次版本號也不會變。</small>
        </section>
        <section className="food-form">
          <strong>搬家（匯出／匯入）</strong>
          <small className="hint">手機與電腦是各自獨立的兩份資料，不會自動同步。用搬家包手動讓兩邊資料一致，或換機時把資料帶過去。內容不含 API Key。</small>
          <button type="button" className="primary" disabled={transferBusy} onClick={() => void exportPack()}>
            <MonoIcon name="download" className="icon-sm" /> 匯出搬家包
          </button>
          <button type="button" disabled={transferBusy} onClick={() => void importPack('fill-only')}>
            <MonoIcon name="import" className="icon-sm" /> 匯入（僅補本機沒有的）
          </button>
          <small className="hint">安全的做法：本機已經有的資料完全不動，只補本機缺少的食物／紀錄。</small>
          <button type="button" className="danger" disabled={transferBusy} onClick={() => void importPack('overwrite')}>
            <MonoIcon name="import" className="icon-sm" /> 匯入（用較新的蓋掉本機）
          </button>
          <small className="hint">同一筆資料兩邊都有時，比較後面修改過的（updatedAt 較新）會贏。</small>
          {transferBusy && <p className="hint">處理中...</p>}
          {transferMessage && <p className="hint">{transferMessage}</p>}
        </section>
      </main>
    )
  }

  if (view === 'stats') {
    const todayIso = toIsoDateString(Date.now())
    const statsOptions = { overlapOnly: statsOverlapOnly, excludeToday: !statsIncludeToday }
    const weekStats = buildNutritionStats(snapshot.mealLogs, snapshot.foodItems, resolveStatsRange('this-week', todayIso), todayIso, historicalKcalCache, statsOptions)
    const monthStats = buildNutritionStats(snapshot.mealLogs, snapshot.foodItems, resolveStatsRange('this-month', todayIso), todayIso, historicalKcalCache, statsOptions)
    const rangeStats = buildNutritionStats(snapshot.mealLogs, snapshot.foodItems, statsRange, todayIso, historicalKcalCache, statsOptions)
    const burnConnected = healthSettings.connected && healthAvailable && healthPermissionGranted
    const maxKcal = Math.max(1, ...rangeStats.days.map((day) => Math.max(day.kcal, day.burnedKcal ?? 0)))
    const rangeLabels: { kind: NutritionStatsRangeKind; label: string }[] = [
      { kind: 'last-7', label: '近 7 天' },
      { kind: 'last-30', label: '近 30 天' },
      { kind: 'this-week', label: '本週' },
      { kind: 'this-month', label: '本月' },
      { kind: 'custom', label: '自訂' }
    ]

    /** 一個區間的四個數字：合計／日均，攝取／消耗。消耗沒資料就不佔位。 */
    const periodCard = (title: string, stats: typeof rangeStats, subtitle: string): React.JSX.Element => (
      <section className="stats-card" key={title}>
        <header>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </header>
        <div className="stats-grid">
          <div>
            <span>合計攝取</span>
            <strong>{stats.totalKcal.toLocaleString('zh-TW')} kcal</strong>
          </div>
          <div>
            <span>日均攝取</span>
            <strong>{stats.averageKcalPerDay.toLocaleString('zh-TW')} kcal</strong>
          </div>
          {stats.burnedDayCount > 0 && (
            <>
              <div>
                <span>合計消耗</span>
                <strong>{stats.totalBurnedKcal.toLocaleString('zh-TW')} kcal</strong>
              </div>
              <div>
                <span>日均消耗</span>
                <strong>{stats.averageBurnedPerDay.toLocaleString('zh-TW')} kcal</strong>
              </div>
            </>
          )}
          <div>
            <span>日均蛋白</span>
            <strong>{stats.averageProteinPerDay} g</strong>
          </div>
          {stats.averageNetKcalPerDay !== null && (
            <div>
              <span>日均淨值</span>
              {/* 這一格才是「不用焦慮」的重點：單天爆掉，平均下來常常還是赤字。 */}
              <strong className={stats.averageNetKcalPerDay > 0 ? 'over' : 'good'}>
                {stats.averageNetKcalPerDay > 0 ? '+' : ''}{stats.averageNetKcalPerDay.toLocaleString('zh-TW')} kcal
              </strong>
            </div>
          )}
        </div>
        <small className="hint">
          日均以「已過 {stats.elapsedDayCount} 天」為分母；其中有紀錄 {stats.loggedDayCount} 天
          {stats.loggedDayCount > 0 && stats.loggedDayCount < stats.elapsedDayCount
            && `（只算有紀錄的日子是 ${stats.averageKcalPerLoggedDay.toLocaleString('zh-TW')} kcal）`}
          {stats.burnedDayCount > 0 && `，有手錶消耗資料 ${stats.burnedDayCount} 天`}
        </small>
      </section>
    )

    return (
      <main className="shell">
        <Header title="熱量統計" onBack={() => setView('daily')} />

        {periodCard('本週', weekStats, `${weekStats.range.startIsoDate.slice(5)} – ${weekStats.range.endIsoDate.slice(5)}`)}
        {periodCard('本月', monthStats, `${monthStats.range.startIsoDate.slice(0, 7)}`)}

        <section className="stats-range-picker">
          <div className="tag-options">
            {rangeLabels.map(({ kind, label }) => (
              <button
                type="button"
                key={kind}
                className={`tag-choice${statsRangeKind === kind ? ' selected' : ''}`}
                onClick={() => setStatsRangeKind(kind)}
              >{label}</button>
            ))}
          </div>
          {statsRangeKind === 'custom' && (
            <div className="stats-custom-range">
              <label>起<input type="date" value={customRange.startIsoDate} onChange={(event) => setCustomRange((prev) => ({ ...prev, startIsoDate: event.target.value }))} /></label>
              <label>迄<input type="date" value={customRange.endIsoDate} onChange={(event) => setCustomRange((prev) => ({ ...prev, endIsoDate: event.target.value }))} /></label>
            </div>
          )}
          <label className="toggle-row">
            <input type="checkbox" checked={statsIncludeToday} onChange={(event) => setStatsIncludeToday(event.target.checked)} />
            <span>包含今天（今天還沒過完，預設不算進總計／日均，避免看起來吃得比平常少）</span>
          </label>
          {burnConnected && (
            <label className="toggle-row">
              <input type="checkbox" checked={statsOverlapOnly} onChange={(event) => setStatsOverlapOnly(event.target.checked)} />
              <span>只算攝取與消耗都有紀錄的天（避免手錶資料比飲食紀錄久而失真）</span>
            </label>
          )}
        </section>

        {rangeStats.dayCount === 0
          ? <p className="empty">日期範圍顛倒了，請把「迄」設在「起」之後。</p>
          : periodCard(
            statsRangeKind === 'custom' ? '自訂範圍' : rangeLabels.find((item) => item.kind === statsRangeKind)!.label,
            rangeStats,
            `${rangeStats.range.startIsoDate} – ${rangeStats.range.endIsoDate}`
          )}

        {rangeStats.dayCount > 0 && rangeStats.dayCount <= 62 && (
          <section className="stats-bars">
            {rangeStats.days.filter((day) => day.isoDate <= todayIso).map((day) => (
              <div className="stats-bar-row" key={day.isoDate}>
                <time>{day.isoDate.slice(5)}</time>
                <div className="stats-bar-track">
                  <div className="stats-bar intake" style={{ width: `${(day.kcal / maxKcal) * 100}%` }} />
                  {day.burnedKcal !== undefined && (
                    <div className="stats-bar burned" style={{ width: `${(day.burnedKcal / maxKcal) * 100}%` }} />
                  )}
                </div>
                <span className="stats-bar-value">{day.kcal || '—'}</span>
              </div>
            ))}
            <small className="hint">深色＝攝取{burnConnected && '，淺色＝手錶消耗'}</small>
          </section>
        )}

        {!healthSettings.connected && (
          <small className="hint">消耗熱量需要先在「身體資料」頁連接 Health Connect；沒有連接時只統計攝取。</small>
        )}
        {healthSettings.connected && !burnConnected && (
          <button type="button" className="primary full-width" disabled={healthSyncing} onClick={() => void runHealthSync({ requestPermissionIfNeeded: true })}>
            讀取手錶消耗資料
          </button>
        )}
        {statsBurnLoading && <small className="hint">正在讀取每日消耗資料...</small>}
      </main>
    )
  }

  if (view === 'photoEstimate') {
    return (
      <main className="shell">
        <Header title="拍照記錄" onBack={discardEstimate} />
        <section className="food-form">
          {estimatePhase === 'idle' && (
            <>
              <div className="photo-source-row">
                <PhotoSourceButtons multiple large onFiles={addEstimatePhotos} cameraLabel="拍照" galleryLabel="從相簿選" />
              </div>
              <small className="hint">最多 {MAX_FOOD_PHOTOS} 張，可以直接拍，不用先離開 App 用相機。</small>
              {/* 按下去才知道花多少錢就太晚了（§2.9.3）；原本放首頁按鈕下方，
                  跟「快速入帳」並排後會撐壞版面，2026-08-21 owner 要求搬進來這裡。 */}
              <small className="hint">{aiEstimateHint(llmSettings, 0)}</small>
            </>
          )}
          {estimatePhase === 'noteInput' && (
            <section className="estimate-note-section">
              <div className="photo-grid">
                {estimatePreviewUrls.map((url, index) => (
                  <div className="photo-thumb" key={url}>
                    <img src={url} alt="" />
                    <button type="button" className="photo-remove" aria-label="移除照片" onClick={() => removeEstimatePhoto(index)}>
                      <MonoIcon name="close" className="icon-sm" />
                    </button>
                  </div>
                ))}
                {estimateSelectedFiles.length < MAX_FOOD_PHOTOS && (
                  <PhotoSourceButtons multiple onFiles={addEstimatePhotos} />
                )}
              </div>
              <small className="hint">同一份食物可以拍好幾張（包裝正面、營養成分表、實際內容物），會合併成一筆估算——有拍到成分表的話數字最準。</small>
              <label>補充說明（可留白，但文字比讓模型從圖上猜準得多——至少講一下這是什麼）
                <div className="note-input-wrap">
                  <textarea
                    value={estimateNote}
                    onChange={(event) => setEstimateNote(event.target.value)}
                    placeholder="例如：燻雞三明治，7-11，吃了一整份"
                    rows={3}
                    autoFocus
                  />
                  {voiceAvailable && (
                    <button
                      type="button"
                      className={voiceListening ? 'voice-mic-button listening' : 'voice-mic-button'}
                      aria-label={voiceListening ? '聽取中，按這裡停止' : '語音輸入'}
                      onClick={() => void toggleVoiceInput()}
                    >
                      <MonoIcon name={voiceListening ? 'stop' : 'mic'} className="icon-sm" />
                    </button>
                  )}
                </div>
              </label>
              {voiceError && <small className="hint danger-text">{voiceError}</small>}
              {/* 按下去才知道花多少錢就太晚了（§2.9.3）。 */}
              <small className="hint">{aiEstimateHint(llmSettings, estimateSelectedFiles.length)}</small>
              <button type="button" className="primary" disabled={estimateSelectedFiles.length === 0} onClick={() => void submitEstimate()}>
                估算（{estimateSelectedFiles.length} 張）
              </button>
            </section>
          )}
          {estimatePhase === 'loading' && <EstimateLoading isLocal={llmSettings.provider === 'local'} />}
          {estimatePhase === 'error' && (
            <>
              <p className="hint">估算失敗：{estimateError}</p>
              {estimateSelectedFiles.length > 0 && (
                <button type="button" className="primary" onClick={() => setEstimatePhase('noteInput')}>
                  回上一步改說明再試一次
                </button>
              )}
              <div className="photo-source-row">
                <PhotoSourceButtons multiple large onFiles={addEstimatePhotos} cameraLabel="重拍" galleryLabel="重選" />
              </div>
              {estimateTargetFoodId
                ? <button type="button" onClick={discardEstimate}>返回食物編輯</button>
                : <button type="button" onClick={() => openFoodForm(null, 'quickEntry')}>改用手動輸入</button>}
            </>
          )}
          {estimatePhase === 'result' && estimateResult && (
            <section className="estimate-result-card">
              <strong>{estimateMatchedFood ? estimateMatchedFood.name : (estimateResult.name ?? '未命名')}</strong>
              {(estimateMatchedFood?.brand ?? estimateResult.brand) && <small>{estimateMatchedFood?.brand ?? estimateResult.brand}</small>}
              {estimateMatchedFood ? (
                <p>沿用你的紀錄：{estimateMatchedFood.perServing.kcal} kcal · 蛋白 {estimateMatchedFood.perServing.proteinG} g</p>
              ) : (
                <>
                  <p>
                    約 {estimateResult.perServing?.kcal ?? '？'} kcal · 蛋白 {estimateResult.perServing?.proteinG ?? '？'} g
                    <span className="tag-chip">{estimateResult.nutritionSource === 'label' ? '依營養標示' : estimateResult.nutritionSource === 'label-partial' ? '標示不完整' : 'AI 估算'}</span>
                  </p>
                  {estimateResult.confidence === 'low' && <small className="hint">不太確定，存入後可到食物庫修改</small>}
                </>
              )}
              {/* 份量與判斷依據：數字偏高時這兩行才看得出是哪一步估錯（通常是份量，不是熱量密度）。 */}
              {estimateResult.estimatedWeightG !== null && (
                <small className="hint">
                  估計份量約 {estimateResult.estimatedWeightG} g
                  {estimateResult.portionBasis && ` — ${estimateResult.portionBasis}`}
                </small>
              )}
              {estimateResult.note && <small className="hint">{estimateResult.note}</small>}
              <div className="scope-choice">
                {estimateTargetFoodId ? (
                  <button type="button" className="primary" disabled={saving} onClick={applyEstimateToFoodItem}>更新這筆食物庫資料</button>
                ) : (
                  <>
                    <button type="button" className="primary" disabled={saving} onClick={saveEstimateResult}>存入</button>
                    <button type="button" disabled={saving} onClick={() => void openFoodFormFromEstimate()}>不對，我改</button>
                  </>
                )}
              </div>
              <label className="estimate-followup">AI 誤解圖片或文字了嗎？再解釋一次讓它重算
                <textarea
                  value={estimateFollowUpNote}
                  onChange={(event) => setEstimateFollowUpNote(event.target.value)}
                  placeholder="例如：那是無糖豆漿不是牛奶、份量只吃了一半"
                  rows={2}
                />
              </label>
              <button
                type="button"
                disabled={saving || estimateFollowUpNote.trim().length === 0}
                onClick={() => void submitFollowUpEstimate()}
              >
                用這段補充重新估算
              </button>
            </section>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <Header title="" onEyebrowClick={() => setView('about')} center={showWeightBadge && bodyProfile ? <WeightBadge profile={bodyProfile} /> : undefined} actions={
        <>
          <button type="button" className="icon-button" aria-label="食物庫" onClick={() => setView('library')}><MonoIcon name="book" className="icon-md" /></button>
          <button type="button" className="icon-button" aria-label="身體資料與每日目標" onClick={() => setView('profile')}><MonoIcon name="user" className="icon-md" /></button>
        </>
      } />
      <section className="date-row">
        <button type="button" aria-label="前一天" onClick={() => shiftDate(-1)}>←</button>
        <strong>{dateLabel}</strong>
        <button type="button" aria-label="後一天" onClick={() => shiftDate(1)}>→</button>
      </section>
      <section className="summary">
        <div className="summary-tappable" role="button" tabIndex={0} onClick={() => setView('stats')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('stats') }}>
          <span>熱量{dynamicKcalLimit !== null && <small className="dynamic-tag">{isViewingToday ? '依手錶動態' : '當日手錶總消耗'}</small>}</span>
          <strong className={effectiveKcalLimit !== undefined && daily.totalKcal > effectiveKcalLimit ? 'over' : ''}>{daily.totalKcal} kcal</strong>
          <small>/ {effectiveKcalLimit ?? '未設定'}</small>
        </div>
        <div><span>蛋白質</span><strong className={bodyProfile && daily.totalProteinG >= bodyProfile.dailyProteinGoalG ? 'good' : ''}>{daily.totalProteinG} g</strong><small>/ {bodyProfile?.dailyProteinGoalG ?? '未設定'}</small></div>
      </section>
      <section className="home-actions">
        {photoEstimateEnabled && (
          <div className="home-action-col">
            <button type="button" className="primary home-action-btn" disabled={saving} onClick={openPhotoEstimate}>
              <MonoIcon name="camera" className="icon-lg" />
              <span>拍照記錄</span>
            </button>
          </div>
        )}
        <div className="home-action-col">
          <button type="button" className="primary home-action-btn" disabled={saving} onClick={() => setQuickEntryOpen((open) => {
            const next = !open
            if (next) setQuickEntryTime(timeInputValue(Date.now()))
            return next
          })}>
            <MonoIcon name="edit" className="icon-lg" />
            <span>{quickEntryOpen ? '關閉入帳' : '快速入帳'}</span>
          </button>
        </div>
      </section>
      {quickEntryOpen && (
        <div className="quick-entry-overlay" role="dialog" aria-modal="true" onClick={() => setQuickEntryOpen(false)}>
          <section className="quick-entry-card" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="quick-entry-close" aria-label="關閉" onClick={() => setQuickEntryOpen(false)}><MonoIcon name="close" className="icon-md" /></button>
            <div className="quick-entry-time-row">
              <strong>記錄時間</strong>
              <input type="time" className="quick-entry-time-input" value={quickEntryTime} onChange={(event) => setQuickEntryTime(event.target.value)} />
              <button type="button" className="time-now-button" aria-label="重設為目前時間" onClick={() => setQuickEntryTime(timeInputValue(Date.now()))}>
                <MonoIcon name="refresh" className="icon-sm" />
              </button>
            </div>
            <div className="quick-entry-header">
              <strong>從食物庫選擇</strong>
              <button type="button" className="add-food-button" aria-label="新增食物到食物庫" onClick={() => { setQuickEntryOpen(false); openFoodForm(null, 'quickEntry') }}>
                <MonoIcon name="plus" className="icon-sm" /> 新增食物
              </button>
            </div>
            {(tags.length > 0 || untaggedFoodCount > 0) && (
              <div className="tag-options">
                <button type="button" className={`tag-choice${quickEntryTag === 'all' ? ' selected' : ''}`} onClick={() => setQuickEntryTag('all')}>全部</button>
                {untaggedFoodCount > 0 && (
                  <button
                    type="button"
                    className={`tag-choice tag-choice-untagged${quickEntryTag === UNTAGGED_TAG_ID ? ' selected' : ''}`}
                    onClick={() => setQuickEntryTag(UNTAGGED_TAG_ID)}
                  >
                    未分類（{untaggedFoodCount}）
                  </button>
                )}
                {tags.map((tag) => (
                  <button type="button" key={tag} className={`tag-choice${quickEntryTag === tag ? ' selected' : ''}`} onClick={() => setQuickEntryTag(tag)}>{tag}</button>
                ))}
              </div>
            )}
            <input value={foodQuery} onChange={(event) => setFoodQuery(event.target.value)} placeholder="搜尋名稱或別名" autoFocus />
            <div className="food-options">
              {quickFoods.length === 0 ? (
                <div className="empty">
                  <p>找不到食物。</p>
                  <button type="button" onClick={() => { setQuickEntryOpen(false); openFoodForm(null, 'quickEntry') }}>去食物庫新增</button>
                </div>
              ) : quickFoods.map((foodItem) => (
                <button type="button" className="food-option" key={foodItem.id} disabled={saving} onClick={() => logMeal(foodItem)}>
                  <span className="food-option-name">
                    <strong>{foodItem.name}</strong>
                    {(foodItem.brand || foodItem.flavor) && (
                      <small>{[foodItem.brand, foodItem.flavor].filter(Boolean).join(' · ')}</small>
                    )}
                  </span>
                  <span className="food-option-stats">
                    <small className="food-option-macro">{foodItem.perServing.kcal} kcal</small>
                    <small className="food-option-macro">{foodItem.perServing.proteinG} g 蛋白</small>
                    <small className="food-option-usage">{usageText(foodUsageOf(foodUsage, foodItem.id))}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      <section className="meal-list">
        {daily.meals.length === 0 ? <p className="empty">這天還沒有飲食紀錄</p> : daily.meals.map((meal) => (
          <button type="button" className="meal-row-compact" key={meal.mealLog.id} onClick={() => openMealEditor(meal.mealLog, meal.foodItem, meal.name)}>
            <time>{new Date(meal.mealLog.eatenAt).toLocaleTimeString('zh-TW', { hour: 'numeric', minute: '2-digit' })}</time>
            <span className="meal-name">
              {/* 份量要看得到，但不能搶走名稱的視線（owner 2026-08-19）：接在名稱後面的小字。
                  份量放在 <strong> 外面，長名稱被 ellipsis 截斷時份量才不會跟著被吃掉。 */}
              <span className="meal-name-row">
                <strong>{meal.name}</strong>
                <span className="meal-servings">{formatServings(meal.mealLog.servings)} 份</span>
              </span>
              {meal.foodItem && (meal.foodItem.brand || meal.foodItem.flavor) && (
                <small>{[meal.foodItem.brand, meal.foodItem.flavor].filter(Boolean).join(' · ')}</small>
              )}
            </span>
            <span className="meal-kcal">{meal.kcal} kcal</span>
            <span className="meal-protein">{meal.proteinG} g</span>
            <MonoIcon name="edit" className="icon-sm" />
          </button>
        ))}
      </section>
    </main>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)


