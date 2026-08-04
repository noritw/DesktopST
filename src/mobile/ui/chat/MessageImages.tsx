import { useEffect, useState } from 'react'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 訊息裡的圖片（清單 B3 的顯示側 ＋ B4 的入口）。
 *
 * 取圖有兩條路，優先順序有意義：
 *
 *   1. **手上已有的原圖**（剛送出去那則）—— 立刻顯示，不必等網路
 *   2. `DataSource.getMessageImageUrl()` —— 其餘一律走這支
 *
 * ⚠️ 第 2 條不可以改成直接讀 `message.images`：快照本來就沒帶 base64，
 * 而獨立模式那邊是本機檔案路徑，WebView 載不動（同 `avatarUrl` 的理由）。
 */
export function MessageImages({
  messageId,
  count
}: {
  messageId: string
  count: number
}): JSX.Element | null {
  const local = useAppStore((s) => s.localImages[messageId])
  const openLightbox = useUiStore((s) => s.openLightbox)
  const [remote, setRemote] = useState<(string | null)[]>([])

  useEffect(() => {
    if (local) {
      setRemote([])
      return
    }
    let alive = true
    const data = getData()
    void Promise.all(
      Array.from({ length: count }, (_, i) => data.getMessageImageUrl(messageId, i).catch(() => null))
    ).then((urls) => {
      // 元件已經被換掉就別再 setState —— 快速切換對話時會踩到。
      if (alive) setRemote(urls)
    })
    return () => {
      alive = false
    }
  }, [messageId, count, local])

  const sources = local ?? remote
  if (count <= 0) return null

  /**
   * 燈箱只收得到位址的那幾張。
   *
   * ⚠️ **不能直接把 `sources` 丟進去**：取不到的那張是 `null`，
   * 燈箱翻到它會變成一片空白，使用者只會覺得「壞了」。
   * 過濾之後索引會跑掉，所以另外記一份對照。
   */
  const gallery = sources.filter((s): s is string => !!s)

  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {Array.from({ length: count }, (_, i) => {
        const src = sources[i]
        return src ? (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            onClick={() => openLightbox(gallery, gallery.indexOf(src))}
            className="h-24 w-24 rounded-[10px] border border-[var(--border)] object-cover"
          />
        ) : (
          // 還沒拿到位址（或這張取不到）：留一個同尺寸的框。
          // 不留的話圖片載入時整串訊息會往下跳一次。
          <div
            key={i}
            className="flex h-24 w-24 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-lg opacity-50"
          >
            🖼
          </div>
        )
      })}
    </div>
  )
}
