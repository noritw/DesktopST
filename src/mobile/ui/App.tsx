import { useEffect } from 'react'
import { applyTheme } from './theme'
import { useUiStore } from './stores/uiStore'
import { useBackButton } from './shell/useBackButton'
import { ViewStack } from './shell/ViewStack'
import { ToastHost } from './shell/ToastHost'
import { DialogHost } from './shell/DialogHost'
import type { ViewKind } from './stores/uiStore'

/**
 * 手機 UI 的根元件。
 *
 * **階段 1 只有骨架**：主題、sheet 堆疊、toast、對話框、安全區域、返回鍵。
 * 主畫面（訊息串與輸入框）是階段 2 的事，現在放的是一塊可操作的驗收面板 ——
 * 骨架這種東西沒有畫面就無法驗，而自動測試碰不到它（`tests/README.md`）。
 */
export function App(): JSX.Element {
  const theme = useUiStore((s) => s.theme)
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const prompt = useUiStore((s) => s.prompt)

  useBackButton()

  useEffect(() => {
    applyTheme(theme, document.documentElement, document)
  }, [theme])

  return (
    <div className="flex h-full flex-col bg-[var(--bg)]">
      <header
        className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--mint)] px-4 pb-2"
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        <span className="text-[17px] font-semibold text-[var(--text)]">DeST</span>
        <button
          type="button"
          onClick={() => push('theme-picker')}
          className="rounded-full bg-[var(--surface)]/70 px-3 py-1.5 text-sm text-[var(--text)]"
        >
          🎨 主題
        </button>
      </header>

      <main className="scroll-y flex-1 px-5 py-4">
        <p className="text-sm leading-relaxed text-[var(--text-sub)]">
          B3 階段 1：UI 骨架。下面每個按鈕對應清單上的一項，請逐一點過確認。
        </p>

        <Section title="G3 畫面堆疊">
          {(['conversations', 'presence', 'characters', 'presets', 'settings', 'news'] as ViewKind[]).map((k) => (
            <Btn key={k} onClick={() => push(k)}>
              開啟「{k}」
            </Btn>
          ))}
          <Btn
            onClick={() => {
              push('conversations')
              push('characters')
            }}
          >
            一次疊兩層（測返回）
          </Btn>
        </Section>

        <Section title="G2 Toast">
          <Btn onClick={() => toast('這是一般提示')}>一般</Btn>
          <Btn onClick={() => toast('這是錯誤提示', 'error')}>錯誤</Btn>
          <Btn
            onClick={() => {
              toast('第一則')
              toast('第二則')
              toast('第三則')
            }}
          >
            連續三則
          </Btn>
        </Section>

        <Section title="E2 對話框（不用瀏覽器內建）">
          <Btn
            onClick={async () => {
              const ok = await confirm({ title: '刪除這則對話？', message: '刪除後無法復原。', confirmLabel: '刪除', destructive: true })
              toast(ok ? '你按了刪除' : '你取消了')
            }}
          >
            確認
          </Btn>
          <Btn
            onClick={async () => {
              const name = await prompt({ title: '重新命名', defaultValue: '週末的閒聊', placeholder: '輸入名稱' })
              toast(name === null ? '你取消了' : `新名稱：${name}`)
            }}
          >
            輸入
          </Btn>
        </Section>

        <Section title="G4 安全區域／捲動">
          <p className="text-xs text-[var(--text-sub)]">
            這段文字下面刻意放很長的內容，用來確認：整頁不會橫向捲動、
            底部不會被系統手勢橫條蓋住。
          </p>
          <div className="scroll-y w-full">
            <pre className="text-xs text-[var(--text-sub)]">
              {'橫向溢出測試 ── '.repeat(20)}
            </pre>
          </div>
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="rounded-[12px] border border-[var(--border)] px-3 py-2 text-sm">
              捲動測試 {i + 1}
            </div>
          ))}
        </Section>
      </main>

      <footer
        className="border-t border-[var(--border)] bg-[var(--surface)] px-5 pt-3 text-center text-xs text-[var(--text-sub)]"
        style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
      >
        這一列的下緣應該剛好在手勢橫條上方
      </footer>

      <ViewStack />
      <DialogHost />
      <ToastHost />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-sub)]">{title}</h2>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-left text-[15px] text-[var(--text)] active:bg-[var(--mint)]"
    >
      {children}
    </button>
  )
}
