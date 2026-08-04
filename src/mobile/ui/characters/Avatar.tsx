import { useState } from 'react'
import { useAvatarUrl } from './useAvatarUrl'

/**
 * 單顆角色頭像（清單 D6）。
 *
 * 找不到圖就顯示 🐾 —— **兩種找不到都要涵蓋**：
 * `avatarUrl()` 回 `null`（角色沒設頭像），以及回了位址但圖載入失敗
 * （檔案被刪、換過對話後舊位址失效）。
 * 只處理前者的話會看到破圖圖示，比 🐾 難看也難懂。
 */
export function Avatar({
  characterId,
  size = 40,
  muted = false
}: {
  characterId: string
  size?: number
  /** 禁言：灰階 ＋ 角落 🔇（清單 D1）。 */
  muted?: boolean
}): JSX.Element {
  const url = useAvatarUrl(characterId)
  const [broken, setBroken] = useState(false)

  const box = { width: size, height: size }

  return (
    <div className="relative shrink-0" style={box}>
      {url && !broken ? (
        <img
          src={url}
          alt=""
          onError={() => setBroken(true)}
          className={`h-full w-full rounded-full border border-[var(--border)] object-cover ${
            muted ? 'grayscale opacity-55' : ''
          }`}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center rounded-full border border-[var(--border)] bg-[var(--mint2)] ${
            muted ? 'grayscale opacity-55' : ''
          }`}
          style={{ fontSize: size * 0.5 }}
        >
          🐾
        </div>
      )}
      {muted && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-[var(--surface)]"
          style={{ width: size * 0.42, height: size * 0.42, fontSize: size * 0.26 }}
        >
          🔇
        </span>
      )}
    </div>
  )
}
