import { useState, useEffect } from 'react'

const DICE_FACES = [4, 6, 8, 10, 12, 20, 100]

export default function RandomToolsWindow() {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advFaces, setAdvFaces] = useState(6)
  const [advCount, setAdvCount] = useState(2)
  const [advModifier, setAdvModifier] = useState(0)
  const [khCount, setKhCount] = useState(3)
  const [khFaces, setKhFaces] = useState(6)
  const [khKeep, setKhKeep] = useState(3)
  const [khIsHigh, setKhIsHigh] = useState(true)

  useEffect(() => {
    const onBlur = () => window.api.invoke('random-tools:close')
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  const select = (tool: string, extra?: object) => {
    window.api.invoke('random-tools:select', { tool, ...extra })
  }

  const advNotation = (() => {
    const mod = advModifier > 0 ? `+${advModifier}` : advModifier < 0 ? String(advModifier) : ''
    return `${advCount}d${advFaces}${mod}`
  })()

  const khNotation = (() => {
    const kk = khKeep < khCount ? (khIsHigh ? `kh${khKeep}` : `kl${khKeep}`) : ''
    return `${khCount}d${khFaces}${kk}`
  })()

  const Row = ({ emoji, label, btnLabel, onClick }: { emoji: string; label: string; btnLabel: string; onClick: () => void }) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-primary flex items-center gap-1.5">
        <span>{emoji}</span><span>{label}</span>
      </span>
      <button
        type="button"
        className="shrink-0 rounded-xl px-3 py-1 bg-teal text-primary text-xs font-semibold hover:bg-mint transition-colors border border-border"
        onClick={onClick}
      >
        {btnLabel}
      </button>
    </div>
  )

  return (
    <div className="w-full h-full flex flex-col bg-bg border border-border rounded-2xl overflow-hidden shadow-panel">
      <div
        className="h-8 shrink-0 bg-surface border-b border-border flex items-center px-3 rounded-t-2xl"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-xs font-semibold text-primary select-none">🎲 隨機工具</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 no-drag">
        <Row emoji="🏮" label="抽籤" btnLabel="抽一籤" onClick={() => select('omikuji')} />
        <Row emoji="🙏" label="擲茭" btnLabel="擲一次" onClick={() => select('jiao')} />
        <Row emoji="🪙" label="硬幣" btnLabel="投一次" onClick={() => select('coin')} />

        <div className="border-t border-border" />

        {/* 骰子基本 */}
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-primary flex items-center gap-1.5">
            <span>🎲</span><span>骰子</span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DICE_FACES.map(f => (
              <button
                key={f}
                type="button"
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-secondary hover:bg-mint hover:text-primary hover:border-teal transition-colors"
                onClick={() => select('dice', { faces: f, count: 1, kept: undefined })}
              >
                {f}面
              </button>
            ))}
          </div>

          {/* 進階展開 */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={e => setShowAdvanced(e.target.checked)}
              className="rounded accent-teal"
            />
            <span className="text-xs text-secondary">進階（多顆／修正／優勢）</span>
          </label>

          {showAdvanced && (
            <div className="flex flex-col gap-3 pl-1">

              {/* 多顆骰 + 修正值 */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-secondary font-medium">多顆骰 + 修正值</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="number" min={1} max={20} value={advCount}
                    onChange={e => setAdvCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                    className="input-field w-12 text-center text-xs py-0.5"
                  />
                  <span className="text-xs text-secondary">顆</span>
                  <input
                    type="number" min={2} max={1000} value={advFaces}
                    onChange={e => setAdvFaces(Math.max(2, Math.min(1000, Number(e.target.value) || 6)))}
                    className="input-field w-14 text-center text-xs py-0.5"
                  />
                  <span className="text-xs text-secondary">面</span>
                  <span className="text-xs text-secondary">+</span>
                  <input
                    type="number" min={-99} max={99} value={advModifier}
                    onChange={e => setAdvModifier(Math.max(-99, Math.min(99, Number(e.target.value) || 0)))}
                    className="input-field w-16 text-center text-xs py-0.5"
                  />
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1 bg-teal text-primary text-xs font-semibold hover:bg-mint transition-colors border border-border"
                    onClick={() => select('dice', { faces: advFaces, count: advCount, modifier: advModifier || undefined })}
                  >
                    投擲
                  </button>
                </div>
                <span className="text-[10px] text-secondary">= {advNotation}</span>
              </div>

              {/* 優勢 / 劣勢 */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-secondary font-medium">優勢 / 劣勢（D&D 5e）</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-secondary hover:bg-mint hover:text-primary hover:border-teal transition-colors text-center"
                    onClick={() => select('dice', { faces: 20, count: 2, keepHighest: 1 })}
                  >
                    ↑ 優勢 2d20取高
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-secondary hover:bg-mint hover:text-primary hover:border-teal transition-colors text-center"
                    onClick={() => select('dice', { faces: 20, count: 2, keepLowest: 1 })}
                  >
                    ↓ 劣勢 2d20取低
                  </button>
                </div>
              </div>

              {/* 保留最高/最低 N */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-secondary font-medium">保留最高 / 最低 N（屬性生成等）</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <input
                    type="number" min={1} max={20} value={khCount}
                    onChange={e => {
                      const v = Math.max(1, Math.min(20, Number(e.target.value) || 1))
                      setKhCount(v)
                      if (khKeep >= v) setKhKeep(v - 1 || 1)
                    }}
                    className="input-field w-12 text-center text-xs py-0.5"
                  />
                  <span className="text-xs text-secondary">顆</span>
                  <input
                    type="number" min={2} max={1000} value={khFaces}
                    onChange={e => setKhFaces(Math.max(2, Math.min(1000, Number(e.target.value) || 6)))}
                    className="input-field w-14 text-center text-xs py-0.5"
                  />
                  <span className="text-xs text-secondary">面</span>
                  <span className="text-xs text-secondary">取</span>
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${khIsHigh ? 'bg-teal border-teal text-primary' : 'border-border text-secondary hover:bg-mint'}`}
                    onClick={() => setKhIsHigh(true)}
                  >高</button>
                  <button
                    type="button"
                    className={`rounded-lg border px-2 py-0.5 text-xs font-medium transition-colors ${!khIsHigh ? 'bg-teal border-teal text-primary' : 'border-border text-secondary hover:bg-mint'}`}
                    onClick={() => setKhIsHigh(false)}
                  >低</button>
                  <input
                    type="number" min={1} max={Math.max(1, khCount - 1)} value={khKeep}
                    onChange={e => setKhKeep(Math.max(1, Math.min(khCount - 1 || 1, Number(e.target.value) || 1)))}
                    className="input-field w-12 text-center text-xs py-0.5"
                  />
                  <span className="text-xs text-secondary">顆</span>
                  <button
                    type="button"
                    className="rounded-lg px-2.5 py-1 bg-teal text-primary text-xs font-semibold hover:bg-mint transition-colors border border-border"
                    onClick={() => select('dice', khIsHigh
                      ? { faces: khFaces, count: khCount, keepHighest: khKeep }
                      : { faces: khFaces, count: khCount, keepLowest: khKeep }
                    )}
                  >
                    投擲
                  </button>
                </div>
                <span className="text-[10px] text-secondary">= {khNotation}</span>
              </div>

            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-border bg-surface rounded-b-2xl">
        <p className="text-[10px] text-secondary text-center select-none">隨機函數僅供娛樂，請勿過於認真看待</p>
      </div>
    </div>
  )
}
