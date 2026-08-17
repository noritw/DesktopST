import React from 'react'
import ReactDOM from 'react-dom/client'
import MonoIcon from '@shared/MonoIcon'
import {
  buildDailyView,
  calculateTdeeKcal,
  foodPhotoKey,
  matchFoodKeyword,
  mealPhotoKey,
  MAX_FOOD_PHOTOS,
  toIsoDateString,
  type FoodItem,
  type MealLog,
  type NutritionActivityLevel,
  type NutritionSnapshot
} from '@core/nutrition'
import { compressImageFile } from './imageInput'
import './styles.css'

type View = 'daily' | 'library' | 'foodForm' | 'mealEditor' | 'profile'

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

function collectTags(foodItems: FoodItem[]): string[] {
  const set = new Set<string>()
  for (const foodItem of foodItems) for (const tag of foodItem.tags ?? []) set.add(tag)
  return [...set].sort()
}

declare global {
  interface Window {
    nutritionDesktop: {
      load: () => Promise<NutritionSnapshot>
      addDemoMeal: (foodItemId?: string) => Promise<NutritionSnapshot>
      removeMeal: (id: string) => Promise<NutritionSnapshot>
      updateMeal: (id: string, patch: { servings: number; eatenAt: number; scope: 'meal' | 'food'; name: string; kcal: number; proteinG: number }) => Promise<NutritionSnapshot>
      saveFood: (foodItem: unknown) => Promise<NutritionSnapshot>
      removeFood: (id: string) => Promise<NutritionSnapshot>
      saveProfile: (profile: unknown) => Promise<NutritionSnapshot>
      readPhoto: (key: string) => Promise<Uint8Array | null>
      writePhoto: (key: string, bytes: Uint8Array) => Promise<void>
      removePhoto: (key: string) => Promise<void>
      setMealPhoto: (id: string, photoKey: string | null) => Promise<NutritionSnapshot>
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

function PhotoPreview({ photoKeys, initialIndex, onClose }: { photoKeys: string[]; initialIndex: number; onClose: () => void }): React.JSX.Element {
  const [index, setIndex] = React.useState(Math.min(initialIndex, photoKeys.length - 1))
  const url = useStoredPhotoUrl(photoKeys[index])
  return (
    <div className="photo-preview-overlay" role="dialog" aria-modal="true" aria-label="照片預覽" onClick={onClose}>
      <div className="photo-preview" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="photo-preview-close" aria-label="關閉照片預覽" onClick={onClose}><MonoIcon name="close" className="icon-md" /></button>
        {url && <img src={url} alt="照片預覽" />}
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

function MealPhotoField({ mealLog, foodItem, onPick, onClear }: {
  mealLog: MealLog
  foodItem: FoodItem | null
  onPick: (file: File) => void
  onClear: () => void
}): React.JSX.Element {
  const ownPhotoKey = mealLog.photoKey
  const inheritedPhotoKey = foodItem?.photoKeys[0]
  const displayedKey = ownPhotoKey ?? inheritedPhotoKey
  const url = useStoredPhotoUrl(displayedKey)
  return (
    <section className="photo-section">
      <label>照片（可選）</label>
      <div className="photo-grid">
        {url && (
          <div className="photo-thumb">
            <img src={url} alt="" />
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

function Header({ title, onBack, actions }: { title: string; onBack?: () => void; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="app-header">
      <div className="app-header-left">
        {onBack
          ? <button type="button" className="icon-button" aria-label="返回" onClick={onBack}><MonoIcon name="chevron-left" className="icon-md" /></button>
          : <p className="eyebrow">DeST 飲食記錄</p>}
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

  const [profileHeight, setProfileHeight] = React.useState('170')
  const [profileWeight, setProfileWeight] = React.useState('70')
  const [profileAge, setProfileAge] = React.useState('30')
  const [profileActivity, setProfileActivity] = React.useState<NutritionActivityLevel>('moderate')
  const [profileKcal, setProfileKcal] = React.useState('2000')
  const [profileProtein, setProfileProtein] = React.useState('100')

  React.useEffect(() => {
    void window.nutritionDesktop.load().then((next) => {
      if (next.bodyProfile) {
        setProfileHeight(String(next.bodyProfile.heightCm))
        setProfileWeight(String(next.bodyProfile.weightKg))
        setProfileAge(String(next.bodyProfile.ageYears))
        setProfileActivity(next.bodyProfile.activityLevel)
        setProfileKcal(String(next.bodyProfile.dailyKcalLimit))
        setProfileProtein(String(next.bodyProfile.dailyProteinGoalG))
      }
      setSnapshot(next)
    })
  }, [])

  function logMeal(foodItem: FoodItem): void {
    void window.nutritionDesktop.addDemoMeal(foodItem.id).then((next) => {
      setSnapshot(next); setQuickEntryOpen(false); setFoodQuery('')
    })
  }

  function openFoodForm(foodItem: FoodItem | null): void {
    const id = foodItem?.id ?? `food-${Date.now()}`
    setEditingFoodId(id)
    setIsNewFood(!foodItem)
    setConfirmDeleteFood(false)
    setNewTagInput('')
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
    for (const [offset, file] of selected.entries()) {
      const bytes = await compressImageFile(file)
      const key = foodPhotoKey(editingFoodId, foodDraft.photoKeys.length + offset)
      await window.nutritionDesktop.writePhoto(key, bytes)
      keys.push(key)
    }
    if (keys.length > 0) setFoodDraft((prev) => ({ ...prev, photoKeys: [...prev.photoKeys, ...keys] }))
  }

  async function removeFoodPhoto(index: number): Promise<void> {
    const key = foodDraft.photoKeys[index]
    if (key) await window.nutritionDesktop.removePhoto(key)
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
    }).then((next) => { setSnapshot(next); setView('library') })
  }

  function deleteFoodConfirmed(): void {
    if (!editingFoodId) return
    void window.nutritionDesktop.removeFood(editingFoodId).then((next) => {
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
    const input = { heightCm: Number(profileHeight), weightKg: Number(profileWeight), ageYears: Number(profileAge), activityLevel: profileActivity }
    const tdeeEstimate = calculateTdeeKcal(input)
    const dailyKcalLimit = applyTdee ? tdeeEstimate : Number(profileKcal)
    const dailyProteinGoalG = Number(profileProtein)
    if (![input.heightCm, input.weightKg, input.ageYears, dailyKcalLimit, dailyProteinGoalG].every(Number.isFinite)) return
    void window.nutritionDesktop.saveProfile({
      id: current?.id ?? 'body-profile',
      ...input,
      tdeeEstimate,
      dailyKcalLimit,
      dailyProteinGoalG,
      createdAt: current?.createdAt ?? Date.now(),
      updatedAt: Date.now()
    }).then((next) => { setSnapshot(next); setProfileKcal(String(dailyKcalLimit)) })
  }

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
        <Header title={isNewFood ? '新增食物' : '編輯食物'} onBack={() => setView('library')} />
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
              <p>已記錄的餐次會顯示為「已刪除的食物」，但不會被刪除。此動作無法復原。</p>
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

  if (view === 'mealEditor') {
    const editingMealLog = editingMealId ? snapshot.mealLogs.find((log) => log.id === editingMealId) ?? null : null
    if (!editingMealLog) { setView('daily'); return <main className="shell"><p>載入中...</p></main> }
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
        />
        {(editingMealLog.photoKey || linkedFoodItem?.photoKeys[0]) && <button type="button" className="photo-preview-link" onClick={() => setPhotoPreview({ keys: editingMealLog.photoKey ? [editingMealLog.photoKey] : linkedFoodItem?.photoKeys[0] ? [linkedFoodItem.photoKeys[0]] : [], index: 0 })}>預覽照片</button>}
        {photoPreview && <PhotoPreview photoKeys={photoPreview.keys} initialIndex={photoPreview.index} onClose={() => setPhotoPreview(null)} />}
        <section className="scope-choice">
          <button type="button" onClick={() => saveMealEdit('meal')}>只儲存到當日飲食</button>
          <small>只影響這一筆紀錄，食物庫不會改變</small>
          <button type="button" className="primary" onClick={() => saveMealEdit('food')}>更新食物庫資料</button>
          <small>食物庫也會更新，之後每次吃這個食物都會套用新數值</small>
        </section>
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
          <label>活動量
            <select value={profileActivity} onChange={(event) => setProfileActivity(event.target.value as NutritionActivityLevel)}>
              <option value="sedentary">久坐</option>
              <option value="light">輕度</option>
              <option value="moderate">中度</option>
              <option value="active">高度</option>
              <option value="very-active">非常高度</option>
            </select>
          </label>
          <label>每日熱量上限（kcal）<input value={profileKcal} onChange={(event) => setProfileKcal(event.target.value)} inputMode="decimal" /></label>
          <label>每日蛋白質目標（g）<input value={profileProtein} onChange={(event) => setProfileProtein(event.target.value)} inputMode="decimal" /></label>
          <button type="button" onClick={() => saveProfile(false)}>保存目標</button>
          <button type="button" className="primary" onClick={() => saveProfile(true)}>計算並套用 TDEE</button>
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      <Header title="今日飲食" actions={
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
        <div><span>熱量</span><strong className={bodyProfile && daily.totalKcal > bodyProfile.dailyKcalLimit ? 'over' : ''}>{daily.totalKcal} kcal</strong><small>/ {bodyProfile?.dailyKcalLimit ?? '未設定'}</small></div>
        <div><span>蛋白質</span><strong className={bodyProfile && daily.totalProteinG > bodyProfile.dailyProteinGoalG ? 'over' : ''}>{daily.totalProteinG} g</strong><small>/ {bodyProfile?.dailyProteinGoalG ?? '未設定'}</small></div>
      </section>
      <button type="button" className="primary full-width" onClick={() => setQuickEntryOpen((open) => !open)}>
        {quickEntryOpen ? '關閉入帳' : '+ 快速入帳'}
      </button>
      {quickEntryOpen && <section className="quick-entry">
        <strong>選擇食物</strong>
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
            <button type="button" className="food-option" key={foodItem.id} onClick={() => logMeal(foodItem)}>
              <span>{foodItem.name}</span><small>{foodItem.perServing.kcal} kcal · {foodItem.perServing.proteinG} g 蛋白</small>
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

