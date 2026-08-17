import React from 'react'
import ReactDOM from 'react-dom/client'
import MonoIcon from '@shared/MonoIcon'
import {
  applyMigrationPack,
  buildDailyView,
  buildMigrationPack,
  calculateGoalAdjustedKcal,
  calculateProteinGoalG,
  calculateTdeeKcal,
  collectReferencedPhotoKeys,
  foodPhotoKey,
  matchFoodKeyword,
  mealPhotoKey,
  nextFreeFoodPhotoIndex,
  MAX_FOOD_PHOTOS,
  NUTRITION_PACK_EXTENSION,
  NutritionSession,
  toIsoDateString,
  type FoodItem,
  type MealLog,
  type MigrationMergeMode,
  type NutritionActivityLevel,
  type NutritionGoal,
  type NutritionMigrationPack,
  type NutritionSnapshot
} from '@core/nutrition'
import { buildInfoLines } from './buildInfo'
import { downloadBytes, pickFile } from './fileTransfer'
import { compressImageFile } from './imageInput'
import { nutritionMobileStorage } from './storage'
import './styles.css'

type View = 'daily' | 'library' | 'foodForm' | 'mealEditor' | 'profile' | 'about' | 'transfer'

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

function Header({ title, onBack, onEyebrowClick, actions }: { title: string; onBack?: () => void; onEyebrowClick?: () => void; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="app-header">
      <div className="app-header-left">
        {onBack
          ? <button type="button" className="icon-button" aria-label="返回" onClick={onBack}><MonoIcon name="chevron-left" className="icon-md" /></button>
          : <button type="button" className="eyebrow-button" onClick={onEyebrowClick}><p className="eyebrow">飲食記錄</p></button>}
        <h1>{title}</h1>
      </div>
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
  const viewRef = React.useRef(view)
  const photoPreviewRef = React.useRef(photoPreview)

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
        if (current === 'library' || current === 'mealEditor' || current === 'profile' || current === 'about' || current === 'transfer') { setView('daily'); return }
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
        setProfileAge(String(session.bodyProfile.ageYears))
        setProfileSex(session.bodyProfile.sex)
        setProfileBodyFatPercent(session.bodyProfile.bodyFatPercent ? String(session.bodyProfile.bodyFatPercent) : '')
        setProfileActivity(session.bodyProfile.activityLevel)
        setProfileGoal(session.bodyProfile.goal)
        setProfileKcal(String(session.bodyProfile.dailyKcalLimit))
        setProfileProtein(String(session.bodyProfile.dailyProteinGoalG))
      }
      applySnapshot(session)
    }).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => unsubscribe?.()
  }, [])

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

  function leaveFoodForm(): void {
    const orphaned = sessionAddedPhotoKeysRef.current
    pendingDeletePhotoKeysRef.current = []
    sessionAddedPhotoKeysRef.current = []
    if (orphaned.length > 0) void Promise.all(orphaned.map((key) => nutritionMobileStorage.remove(key)))
    setView('library')
  }

  function openFoodForm(foodItem: FoodItem | null): void {
    const id = foodItem?.id ?? `food-${Date.now()}`
    setEditingFoodId(id)
    setIsNewFood(!foodItem)
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
      await nutritionMobileStorage.writeBinary(key, bytes)
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
        photoKeys: foodDraft.photoKeys.slice(0, MAX_FOOD_PHOTOS) as FoodItem['photoKeys'],
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
      const toDelete = pendingDeletePhotoKeysRef.current
      pendingDeletePhotoKeysRef.current = []
      sessionAddedPhotoKeysRef.current = []
      if (toDelete.length > 0) void Promise.all(toDelete.map((key) => nutritionMobileStorage.remove(key)))
      if (alsoLogToday) { setQuickEntryOpen(false); setFoodQuery(''); setView('daily') } else { setView('library') }
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
            <button type="button" className="danger" disabled={saving} onClick={() => setConfirmDeleteFood(true)}>
              <MonoIcon name="trash" className="icon-sm" /> 刪除這個食物
            </button>
          </section>
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

  return (
    <main className="shell">
      <Header title="" onEyebrowClick={() => setView('about')} actions={
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
        <div><span>熱量</span><strong className={bodyProfile && daily.totalKcal > bodyProfile.dailyKcalLimit ? 'over' : ''}>{daily.totalKcal} kcal</strong><small>/ {bodyProfile?.dailyKcalLimit ?? '未設定'}</small></div>
        <div><span>蛋白質</span><strong className={bodyProfile && daily.totalProteinG >= bodyProfile.dailyProteinGoalG ? 'good' : ''}>{daily.totalProteinG} g</strong><small>/ {bodyProfile?.dailyProteinGoalG ?? '未設定'}</small></div>
      </section>
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
              <button type="button" className="icon-button" aria-label="新增食物到食物庫" onClick={() => { setQuickEntryOpen(false); openFoodForm(null) }}>
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
                  <button type="button" onClick={() => { setQuickEntryOpen(false); openFoodForm(null) }}>去食物庫新增</button>
                </div>
              ) : quickFoods.map((foodItem) => (
                <button type="button" className="food-option" key={foodItem.id} disabled={saving} onClick={() => logMeal(foodItem)}>
                  <span>{foodItem.name}</span><small>{foodItem.perServing.kcal} kcal · {foodItem.perServing.proteinG} g 蛋白</small>
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


