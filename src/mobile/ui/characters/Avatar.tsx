import { useState } from 'react'
import MonoIcon from '@shared/MonoIcon'
import { useAvatarUrl } from './useAvatarUrl'

/**
 * 單顆角色頭像（清單 D6）。
 *
 * 找不到圖就顯示腳印圖示 —— **兩種找不到都要涵蓋**：
 * `avatarUrl()` 回 `null`（角色沒設頭像），以及回了位址但圖載入失敗
 * （檔案被刪、換過對話後舊位址失效）。
 * 只處理前者的話會看到破圖圖示，比腳印難看也難懂。
 */
export function Avatar({
  characterId,
  size = 40,
  muted = false
}: {
  characterId: string
  size?: number
  /** 禁言：灰階 ＋ 角落靜音圖示（清單 D1）。 */
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
          className={`flex h-full w-full items-center justify-center rounded-full border border-[var(--border)] bg-[var(--mint2)] text-[var(--text)] ${
            muted ? 'grayscale opacity-55' : ''
          }`}
        >
          {/* 用比例而非固定尺寸：頭像在聊天列是 40px、在角色選單是 52px，圖示要跟著縮放 */}
          <MonoIcon name="paw" className="h-1/2 w-1/2" />
        </div>
      )}
      {muted && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-sub)]"
          style={{ width: size * 0.42, height: size * 0.42 }}
        >
          <MonoIcon name="mute" className="h-3/5 w-3/5" />
        </span>
      )}
    </div>
  )
}
