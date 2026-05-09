import type { Character } from '../../types'

interface Props {
  draft: Character
  setDraft: (next: Character | ((prev: Character) => Character)) => void
}

export default function AdvancedTab({ draft, setDraft }: Props) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs font-medium text-secondary">Scenario</span>
        <textarea
          className="input-field mt-1 min-h-[88px] resize-y"
          value={draft.scenario ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, scenario: e.target.value }))}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-secondary">System Prompt 覆寫</span>
        <textarea
          className="input-field mt-1 min-h-[88px] resize-y"
          placeholder="留空則使用全域 LLM 設定"
          value={draft.systemPromptOverride ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, systemPromptOverride: e.target.value }))}
        />
      </label>
      <label className="block">
        <span className="text-xs font-medium text-secondary">作者備註</span>
        <textarea
          className="input-field mt-1 min-h-[72px] resize-y"
          value={draft.creatorNotes ?? ''}
          onChange={e => setDraft(prev => ({ ...prev, creatorNotes: e.target.value }))}
        />
      </label>
    </div>
  )
}
