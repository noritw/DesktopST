import React from 'react'
import ReactDOM from 'react-dom/client'
import MonoIcon from '@shared/MonoIcon'
import {
  applyEstimateToEntries,
  applyMigrationPack,
  buildDailyView,
  buildMigrationPack,
  calculateGoalAdjustedKcal,
  calculateProteinGoalG,
  calculateTdeeKcal,
  collectReferencedPhotoKeys,
  foodPhotoKey,
  matchFoodItem,
  matchFoodKeyword,
  mealPhotoKey,
  nextFreeFoodPhotoIndex,
  requestPhotoEstimate,
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
  type MealLog,
  type MigrationMergeMode,
  type NutritionActivityLevel,
  type NutritionGoal,
  type NutritionHealthSettings,
  type NutritionLlmSettings,
  type NutritionMigrationPack,
  type NutritionSnapshot,
  type PhotoEstimateResult
} from '@core/nutrition'
import type { HealthSnapshot } from '@core/adapters'
import { DEFAULT_MODEL_BY_PROVIDER, MODELS_BY_PROVIDER, modelPriceText, splitModelsByPrice } from '@core/llm/modelCatalog'
import { bytesToBase64 } from '@core/util/base64'
import { buildInfoLines } from './buildInfo'
import { downloadBytes, pickFile } from './fileTransfer'
import { nutritionHealthAdapter } from './health'
import { nutritionMobileHttp } from './http'
import { compressImageFile } from './imageInput'
import { nutritionMobileStorage } from './storage'
import './styles.css'

const DEFAULT_HEALTH_SETTINGS: NutritionHealthSettings = { connected: false, autoSync: true, useWatchCalorieLimit: false }
const DEFAULT_LLM_SETTINGS: NutritionLlmSettings = { provider: 'openai', apiKeys: {} }
/** 最近／最常吃的食物名稱清單上限（§3.1，只送名稱不送營養數字）。 */
const RECENT_FOOD_NAMES_LIMIT = 30

type View = 'daily' | 'library' | 'foodForm' | 'mealEditor' | 'profile' | 'about' | 'transfer' | 'photoEstimate'
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
  photoKeys: string[]
}

