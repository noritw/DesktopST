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
 * 換過主圖的角色 → 一個遞增號碼，附在網址後面當作 cache buster。
 *
 * ⚠️ **階段 3 之前不需要這東西，之後一定要有。** 換主圖後位址是同一個
 * （`/api/avatar/:id`），瀏覽器會直接拿快取裡那張舊圖 ——
 * 症狀是「存檔成功但畫面還是舊圖」，而且重開 app 才會好，
 * 使用者只會覺得沒存到，於是再選一次、再存一次。
 */
const versions = new Map<string, number>()
const listeners = new Set<() => void>()

/** 換過主圖之後呼叫。清掉快取並通知所有正在顯示這個頭像的元件重取。 */
export function invalidateAvatar(id: string): void {
  cache.delete(id)
  versions.set(id, (versions.get(id) ?? 0) + 1)
  for (const fn of listeners) fn()
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
        const v = versions.get(id)
        setUrl(u && v ? `${u}${u.includes('?') ? '&' : '?'}v=${v}` : u)
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
