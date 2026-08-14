import { useState, useEffect } from 'react'

const DICE_FACES = [4, 6, 8, 10, 12, 20, 100]

/** localStorage key 前綴 */
const DESKTOP_STORAGE_KEY = 'dest-dice-custom-desktop'
const KH_STORAGE_KEY = 'dest-dice-kh-desktop'

/** 讀取上次保存的進階骰子設定 */
function loadDicePreset(): { count: number; faces: number; modifier: number } {
  try {
    const saved = localStorage.getItem(DESKTOP_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed.count === 'number' && typeof parsed.faces === 'number' && typeof parsed.modifier === 'number') {
        return parsed
      }
    }
  } catch {
    // localStorage 讀取失敗，使用預設值
  }
  return { count: 2, faces: 6, modifier: 0 }
}

/** 讀取上次保存的保留最高/最低設定 */
function loadKhPreset(): { count: number; faces: number; keep: number; isHigh: boolean } {
  try {
    const saved = localStorage.getItem(KH_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (typeof parsed.count === 'number' && typeof parsed.faces === 'number' && typeof parsed.keep === 'number' && typeof parsed.isHigh === 'boolean') {
        return parsed
      }
    }
  } catch {
    // localStorage 讀取失敗，使用預設值
  }
  return { count: 3, faces: 6, keep: 3, isHigh: true }
}

/** 保存進階骰子設定 */
function saveDicePreset(count: number, faces: number, modifier: number): void {
  try {
    localStorage.setItem(DESKTOP_STORAGE_KEY, JSON.stringify({ count, faces, modifier }))
  } catch {
    // localStorage 寫入失敗，無聲吞掉
  }
}

/** 保存保留最高/最低設定 */
function saveKhPreset(count: number, faces: number, keep: number, isHigh: boolean): void {
  try {
    localStorage.setItem(KH_STORAGE_KEY, JSON.stringify({ count, faces, keep, isHigh }))
  } catch {
    // localStorage 寫入失敗，無聲吞掉
  }
}

export default function RandomToolsWindow() {
  const advPreset = loadDicePreset()
  const khPreset = loadKhPreset()
  
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advFaces, setAdvFaces] = useState(advPreset.faces)
  const [advCount, setAdvCount] = useState(advPreset.count)
  const [advModifier, setAdvModifier] = useState(advPreset.modifier)
  const [khCount, setKhCount] = useState(khPreset.count)
  const [khFaces, setKhFaces] = useState(khPreset.faces)
  const [khKeep, setKhKeep] = useState(khPreset.keep)
  const [khIsHigh, setKhIsHigh] = useState(khPreset.isHigh)
  const [sendToLlm, setSendToLlm] = useState(true)

  // 監聽進階骰子設定的變化，即時存到 localStorage
  useEffect(() => {
    saveDicePreset(advCount, advFaces, advModifier)
  }, [advCount, advFaces, advModifier])

  // 監聽保留最高/最低設定的變化，即時存到 localStorage
  useEffect(() => {
    saveKhPreset(khCount, khFaces, khKeep, khIsHigh)
  }, [khCount, khFaces, khKeep, khIsHigh])

  useEffect(() => {
    const onBlur = () => window.api.invoke('random-tools:close')
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  const select = (tool: string, extra?: object) => {
    window.api.invoke('random-tools:select', { tool, ...extra })
    // Don't close — allow user to insert multiple tokens
  }

  const toggleSendToLlm = (checked: boolean) => {
    setSendToLlm(checked)
    window.api.invoke('random-tools:skip-llm', !checked)
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
        <Row emoji="🏮" label="抽籤" btnLabel="插入" onClick={() => select('omikuji')} />
        <Row emoji="🙏" label="擲茭" btnLabel="插入" onClick={() => select('jiao')} />
        <Row emoji="🪙" label="硬幣" btnLabel="插入" onClick={() => select('coin')} />

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
                    插入
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
                    插入
                  </button>
                </div>
                <span className="text-[10px] text-secondary">= {khNotation}</span>
              </div>

            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-border bg-surface rounded-b-2xl flex flex-col gap-1.5">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={sendToLlm}
            onChange={e => toggleSendToLlm(e.target.checked)}
            className="rounded accent-teal"
          />
          <span className="text-[11px] text-primary font-medium">送出後讓角色回應</span>
        </label>
        <p className="text-[10px] text-secondary text-center select-none">點按鈕插入到訊息游標位置，可插入多個</p>
      </div>
    </div>
  )
}
