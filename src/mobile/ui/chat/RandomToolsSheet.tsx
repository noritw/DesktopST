import { useState } from 'react'
import type { PendingRandomTool } from '@core/types'
import { makeTokenString } from '@core/prompt/randomTokens'
import { useComposerStore } from '../stores/composerStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 隨機工具面板（清單 C1、C2、C4）。
 *
 * ⚠️ **按下去不會立刻揭曉。** 插進輸入框的是一顆 token（`[🎲2d6+3]`，清單 C3），
 * 真正的擲出發生在送出的那一刻 —— 這是與桌面版一致的設計，
 * 為的是讓「先擲再決定要不要送」變得不可能。
 * 因此這裡**完全不呼叫 `computeRandomResult`**，只產生 token。
 */

const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100]

export function RandomToolsSheet(): JSX.Element {
  const insert = useComposerStore((s) => s.insert)
  const respond = useComposerStore((s) => s.respond)
  const setRespond = useComposerStore((s) => s.setRespond)
  const pop = useUiStore((s) => s.pop)

  const [count, setCount] = useState('1')
  const [faces, setFaces] = useState('6')
  const [modifier, setModifier] = useState('0')

  const put = (pending: PendingRandomTool): void => {
    insert(makeTokenString(pending))
    // 插完就關：使用者的下一步一定是回去打字或送出。
    pop()
  }

  const rollCustom = (): void => {
    // 表單值一律夾在 core 的 `sanitizePendingRandomTool` 同一組範圍內。
    // 這裡只是不讓使用者打出 `999d1000`，不是安全邊界（那在 HTTP 端點上）。
    put({
      tool: 'dice',
      count: clamp(count, 1, 20, 1),
      faces: clamp(faces, 2, 1000, 6),
      modifier: clamp(modifier, -1000, 1000, 0)
    })
  }

  return (
    <div className="pb-2">
      <SectionTitle>骰子</SectionTitle>
      <div className="grid grid-cols-4 gap-2">
        {QUICK_DICE.map((f) => (
          <ToolButton key={f} onClick={() => put({ tool: 'dice', faces: f, count: 1, modifier: 0 })}>
            d{f}
          </ToolButton>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <NumberField value={count} onValue={setCount} aria-label="顆數" />
        <span className="text-sm text-[var(--text-sub)]">d</span>
        <NumberField value={faces} onValue={setFaces} aria-label="面數" />
        <span className="text-sm text-[var(--text-sub)]">+</span>
        <NumberField value={modifier} onValue={setModifier} aria-label="修正值" />
        <button
          type="button"
          onClick={rollCustom}
          className="ml-auto shrink-0 rounded-full bg-[var(--mint)] px-4 py-2 text-sm text-[var(--text)]"
        >
          擲
        </button>
      </div>

      <SectionTitle>其他</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <ToolButton onClick={() => put({ tool: 'coin' })}>🪙 硬幣</ToolButton>
        <ToolButton onClick={() => put({ tool: 'jiao' })}>🙏 擲茭</ToolButton>
        <ToolButton onClick={() => put({ tool: 'omikuji' })}>🏮 抽籤</ToolButton>
      </div>

      {/* 清單 C4／A7。位置與 mobile.html 相同（在隨機工具面板裡）——
          擲完骰子只想記錄結果、不要角色接話，是這個勾選框最常見的用途。 */}
      <label className="mt-4 flex items-center gap-2.5 rounded-[14px] bg-[var(--bg)] px-3.5 py-3 text-sm text-[var(--text)]">
        <input
          type="checkbox"
          checked={respond}
          onChange={(e) => setRespond(e.target.checked)}
          className="h-4 w-4 accent-[var(--mint2)]"
        />
        送出後讓角色回應
      </label>
      <p className="mt-1.5 px-1 text-xs leading-relaxed text-[var(--text-sub)]">
        取消勾選時，訊息只會記進對話，角色不會回話。
      </p>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mb-2 mt-4 text-xs text-[var(--text-sub)] first:mt-0">{children}</div>
}

function ToolButton({
  onClick,
  children
}: {
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[14px] border border-[var(--border)] bg-[var(--bg)] py-3 text-sm text-[var(--text)] active:bg-[var(--mint)]"
    >
      {children}
    </button>
  )
}

function NumberField({
  value,
  onValue,
  ...rest
}: {
  value: string
  /** 刻意不叫 `onChange`：那個名字屬於 `<input>` 自己，蓋掉會讓型別打架。 */
  onValue: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>): JSX.Element {
  return (
    <input
      // `inputMode` 而不是 `type="number"`：手機上 number 的上下箭頭又小又難按，
      // 而且清空欄位時 `value` 會變成空字串，狀態很難處理。
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onValue(e.target.value)}
      className="w-14 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-center text-sm text-[var(--text)] outline-none focus:border-[var(--mint2)]"
      {...rest}
    />
  )
}

function clamp(raw: string, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
