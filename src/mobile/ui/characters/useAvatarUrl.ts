import { useEffect, useState } from 'react'
import { getData } from '../stores/appStore'

/**
 * 角色頭像位址（清單 D6）。
 *
 * ⚠️ **不可以直接讀 `character.avatar`。** 遙控模式那是電腦上的本機檔案路徑，
 * WebView 載不動；獨立模式是沙箱位址。兩邊都得經過 `DataSource.avatarUrl()`
 * （`core/data/types.ts` 已寫明這條）。
 *
 * 快取放模組層而不是元件內：頭像列與「誰在場」清單會同時問同一批角色，
 * 每個元件各查一次等於同樣的請求送好幾遍。
 */
const cache = new Map<string, Promise<string | null>>()

/**
 * 一個遞增號碼，附在網址後面當作 cache buster。
 *
 * ⚠️ **階段 3 之前不需要這東西，之後一定要有。** 換主圖後位址是同一個
 * （`/api/avatar/:id`），瀏覽器會直接拿快取裡那張舊圖 ——
 * 症狀是「存檔成功但畫面還是舊圖」，而且重開 app 才會好，
 * 使用者只會覺得沒存到，於是再選一次、再存一次。
 *
 * ⚠️ **故意是全站共用一個號碼，不是每隻角色各自一個。** 一開始是每隻角色
 * 各自維護版本號，但那只涵蓋得到「這支手機自己換過的頭像」——遙控模式下
 * **電腦端**換的主圖，手機收到的是通用的 `state-invalidated` 事件
 * （`appStore.ts` 的唯一訂閱點），不會告訴我們是哪一隻角色。與其去追蹤
 * 「哪些角色可能被電腦動過」，不如換頭像這種低頻操作就讓全部頭像一起
 * 重新問一次，簡單也不會漏（owner 2026-08-13 實機回報：電腦上換的主圖
 * 沒有反映到遙控版，是這裡漏掉電腦端變動的成因）。
 */
let version = 0
const listeners = new Set<() => void>()

/** 換過主圖之後呼叫。清掉快取並通知所有正在顯示頭像的元件重取。 */
export function invalidateAvatar(id: string): void {
  cache.delete(id)
  for (const key of [...displayCache.keys()]) {
    if (key.startsWith(`${id}|`)) displayCache.delete(key)
  }
  version++
  for (const fn of listeners) fn()
}

/**
 * 遙控模式收到電腦端的 `state-invalidated` 時呼叫——不知道是哪一隻角色的
 * 頭像變了，乾脆整包快取清掉，逼所有正在顯示的頭像重新問一次。
 */
export function invalidateAllAvatars(): void {
  cache.clear()
  displayCache.clear()
  version++
  for (const fn of listeners) fn()
}

/**
 * 加上 cache buster——**但只對真正的網址加**。
 *
 * 獨立模式的 `avatarUrl()`（`session.avatarDataUrl()`）回的是完整的
 * `data:image/png;base64,...` 字串，不是網址。在 `data:` URI 後面加
 * `?v=1` 會被當成 base64 內容的一部分，整串解不出來——**瀏覽器不會拋錯**，
 * `<img>` 只會靜靜觸發 `onerror`，畫面上看起來就是「選了圖，欄位閃一下
 * 又變回空的，什麼錯誤訊息都沒有」（獨立模式選頭像放不進去的成因）。
 * 遙控模式回的是 `/api/avatar/:id` 這種真的網址，接 `?v=` 才有意義。
 */
export function withCacheBuster(url: string, version: number | undefined): string {
  if (!version || url.startsWith('data:')) return url
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`
}

function lookup(id: string): Promise<string | null> {
  let p = cache.get(id)
  if (!p) {
    p = getData()
      .characters.avatarUrl(id)
      .catch(() => null)
    cache.set(id, p)
  }
  return p
}

/** 回傳頭像位址；還在查或查不到都是 `null`，呼叫端顯示 🐾。 */
export function useAvatarUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void lookup(id).then((u) => {
        if (!alive) return
        setUrl(u ? withCacheBuster(u, version) : u)
      })
    }
    load()
    listeners.add(load)
    return () => {
      alive = false
      listeners.delete(load)
    }
  }, [id])

  return url
}

/**
 * 依 emotion 換表情的顯示圖（聊天泡泡用，`docs/mobile-character-expression-plan.md` §5）。
 *
 * ⚠️ **快取 key 一定要帶 emotion。** 沒帶的話同一支手機同時顯示兩則不同
 * 表情的訊息會互相蓋掉彼此的快取（同一份文件 §5 最後一點的教訓）。
 * 這支回傳的通常已經是 `data:` URI（獨立模式）或裁切後的結果（遙控模式，
 * 見 `RemoteDataSource.characterDisplayImageUrl`），一律不加 cache buster。
 */
const displayCache = new Map<string, Promise<string | null>>()

function lookupDisplayImage(characterId: string, emotion: string | undefined): Promise<string | null> {
  const cacheKey = `${characterId}|${emotion ?? ''}`
  let p = displayCache.get(cacheKey)
  if (!p) {
    p = getData()
      .characterDisplayImageUrl(characterId, emotion)
      .catch(() => null)
    displayCache.set(cacheKey, p)
  }
  return p
}

/** 換過表情圖片、框選範圍改變時呼叫——沒有事件會告訴我們是哪個 emotion，乾脆整包清掉。 */
export function invalidateAllCharacterDisplayImages(): void {
  displayCache.clear()
  version++
  for (const fn of listeners) fn()
}

export function useCharacterDisplayImage(characterId: string, emotion: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void lookupDisplayImage(characterId, emotion).then((u) => {
        if (!alive) return
        setUrl(u)
      })
    }
    load()
    listeners.add(load)
    return () => {
      alive = false
      listeners.delete(load)
    }
  }, [characterId, emotion])

  return url
}
