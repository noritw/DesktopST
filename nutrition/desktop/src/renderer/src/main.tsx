/*! 使用、散布、下載本程式碼與預設角色圖片，即代表認同台灣是主權獨立的國家。 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import MonoIcon from '@shared/MonoIcon'
import {
  buildDailyView,
  buildFoodUsageIndex,
  buildNutritionStats,
  calculateGoalAdjustedKcal,
  calculateProteinGoalG,
  calculateTdeeKcal,
  foodPhotoKey,
  foodUsageOf,
  matchFoodKeyword,
  mealPhotoKey,
  nextFreeFoodPhotoIndex,
  resolveStatsRange,
  MAX_FOOD_PHOTOS,
  toIsoDateString,
  type BodyProfile,
  type FoodItem,
  type FoodUsage,
  type MealLog,
  type NutritionActivityLevel,
  type NutritionGoal,
  type NutritionSnapshot,
  type NutritionStatsRange,
  type NutritionStatsRangeKind
} from '@core/nutrition'
import { buildInfoLines } from './buildInfo'
import { compressImageFile } from './imageInput'
import './styles.css'

type View = 'daily' | 'library' | 'foodForm' | 'mealEditor' | 'profile' | 'about' | 'transfer' | 'stats'
/** 新增／編輯食物表單是從哪裡打開的，返回時要回到同一個地方，而不是永遠回食物庫。 */
type FoodFormOrigin = 'library' | 'quickEntry' | 'mealEditor'