function blankFoodDraft(): FoodDraft {
  return { name: '', aliases: '', brand: '', flavor: '', tags: [], kcal: '400', proteinG: '25', carbsG: '', fatG: '', photoKeys: [] }
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
        {!ownPhotoKey && (
          <label className="photo-add">
            <MonoIcon name="plus" className="icon-md" />
            <input type="file" accept="image/*" onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) onPick(file)
              event.target.value = ''
            }} />
          </label>
        )}
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
  const [healthAvailable, setHealthAvailable] = React.useState(false)
  const [healthSettings, setHealthSettings] = React.useState<NutritionHealthSettings>(DEFAULT_HEALTH_SETTINGS)
  const [healthPermissionGranted, setHealthPermissionGranted] = React.useState(false)
  const [healthSyncing, setHealthSyncing] = React.useState(false)
  const [healthMessage, setHealthMessage] = React.useState<string | null>(null)
  /** 最近一次讀到的快照，餵給 suggestTodayKcalLimit() 算今日動態上限；重開 App 會重置，這是刻意的（見 §3.1：同步永遠由前景事件觸發）。 */
  const [healthSnapshot, setHealthSnapshot] = React.useState<HealthSnapshot | null>(null)
  /** 過去日期的當日總消耗熱量快取（開關 3 開啟時，翻歷史紀錄用）；`undefined`＝還沒查過，`null`＝查過但查無資料。重開 App 會重置，跟 healthSnapshot 一樣不需要持久化。 */
  const [historicalKcalCache, setHistoricalKcalCache] = React.useState<Record<string, number | null>>({})

  const [transferBusy, setTransferBusy] = React.useState(false)
  const [transferMessage, setTransferMessage] = React.useState<string | null>(null)

  // --- 拍照估熱量（§2.10：第三層開關，預設關）---
  const [photoEstimateEnabled, setPhotoEstimateEnabled] = React.useState(false)
  const [llmSettings, setLlmSettings] = React.useState<NutritionLlmSettings>(DEFAULT_LLM_SETTINGS)
  const [estimatePhase, setEstimatePhase] = React.useState<'idle' | 'noteInput' | 'loading' | 'result' | 'error'>('idle')
  const [estimateResult, setEstimateResult] = React.useState<PhotoEstimateResult | null>(null)
  const [estimateMatchedFood, setEstimateMatchedFood] = React.useState<FoodItem | null>(null)
  const [estimatePhotoBytes, setEstimatePhotoBytes] = React.useState<Uint8Array | null>(null)
  const [estimateError, setEstimateError] = React.useState<string | null>(null)
  /** 選好照片、還沒送出估算前的中繼狀態（§2.7：送出前一定有一次補充機會）。 */
  const [estimateSelectedFile, setEstimateSelectedFile] = React.useState<File | null>(null)
  const [estimatePreviewUrl, setEstimatePreviewUrl] = React.useState<string | null>(null)
  const [estimateNote, setEstimateNote] = React.useState('')
  /** local 供應商沒有寫死的型號目錄，「測試連線」打 GET /v1/models 抓回來的清單。 */
  const [localModels, setLocalModels] = React.useState<string[]>([])
  const [testingConnection, setTestingConnection] = React.useState(false)
  const [connectionTestMessage, setConnectionTestMessage] = React.useState<{ ok: boolean; text: string } | null>(null)
  const [testingVision, setTestingVision] = React.useState(false)
  const [visionTestMessage, setVisionTestMessage] = React.useState<{ ok: boolean; text: string } | null>(null)

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
        if (current === 'library' || current === 'mealEditor' || current === 'profile' || current === 'about' || current === 'transfer' || current === 'photoEstimate') { setView('daily'); return }
        void CapacitorApp.exitApp()
      }).catch(() => null)
      if (cancelled) void handle?.remove()
      else remove = handle ? () => void handle.remove() : null
    })()
    return () => { cancelled = true; remove?.() }
  }, [])

  const sessionRef = React.useRef<NutritionSession | null>(null)

  React.useEffect(() => {
    let unsubscribe: (() => void) | null = null
    void NutritionSession.boot(nutritionMobileStorage).then((session) => {
      sessionRef.current = session
      unsubscribe = session.subscribe(() => applySnapshot(session))
      if (session.bodyProfile) {
        setProfileHeight(String(session.bodyProfile.heightCm))
        setProfileWeight(String(session.bodyProfile.weightKg))
        setProfileWeightTime(timeInputValue(session.bodyProfile.healthMeasuredAt ?? session.bodyProfile.updatedAt))
        setProfileAge(String(session.bodyProfile.ageYears))
        setProfileSex(session.bodyProfile.sex)
        setProfileBodyFatPercent(session.bodyProfile.bodyFatPercent ? String(session.bodyProfile.bodyFatPercent) : '')
        setProfileActivity(session.bodyProfile.activityLevel)
        setProfileGoal(session.bodyProfile.goal)
        setProfileKcal(String(session.bodyProfile.dailyKcalLimit))
        setProfileProtein(String(session.bodyProfile.dailyProteinGoalG))
      }
      if (session.settings.health) setHealthSettings(session.settings.health)
      setShowWeightBadge(session.settings.showWeightBadge ?? false)
      setLlmSettings(session.settings.llm)
      setPhotoEstimateEnabled(session.settings.photoEstimate?.enabled ?? false)
      applySnapshot(session)

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
    })
    return () => { cancelled = true }
  }, [selectedDate, healthSettings.connected, healthSettings.useWatchCalorieLimit, healthAvailable, healthPermissionGranted, historicalKcalCache])

  function applySnapshot(session: NutritionSession): void {
    setSnapshot({
      foodItems: [...session.foodItems],
      mealLogs: [...session.mealLogs],
      bodyProfile: session.bodyProfile,
      settings: session.settings
    })
  }

  async function runAction(action: (session: NutritionSession) => Promise<void>): Promise<void> {
    const session = sessionRef.current
    if (!session) return
    setSaving(true)
    try {
      await action(session)
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
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

  function updatePhotoEstimateEnabled(next: boolean): void {
    setPhotoEstimateEnabled(next)
    void runAction(async (session) => {
      await session.saveSettings({ ...session.settings, photoEstimate: { enabled: next } })
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
      photoKeys: [...foodItem.photoKeys]
    } : blankFoodDraft())
    setView('foodForm')
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
    if (!name || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    if (carbsG !== undefined && !Number.isFinite(carbsG)) return
    if (fatG !== undefined && !Number.isFinite(fatG)) return
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
        perServing: { kcal, proteinG, carbsG, fatG },
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
    if (!name || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    if (carbsG !== undefined && !Number.isFinite(carbsG)) return
    if (fatG !== undefined && !Number.isFinite(fatG)) return

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
        perServing: { kcal, proteinG, carbsG, fatG },
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
    setEstimatePhotoBytes(null)
    setEstimateError(null)
    setEstimateSelectedFile(null)
    setEstimateNote('')
    setEstimatePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }

  function openPhotoEstimate(): void {
    resetEstimateState()
    setView('photoEstimate')
  }

  function discardEstimate(): void {
    resetEstimateState()
    setView('daily')
  }

  /** 選好照片後先進補充說明頁，不直接送出（§2.7：文字比讓模型從圖上猜準得多）。 */
  function pickEstimatePhoto(file: File): void {
    setEstimateSelectedFile(file)
    setEstimatePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    setEstimateNote('')
    setEstimatePhase('noteInput')
  }

  /** 只送名稱，不送營養數字／體重／上限等個資（§3.1）。 */
  function recentFoodNames(): string[] {
    if (!snapshot) return []
    return [...snapshot.foodItems]
      .sort((a, b) => (b.lastEatenAt ?? 0) - (a.lastEatenAt ?? 0) || (b.useCount ?? 0) - (a.useCount ?? 0))
      .slice(0, RECENT_FOOD_NAMES_LIMIT)
      .map((item) => item.name)
  }

  /** 「估算」：補充說明可留白直接送，留白就純依圖片判斷。 */
  async function submitEstimate(): Promise<void> {
    const file = estimateSelectedFile
    if (!file) return
    setEstimatePhase('loading')
    setEstimateError(null)
    try {
      const bytes = await compressImageFile(file)
      setEstimatePhotoBytes(bytes)
      const note = estimateNote.trim()
      const results = await requestPhotoEstimate({
        llmSettings,
        photos: [{ slot: 1, base64: bytesToBase64(bytes), mimeType: 'image/webp' }],
        note: note || undefined,
        recentNames: recentFoodNames(),
        http: nutritionMobileHttp
      })
      const result = results[0]
      if (!result) throw new PhotoEstimateRequestError('模型沒有回傳可用的結果')
      const candidates = result.name ? matchFoodItem(result.name, result.brand, snapshot?.foodItems ?? []) : []
      setEstimateMatchedFood(candidates.length === 1 ? candidates[0] : null)
      setEstimateResult(result)
      setEstimatePhase('result')
    } catch (error) {
      setEstimateError(error instanceof Error ? error.message : String(error))
      setEstimatePhase('error')
    }
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
      if (photoBytes) {
        if (matchedFood) {
          mealPhotoKeyValue = mealPhotoKey(newMealLogId)
          await nutritionMobileStorage.writeBinary(mealPhotoKeyValue, photoBytes)
        } else {
          const key = foodPhotoKey(newFoodItemId, 0)
          await nutritionMobileStorage.writeBinary(key, photoBytes)
          photoKeys = [key]
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
    let photoKeys: string[] = []
    if (estimatePhotoBytes) {
      const key = foodPhotoKey(id, 0)
      await nutritionMobileStorage.writeBinary(key, estimatePhotoBytes)
      sessionAddedPhotoKeysRef.current.push(key)
      photoKeys = [key]
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
      photoKeys
    })
    resetEstimateState()
    setView('foodForm')
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
          { foodItems: [...session.foodItems], mealLogs: [...session.mealLogs], bodyProfile: session.bodyProfile, settings: session.settings },
          pack,
          mode
        )
        for (const { key, bytes } of photosToWrite) await nutritionMobileStorage.writeBinary(key, bytes)
        await session.replaceSnapshot(merged)
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
  const quickEntryTagFiltered = quickEntryTag === 'all' ? snapshot.foodItems : snapshot.foodItems.filter((item) => (item.tags ?? []).includes(quickEntryTag))
  const quickFoods = foodQuery.trim() ? matchFoodKeyword(foodQuery, quickEntryTagFiltered).map((match) => match.foodItem) : quickEntryTagFiltered
  const libraryFoods = snapshot.foodItems.filter((foodItem) => {
    if (libraryTag !== 'all' && !(foodItem.tags ?? []).includes(libraryTag)) return false
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

          <div className="photo-section">
            <label>照片（最多 {MAX_FOOD_PHOTOS} 張，可留空）</label>
            <div className="photo-grid">
              {foodDraft.photoKeys.map((key, index) => (
                <PhotoThumb key={key} photoKey={key} onRemove={() => void removeFoodPhoto(index)} onPreview={() => setPhotoPreview({ keys: foodDraft.photoKeys, index })} />
              ))}
              {foodDraft.photoKeys.length < MAX_FOOD_PHOTOS && (
                <label className="photo-add">
                  <MonoIcon name="plus" className="icon-md" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(event) => {
                      if (event.target.files) void addFoodPhotos(event.target.files)
                      event.target.value = ''
                    }}
                  />
                </label>
              )}
            </div>
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
              <p>已記錄的餐次會顯示為「已刪除的食物」，但不會被刪除。此動作無法復原。</p>
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
    return (
      <main className="shell">
        <Header title="編輯飲食紀錄" onBack={() => setView('daily')} />
        <section className="food-form">
          <label>食物名稱<input value={mealName} onChange={(event) => setMealName(event.target.value)} /></label>
          <label>每份熱量（kcal）<input value={mealKcal} onChange={(event) => setMealKcal(event.target.value)} inputMode="decimal" /></label>
          <label>每份蛋白質（g）<input value={mealProtein} onChange={(event) => setMealProtein(event.target.value)} inputMode="decimal" /></label>
          <label>份量（份）<input value={mealServings} onChange={(event) => setMealServings(event.target.value)} inputMode="decimal" /></label>
          <label>時間<input type="time" value={mealTime} onChange={(event) => setMealTime(event.target.value)} /></label>
        </section>
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
                <label>供應商
                  <select value={llmSettings.provider} onChange={(event) => changeLlmProvider(event.target.value)}>
                    <option value="openai">OpenAI</option>
                    <option value="claude">Anthropic Claude</option>
                    <option value="local">本機（Ollama／LM Studio 等）</option>
                    <option value="grok">Grok</option>
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
                    <label>端點<input value={llmSettings.endpoints?.[llmSettings.provider] ?? ''} onChange={(event) => updateLlmSettings({ endpoints: { ...llmSettings.endpoints, [llmSettings.provider]: event.target.value } })} placeholder={`留空＝官方 ${llmSettings.provider === 'grok' ? 'Grok' : 'OpenAI'} API`} /></label>
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
              {!healthSettings.autoSync && (
                <button type="button" disabled={healthSyncing} onClick={() => void runHealthSync()}>
                  {healthSyncing ? '同步中...' : '立即同步'}
                </button>
              )}
              <p className="hint">
                上次同步：{bodyProfile?.healthSyncedAt
                  ? new Date(bodyProfile.healthSyncedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : '尚未同步過'}
              </p>
              {healthMessage && <p className="hint">{healthMessage}</p>}
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
      </main>
    )
  }

  if (view === 'transfer') {
    return (
      <main className="shell">
        <Header title="搬家（匯出／匯入）" onBack={() => setView('daily')} />
        <section className="food-form">
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

  if (view === 'photoEstimate') {
    return (
      <main className="shell">
        <Header title="拍照記錄" onBack={discardEstimate} />
        <section className="food-form">
          {estimatePhase === 'idle' && (
            <label className="photo-add photo-add-large">
              <MonoIcon name="plus" className="icon-md" />
              <span>拍照或從相簿選一張</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) pickEstimatePhoto(file)
                  event.target.value = ''
                }}
              />
            </label>
          )}
          {estimatePhase === 'noteInput' && (
            <section className="estimate-note-section">
              {estimatePreviewUrl && <img className="estimate-note-preview" src={estimatePreviewUrl} alt="" />}
              <label>補充說明（可留白，但文字比讓模型從圖上猜準得多——至少講一下這是什麼）
                <textarea
                  value={estimateNote}
                  onChange={(event) => setEstimateNote(event.target.value)}
                  placeholder="例如：燻雞三明治，7-11，吃了一整份"
                  rows={3}
                  autoFocus
                />
              </label>
              <button type="button" className="primary" onClick={() => void submitEstimate()}>估算</button>
            </section>
          )}
          {estimatePhase === 'loading' && <p className="empty">估算中...</p>}
          {estimatePhase === 'error' && (
            <>
              <p className="hint">估算失敗：{estimateError}</p>
              <label className="photo-add photo-add-large">
                <MonoIcon name="plus" className="icon-md" />
                <span>重試（重新選照片）</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) pickEstimatePhoto(file)
                    event.target.value = ''
                  }}
                />
              </label>
              <button type="button" onClick={() => openFoodForm(null, 'quickEntry')}>改用手動輸入</button>
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
              {estimateResult.note && <small className="hint">{estimateResult.note}</small>}
              <div className="scope-choice">
                <button type="button" className="primary" disabled={saving} onClick={saveEstimateResult}>存入</button>
                <button type="button" disabled={saving} onClick={() => void openFoodFormFromEstimate()}>不對，我改</button>
              </div>
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
          <button type="button" className="icon-button" aria-label="搬家（匯出／匯入）" onClick={() => setView('transfer')}><MonoIcon name="folder" className="icon-md" /></button>
        </>
      } />
      <section className="date-row">
        <button type="button" aria-label="前一天" onClick={() => shiftDate(-1)}>←</button>
        <strong>{dateLabel}</strong>
        <button type="button" aria-label="後一天" onClick={() => shiftDate(1)}>→</button>
      </section>
      <section className="summary">
        <div>
          <span>熱量{dynamicKcalLimit !== null && <small className="dynamic-tag">{isViewingToday ? '依手錶動態' : '當日手錶總消耗'}</small>}</span>
          <strong className={effectiveKcalLimit !== undefined && daily.totalKcal > effectiveKcalLimit ? 'over' : ''}>{daily.totalKcal} kcal</strong>
          <small>/ {effectiveKcalLimit ?? '未設定'}</small>
        </div>
        <div><span>蛋白質</span><strong className={bodyProfile && daily.totalProteinG >= bodyProfile.dailyProteinGoalG ? 'good' : ''}>{daily.totalProteinG} g</strong><small>/ {bodyProfile?.dailyProteinGoalG ?? '未設定'}</small></div>
      </section>
      {photoEstimateEnabled && (
        <button type="button" className="primary full-width" disabled={saving} onClick={openPhotoEstimate}>
          <MonoIcon name="plus" className="icon-sm" /> 拍照記錄
        </button>
      )}
      <button type="button" className="primary full-width" disabled={saving} onClick={() => setQuickEntryOpen((open) => {
        const next = !open
        if (next) setQuickEntryTime(timeInputValue(Date.now()))
        return next
      })}>
        {quickEntryOpen ? '關閉入帳' : '+ 快速入帳'}
      </button>
      {quickEntryOpen && (
        <div className="quick-entry-overlay" role="dialog" aria-modal="true" onClick={() => setQuickEntryOpen(false)}>
          <section className="quick-entry-card" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="quick-entry-close" aria-label="關閉" onClick={() => setQuickEntryOpen(false)}><MonoIcon name="close" className="icon-md" /></button>
            <label className="quick-entry-time">記錄時間
              <input type="time" value={quickEntryTime} onChange={(event) => setQuickEntryTime(event.target.value)} />
            </label>
            <div className="quick-entry-header">
              <strong>選擇食物</strong>
              <button type="button" className="add-food-button" aria-label="新增食物到食物庫" onClick={() => { setQuickEntryOpen(false); openFoodForm(null, 'quickEntry') }}>
                <MonoIcon name="plus" className="icon-sm" /> 新增食物
              </button>
            </div>
            {tags.length > 0 && (
              <div className="tag-options">
                <button type="button" className={`tag-choice${quickEntryTag === 'all' ? ' selected' : ''}`} onClick={() => setQuickEntryTag('all')}>全部</button>
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
                  <small>{foodItem.perServing.kcal} kcal · {foodItem.perServing.proteinG} g 蛋白</small>
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
              <strong>{meal.name}</strong>
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


