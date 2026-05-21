import { useState } from 'react'
import type { Character } from '../../types'

interface Props {
  draft: Character
  setDraft: (next: Character | ((prev: Character) => Character)) => void
}

export default function AdvancedTab({ draft, setDraft }: Props) {
  const [showExtra, setShowExtra] = useState(!!(draft.systemPromptOverride?.trim()))

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs font-semibold text-primary">場景（Scenario）</span>
        <p className="text-[11px] text-secondary mt-0.5">
          角色當下的處境、和使用者或其他角色之間的關係。例：「和{'{{user}}'}是青梅竹馬」「正坐在書房裡讀書」。
          可用標籤：<code>{'{{user}}'}</code>、<code>{'{{char}}'}</code>。
        </p>
        <textarea
          className="input-field mt-1 min-h-[88px] resize-y"
          value={draft.scenario ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, scenario: e.target.value }))}
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold text-primary">作者備註</span>
        <p className="text-[11px] text-secondary mt-0.5">
          給模型的額外提示，例如「常忘記今天星期幾」「不擅長拒絕別人」之類的小細節。會以 [Author Notes] 區塊注入 prompt。
        </p>
        <textarea
          className="input-field mt-1 min-h-[72px] resize-y"
          value={draft.creatorNotes ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, creatorNotes: e.target.value }))}
        />
      </label>

      <div className="pt-1 border-t border-border">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors"
          onClick={() => setShowExtra(v => !v)}
        >
          <span className={`transition-transform ${showExtra ? 'rotate-90' : ''}`}>▶</span>
          <span>額外系統指示（進階／SillyTavern 匯入）</span>
          {!showExtra && draft.systemPromptOverride?.trim() && (
            <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-teal" title="此欄有內容" />
          )}
        </button>

        {showExtra && (
          <div className="mt-2">
            <p className="text-[11px] text-secondary mb-1.5">
              進階用途：直接附加到 system prompt 的角色定義區塊，位置在角色名稱之後、個性描述之前。一般不需填寫；主要保留給 SillyTavern 卡片匯入時的 <code>system_prompt</code> 欄位。
            </p>
            <textarea
              className="input-field min-h-[88px] resize-y"
              placeholder="留空即可"
              value={draft.systemPromptOverride ?? ''}
              onChange={e => setDraft(prev => ({ ...prev, systemPromptOverride: e.target.value }))}
            />
          </div>
        )}
      </div>
    </div>
  )
}
