import { Component, type ReactNode } from 'react'
import MonoIcon from '@shared/MonoIcon'

interface State {
  error: Error | null
}

/**
 * 手機版的最後一道防線。
 *
 * render 途中丟出的例外若沒被攔下，React 會把整棵樹卸載，畫面變成
 * 空的 `#root`（白畫面）且所有事件監聽器一起消失，只能重開 App
 * （owner 2026-08-15 實際踩到：載入中點選單，`appStore` 還沒 `attach()`
 * 就被讀，整個畫面白掉）。這裡接住例外，給一個能點的「重新載入」。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg)] px-8 text-center">
          <MonoIcon name="plug" className="h-8 w-8 text-[var(--text-sub)]" />
          <p className="text-sm leading-relaxed text-[var(--text-sub)]">畫面出了點問題，重新載入看看。</p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
          >
            重新載入
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