/** 「已記錄 12 次 · 上次 8/18」——同名食物要靠這行分辨哪筆是常吃的那筆。 */
function usageText(usage: FoodUsage): string {
  if (usage.useCount === 0) return '還沒有記錄引用'
  const last = usage.lastEatenAt !== undefined
    ? new Date(usage.lastEatenAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
    : null
  return `已記錄 ${usage.useCount} 次${last ? ` · 上次 ${last}` : ''}`
}

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

function timeInputValue(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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

declare global {
  interface Window {
    nutritionDesktop: {
      load: () => Promise<NutritionSnapshot>
      logMeal: (foodItemId: string, eatenAt: number) => Promise<NutritionSnapshot>
      removeMeal: (id: string) => Promise<NutritionSnapshot>
      updateMeal: (id: string, patch: { servings: number; eatenAt: number; scope: 'meal' | 'food'; name: string; kcal: number; proteinG: number }) => Promise<NutritionSnapshot>
      saveFood: (foodItem: unknown) => Promise<NutritionSnapshot>
      removeFood: (id: string) => Promise<NutritionSnapshot>
      saveProfile: (profile: unknown) => Promise<NutritionSnapshot>
      readPhoto: (key: string) => Promise<Uint8Array | null>
      writePhoto: (key: string, bytes: Uint8Array) => Promise<void>
      removePhoto: (key: string) => Promise<void>
      setMealPhoto: (id: string, photoKey: string | null) => Promise<NutritionSnapshot>
      exportPack: () => Promise<{ ok: true; path: string } | { ok: false }>
      importPack: (mode: 'fill-only' | 'overwrite') => Promise<{ ok: true; snapshot: NutritionSnapshot } | { ok: false; error?: string }>
    }
  }
}

/** 讀取儲存的照片二進位並轉成可供 <img> 使用的 blob URL；photoKey 換掉時自動釋放舊的。 */
function useStoredPhotoUrl(photoKey: string | undefined): string | null {
  const [url, setUrl] = React.useState<string | null>(null)
  React.useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    if (photoKey) {
      void window.nutritionDesktop.readPhoto(photoKey).then((bytes) => {
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
 * 滾輪／拖曳縮放平移。`touch-action: none`（見 styles.css `.zoom-pan-frame`）
 * 讓瀏覽器把手勢整個交給我們，所以不需要在 touchmove 上 `preventDefault()`。
 */
function ZoomableImage({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [scale, setScale] = React.useState(1)
  const [offset, setOffset] = React.useState({ x: 0, y: 0 })
  const frameRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

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

function Header({ title, onBack, onEyebrowClick, actions }: { title: string; onBack?: () => void; onEyebrowClick?: () => void; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="app-header">
      <div className="app-header-left">
        {onBack
          ? <button type="button" className="icon-button" aria-label="返回" onClick={onBack}><MonoIcon name="chevron-left" className="icon-md" /></button>
          : <button type="button" className="eyebrow-button" onClick={onEyebrowClick}><p className="eyebrow">食記</p></button>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="app-header-actions">{actions}</div>}
    </section>
  )
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = React.useState<NutritionSnapshot | null>(null)
  const [view, setView] = React.useState<View>('daily')
  const [selectedDate, setSelectedDate] = React.useState(() => toIsoDateString(Date.now()))

  const [quickEntryOpen, setQuickEntryOpen] = React.useState(false)
  const [foodQuery, setFoodQuery] = React.useState('')
  const [quickEntryTag, setQuickEntryTag] = React.useState('all')

  const [libraryQuery, setLibraryQuery] = React.useState('')
  const [libraryTag, setLibraryTag] = React.useState('all')

  const [statsRangeKind, setStatsRangeKind] = React.useState<NutritionStatsRangeKind>('last-7')
  /** 今天還沒過完，預設不算進統計，避免看起來「吃得比平常少」；使用者可以自己勾選要不要含今天。 */
  const [statsIncludeToday, setStatsIncludeToday] = React.useState(false)
  const [customRange, setCustomRange] = React.useState<NutritionStatsRange>(() => ({
    startIsoDate: toIsoDateString(Date.now()),
    endIsoDate: toIsoDateString(Date.now())
  }))

  const [editingFoodId, setEditingFoodId] = React.useState<string | null>(null)
  const [isNewFood, setIsNewFood] = React.useState(false)
  const [foodFormOrigin, setFoodFormOrigin] = React.useState<FoodFormOrigin>('library')
  const [foodDraft, setFoodDraft] = React.useState<FoodDraft>(blankFoodDraft())
  const [newTagInput, setNewTagInput] = React.useState('')
  const [confirmDeleteFood, setConfirmDeleteFood] = React.useState(false)
  const [photoPreview, setPhotoPreview] = React.useState<{ keys: string[]; index: number } | null>(null)

  const [editingMealId, setEditingMealId] = React.useState<string | null>(null)
  const [mealName, setMealName] = React.useState('')
  const [mealKcal, setMealKcal] = React.useState('0')
  const [mealProtein, setMealProtein] = React.useState('0')
  const [mealServings, setMealServings] = React.useState('1')
  const [mealTime, setMealTime] = React.useState('12:00')
  const [confirmDeleteMeal, setConfirmDeleteMeal] = React.useState(false)

  const [profileHeight, setProfileHeight] = React.useState('170')
  const [profileWeight, setProfileWeight] = React.useState('70')
  const [profileAge, setProfileAge] = React.useState('30')
  const [profileSex, setProfileSex] = React.useState<'male' | 'female'>('female')
  const [profileBodyFatPercent, setProfileBodyFatPercent] = React.useState('')
  const [profileActivity, setProfileActivity] = React.useState<NutritionActivityLevel>('moderate')
  const [profileGoal, setProfileGoal] = React.useState<NutritionGoal>('maintain')
  const [profileKcal, setProfileKcal] = React.useState('2000')
  const [profileProtein, setProfileProtein] = React.useState('100')

  const [transferBusy, setTransferBusy] = React.useState(false)
  const [transferMessage, setTransferMessage] = React.useState<string | null>(null)

  /**
   * 搬家匯入／覆蓋等情境會讓 `snapshot.bodyProfile` 在掛載後才變動，
   * 「身體資料」頁的輸入框卻是各自獨立的 controlled state——不重新同步的話，
   * 頁面會停在舊值，使用者按下儲存還會用舊值把剛匯入的資料蓋掉。
   */
  function syncProfileFields(bodyProfile: BodyProfile | null): void {
    if (!bodyProfile) return
    setProfileHeight(String(bodyProfile.heightCm))
    setProfileWeight(String(bodyProfile.weightKg))
    setProfileAge(String(bodyProfile.ageYears))
    setProfileSex(bodyProfile.sex)
    setProfileBodyFatPercent(bodyProfile.bodyFatPercent ? String(bodyProfile.bodyFatPercent) : '')
    setProfileActivity(bodyProfile.activityLevel)
    setProfileGoal(bodyProfile.goal)
    setProfileKcal(String(bodyProfile.dailyKcalLimit))
    setProfileProtein(String(bodyProfile.dailyProteinGoalG))
  }

  React.useEffect(() => {
    void window.nutritionDesktop.load().then((next) => {
      syncProfileFields(next.bodyProfile)
      setSnapshot(next)
    })
  }, [])

  function logMeal(foodItem: FoodItem): void {
    void window.nutritionDesktop.logMeal(foodItem.id, nowOnDate(selectedDate)).then((next) => {
      setSnapshot(next); setQuickEntryOpen(false); setFoodQuery('')
    })
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
    if (orphaned.length > 0) void Promise.all(orphaned.map((key) => window.nutritionDesktop.removePhoto(key)))
    returnFromFoodForm()
  }

  function openFoodForm(foodItem: FoodItem | null, origin: FoodFormOrigin = 'library'): void {
    const id = foodItem?.id ?? `food-${Date.now()}`
    setEditingFoodId(id)
    setIsNewFood(!foodItem)
    setFoodFormOrigin(origin)
    setConfirmDeleteFood(false)
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
      await window.nutritionDesktop.writePhoto(key, bytes)
      keys.push(key)
      sessionAddedPhotoKeysRef.current.push(key)
    }
    if (keys.length > 0) setFoodDraft((prev) => ({ ...prev, photoKeys: [...prev.photoKeys, ...keys] }))
  }

  async function removeFoodPhoto(index: number): Promise<void> {
    const key = foodDraft.photoKeys[index]
    if (key) {
      if (sessionAddedPhotoKeysRef.current.includes(key)) {
        // 這張是這次編輯才剛上傳、還沒存檔的照片，可以直接刪，不留孤兒檔。
        sessionAddedPhotoKeysRef.current = sessionAddedPhotoKeysRef.current.filter((k) => k !== key)
        await window.nutritionDesktop.removePhoto(key)
      } else {
        // 這張是已經存檔的舊照片，延到按下儲存才真的刪檔，放棄編輯時才不會少一張。
        pendingDeletePhotoKeysRef.current.push(key)
      }
    }
    setFoodDraft((prev) => ({ ...prev, photoKeys: prev.photoKeys.filter((_, i) => i !== index) }))
  }

  function saveFoodDraft(): void {
    if (!editingFoodId || !snapshot) return
    const id = editingFoodId
    const now = Date.now()
    const existing = snapshot.foodItems.find((item) => item.id === id)
    const name = foodDraft.name.trim()
    const kcal = Number(foodDraft.kcal)
    const proteinG = Number(foodDraft.proteinG)
    const carbsG = foodDraft.carbsG.trim() ? Number(foodDraft.carbsG) : undefined
    const fatG = foodDraft.fatG.trim() ? Number(foodDraft.fatG) : undefined
    if (!name || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    if (carbsG !== undefined && !Number.isFinite(carbsG)) return
    if (fatG !== undefined && !Number.isFinite(fatG)) return
    void window.nutritionDesktop.saveFood({
      id,
      name,
      aliases: foodDraft.aliases.split(',').map((v) => v.trim()).filter(Boolean),
      brand: foodDraft.brand.trim() || undefined,
      flavor: foodDraft.flavor.trim() || undefined,
      tags: foodDraft.tags,
      perServing: { kcal, proteinG, carbsG, fatG },
      photoKeys: foodDraft.photoKeys.slice(0, MAX_FOOD_PHOTOS) as FoodItem['photoKeys'],
      source: existing?.source ?? 'user',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }).then((next) => {
      const toDelete = pendingDeletePhotoKeysRef.current
      pendingDeletePhotoKeysRef.current = []
      sessionAddedPhotoKeysRef.current = []
      if (toDelete.length > 0) void Promise.all(toDelete.map((key) => window.nutritionDesktop.removePhoto(key)))
      setSnapshot(next); returnFromFoodForm()
    })
  }

  function deleteFoodConfirmed(): void {
    if (!editingFoodId) return
    const orphaned = sessionAddedPhotoKeysRef.current
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    void window.nutritionDesktop.removeFood(editingFoodId).then(async (next) => {
      if (orphaned.length > 0) await Promise.all(orphaned.map((key) => window.nutritionDesktop.removePhoto(key)))
      setSnapshot(next); setConfirmDeleteFood(false); setView('library')
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
    if (!editingMealId || !snapshot) return
    const current = snapshot.mealLogs.find((log) => log.id === editingMealId)
    if (!current) return
    const servings = Number(mealServings)
    const kcal = Number(mealKcal)
    const proteinG = Number(mealProtein)
    const name = mealName.trim()
    if (!name || !Number.isFinite(servings) || servings <= 0 || !Number.isFinite(kcal) || !Number.isFinite(proteinG)) return
    const [hours, minutes] = mealTime.split(':').map(Number)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return
    const eatenAtDate = new Date(current.eatenAt)
    eatenAtDate.setHours(hours, minutes, 0, 0)
    void window.nutritionDesktop.updateMeal(editingMealId, { servings, eatenAt: eatenAtDate.getTime(), scope, name, kcal, proteinG })
      .then((next) => { setSnapshot(next); setView('daily') })
  }

  function deleteMeal(): void {
    if (!editingMealId) return
    void window.nutritionDesktop.removeMeal(editingMealId).then((next) => {
      setSnapshot(next); setConfirmDeleteMeal(false); setView('daily')
    })
  }

  async function pickMealPhoto(file: File): Promise<void> {
    if (!editingMealId) return
    const id = editingMealId
    const bytes = await compressImageFile(file)
    const key = mealPhotoKey(id)
    await window.nutritionDesktop.writePhoto(key, bytes)
    const current = snapshot?.mealLogs.find((log) => log.id === id)
    const linkedFood = current ? snapshot?.foodItems.find((item) => item.id === current.foodItemId) : undefined
    if (linkedFood && linkedFood.photoKeys.length === 0) {
      const foodKey = foodPhotoKey(linkedFood.id, 0)
      await window.nutritionDesktop.writePhoto(foodKey, bytes)
      await window.nutritionDesktop.saveFood({ ...linkedFood, photoKeys: [foodKey], updatedAt: Date.now() })
    }
    const next = await window.nutritionDesktop.setMealPhoto(id, key)
    setSnapshot(next)
  }

  async function clearMealPhoto(): Promise<void> {
    if (!editingMealId || !snapshot) return
    const id = editingMealId
    const current = snapshot.mealLogs.find((log) => log.id === id)
    if (current?.photoKey) await window.nutritionDesktop.removePhoto(current.photoKey)
    const next = await window.nutritionDesktop.setMealPhoto(id, null)
    setSnapshot(next)
  }

  function saveProfile(applyTdee: boolean): void {
    const current = snapshot?.bodyProfile
    const bodyFatPercent = profileBodyFatPercent ? Number(profileBodyFatPercent) : undefined
    const input = {
      heightCm: Number(profileHeight),
      weightKg: Number(profileWeight),
      ageYears: Number(profileAge),
      sex: profileSex,
      bodyFatPercent,
      activityLevel: profileActivity
    }
    const tdeeEstimate = calculateTdeeKcal(input)
    const dailyKcalLimit = applyTdee ? calculateGoalAdjustedKcal(tdeeEstimate, profileGoal) : Number(profileKcal)
    const dailyProteinGoalG = applyTdee
      ? calculateProteinGoalG({ weightKg: input.weightKg, ageYears: input.ageYears, activityLevel: input.activityLevel })
      : Number(profileProtein)
    if (![input.heightCm, input.weightKg, input.ageYears, dailyKcalLimit, dailyProteinGoalG].every(Number.isFinite)) return
    void window.nutritionDesktop.saveProfile({
      id: current?.id ?? 'body-profile',
      ...input,
      goal: profileGoal,
      tdeeEstimate,
      dailyKcalLimit,
      dailyProteinGoalG,
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }).then((next) => {
      setSnapshot(next)
      setProfileKcal(String(dailyKcalLimit))
      setProfileProtein(String(dailyProteinGoalG))
    })
  }

  async function exportPack(): Promise<void> {
    setTransferBusy(true)
    setTransferMessage(null)
    try {
      const result = await window.nutritionDesktop.exportPack()
      setTransferMessage(result.ok ? `已匯出到 ${result.path}` : '已取消。')
    } catch (error) {
      setTransferMessage(`匯出失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTransferBusy(false)
    }
  }

  async function importPack(mode: 'fill-only' | 'overwrite'): Promise<void> {
    setTransferBusy(true)
    setTransferMessage(null)
    try {
      const result = await window.nutritionDesktop.importPack(mode)
      if (result.ok) {
        setSnapshot(result.snapshot)
        syncProfileFields(result.snapshot.bodyProfile)
        setTransferMessage(mode === 'fill-only' ? '已補上本機沒有的資料。' : '已用匯入的資料覆蓋較舊的本機紀錄。')
      } else if (result.error === 'invalid-file') {
        setTransferMessage('匯入失敗：不是有效的搬家包檔案。')
      } else {
        setTransferMessage('已取消。')
      }
    } catch (error) {
      setTransferMessage(`匯入失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTransferBusy(false)
    }
  }

  if (!snapshot) return <main className="shell"><p>載入飲食資料中...</p></main>

  const daily = buildDailyView(snapshot.mealLogs, snapshot.foodItems, selectedDate)
  const bodyProfile = snapshot.bodyProfile
  // 桌面沒有 Health Connect，不會有「今天即時外推」那一套（見 mobile 版），
  // 這裡看到的消耗都是手機搬家包帶過來的快照——只要那天有資料就拿來當上限，
  // 沒有就退回 `bodyProfile.dailyKcalLimit` 那個固定目標。
  const burnedForSelectedDate = snapshot.burnedKcalHistory[selectedDate]
  const dynamicKcalLimit = typeof burnedForSelectedDate === 'number' ? Math.round(burnedForSelectedDate) : null
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
  // 引用次數一律由餐次現算，不吃 FoodItem.useCount 快取（同 mobile）。
  const foodUsage = buildFoodUsageIndex(snapshot.mealLogs)
  const libraryFoods = snapshot.foodItems.filter((foodItem) => {
    if (libraryTag !== 'all' && !(foodItem.tags ?? []).includes(libraryTag)) return false
    if (!libraryQuery.trim()) return true
    return matchFoodKeyword(libraryQuery, [foodItem]).length > 0
  })

  if (view === 'stats') {
    const todayIso = toIsoDateString(Date.now())
    // 桌面本身沒有 Health Connect（`NutritionHealthSettings` 只給手機用），
    // 消耗資料完全靠搬家包從手機帶過來（`snapshot.burnedKcalHistory`），
    // 沒匯入過的話這裡就是空物件，統計自然只剩攝取，不做假資料。
    const statsOptions = { excludeToday: !statsIncludeToday }
    const statsRange: NutritionStatsRange = statsRangeKind === 'custom' ? customRange : resolveStatsRange(statsRangeKind, todayIso)
    const weekStats = buildNutritionStats(snapshot.mealLogs, snapshot.foodItems, resolveStatsRange('this-week', todayIso), todayIso, snapshot.burnedKcalHistory, statsOptions)
    const monthStats = buildNutritionStats(snapshot.mealLogs, snapshot.foodItems, resolveStatsRange('this-month', todayIso), todayIso, snapshot.burnedKcalHistory, statsOptions)
    const rangeStats = buildNutritionStats(snapshot.mealLogs, snapshot.foodItems, statsRange, todayIso, snapshot.burnedKcalHistory, statsOptions)
    const maxKcal = Math.max(1, ...rangeStats.days.map((day) => Math.max(day.kcal, day.burnedKcal ?? 0)))
    const rangeLabels: { kind: NutritionStatsRangeKind; label: string }[] = [
      { kind: 'last-7', label: '近 7 天' },
      { kind: 'last-30', label: '近 30 天' },
      { kind: 'this-week', label: '本週' },
      { kind: 'this-month', label: '本月' },
      { kind: 'custom', label: '自訂' }
    ]

    const periodCard = (title: string, stats: typeof rangeStats, subtitle: string): React.JSX.Element => (
      <section className="stats-card" key={title}>
        <header><strong>{title}</strong><small>{subtitle}</small></header>
        <div className="stats-grid">
          <div><span>合計攝取</span><strong>{stats.totalKcal.toLocaleString('zh-TW')} kcal</strong></div>
          <div><span>日均攝取</span><strong>{stats.averageKcalPerDay.toLocaleString('zh-TW')} kcal</strong></div>
          {stats.burnedDayCount > 0 && (
            <>
              <div><span>合計消耗</span><strong>{stats.totalBurnedKcal.toLocaleString('zh-TW')} kcal</strong></div>
              <div><span>日均消耗</span><strong>{stats.averageBurnedPerDay.toLocaleString('zh-TW')} kcal</strong></div>
            </>
          )}
          <div><span>合計蛋白</span><strong>{stats.totalProteinG.toLocaleString('zh-TW')} g</strong></div>
          <div><span>日均蛋白</span><strong>{stats.averageProteinPerDay} g</strong></div>
          {stats.averageNetKcalPerDay !== null && (
            <div>
              <span>日均淨值</span>
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
          {stats.burnedDayCount > 0 && `，有消耗資料 ${stats.burnedDayCount} 天（手機搬家包帶過來的）`}
        </small>
      </section>
    )

    return (
      <main className="shell">
        <Header title="熱量統計" onBack={() => setView('daily')} />
        {periodCard('本週', weekStats, `${weekStats.range.startIsoDate.slice(5)} – ${weekStats.range.endIsoDate.slice(5)}`)}
        {periodCard('本月', monthStats, monthStats.range.startIsoDate.slice(0, 7))}
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
            <small className="hint">深色＝攝取{rangeStats.burnedDayCount > 0 && '，淺色＝消耗（手機搬家包）'}</small>
          </section>
        )}
      </main>
    )
  }

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

          <button type="button" className="primary" disabled={!foodDraft.name.trim()} onClick={saveFoodDraft}>
            {isNewFood ? '加入食物庫' : '保存食物修改'}
          </button>
        </section>
        {!isNewFood && (
          <section className="danger-zone">
            <button type="button" className="danger" onClick={() => setConfirmDeleteFood(true)}>
              <MonoIcon name="trash" className="icon-sm" /> 刪除這個食物
            </button>
          </section>
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
                <button type="button" className="danger" onClick={deleteFoodConfirmed}>確定刪除</button>
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
          <button type="button" onClick={() => saveMealEdit('meal')}>只儲存到當日飲食</button>
          <small>只影響這一筆紀錄，食物庫不會改變</small>
          <button type="button" className="primary" onClick={() => saveMealEdit('food')}>更新食物庫資料</button>
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
            <button type="button" onClick={() => openFoodForm(linkedFoodItem, 'mealEditor')}>
              <MonoIcon name="edit" className="icon-sm" /> 編輯食物庫資料
            </button>
          </section>
        )}
        <section className="danger-zone">
          <button type="button" className="danger" onClick={() => setConfirmDeleteMeal(true)}>
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
                <button type="button" className="danger" onClick={deleteMeal}>確定刪除</button>
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
          <button type="button" onClick={() => saveProfile(false)}>保存目標</button>
          <button type="button" className="primary" onClick={() => saveProfile(true)}>計算並套用 TDEE／蛋白質建議</button>
          <p className="hint">
            以上數值為概略估算，僅供參考，非醫療或營養專業建議。若有慢性腎臟病、肝病、懷孕哺乳或其他需限制蛋白質攝取的狀況，請諮詢醫師或營養師再調整。
            <br />
            蛋白質基礎值參考衛生福利部國民健康署《國人膳食營養素參考攝取量》第八版；熱量與蛋白質的活動量加成為一般經驗法則。
          </p>
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
          <small className="hint">要看「更新了沒」看建置時間，不是版本號——重打幾次版本號也不會變。</small>
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

  return (
    <main className="shell">
      <Header title="今日飲食" onEyebrowClick={() => setView('about')} actions={
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
        <div className="summary-tappable" role="button" tabIndex={0} onClick={() => setView('stats')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setView('stats') }}>
          <span>熱量{dynamicKcalLimit !== null && <small className="dynamic-tag">當日消耗（手機搬家包）</small>}</span>
          <strong className={effectiveKcalLimit !== undefined && daily.totalKcal > effectiveKcalLimit ? 'over' : ''}>{daily.totalKcal} kcal</strong>
          <small>/ {effectiveKcalLimit ?? '未設定'}</small>
        </div>
        <div><span>蛋白質</span><strong className={bodyProfile && daily.totalProteinG >= bodyProfile.dailyProteinGoalG ? 'good' : ''}>{daily.totalProteinG} g</strong><small>/ {bodyProfile?.dailyProteinGoalG ?? '未設定'}</small></div>
      </section>
      <button type="button" className="primary full-width" onClick={() => setQuickEntryOpen((open) => !open)}>
        {quickEntryOpen ? '關閉入帳' : '+ 快速入帳'}
      </button>
      {quickEntryOpen && <section className="quick-entry">
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
            <button type="button" className="food-option" key={foodItem.id} onClick={() => logMeal(foodItem)}>
              <span className="food-option-name">
                <strong>{foodItem.name}</strong>
                {(foodItem.brand || foodItem.flavor) && (
                  <small>{[foodItem.brand, foodItem.flavor].filter(Boolean).join(' · ')}</small>
                )}
              </span>
              <small>{foodItem.perServing.kcal} kcal · {foodItem.perServing.proteinG} g 蛋白<br />{usageText(foodUsageOf(foodUsage, foodItem.id))}</small>
            </button>
          ))}
        </div>
      </section>}
      <section className="meal-list">
        {daily.meals.length === 0 ? <p className="empty">這天還沒有飲食紀錄</p> : daily.meals.map((meal) => (
          <button type="button" className="meal-row-compact" key={meal.mealLog.id} onClick={() => openMealEditor(meal.mealLog, meal.foodItem, meal.name)}>
            <time>{new Date(meal.mealLog.eatenAt).toLocaleTimeString('zh-TW', { hour: 'numeric', minute: '2-digit' })}</time>
            <span className="meal-name">{meal.name}</span>
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

