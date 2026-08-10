import { useCallback, useEffect, useRef, useState } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import type { PersonaPreset, ScenePreset, WorldPreset } from '@core/types'
import { DataError, type PresetListItem } from '@core/data'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { describeSettingsError } from '../settings/settingsErrors'

type Kind = 'scene' | 'persona' | 'world'
type Draft = PersonaPreset | WorldPreset | ScenePreset
const now = (): number => Date.now()

/** 自動撐高的 textarea（與 CharacterEditor 同款）。 */
function AutoTextarea({ minHeight = 72, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number }): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)
  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
  }
  useEffect(() => { grow() })
  return <textarea ref={ref} rows={1} style={{ minHeight, resize: 'none', overflow: 'hidden' }} className={`field ${className}`} onInput={grow} {...props} />
}

function blank(kind: Kind): Draft {
  const stamp = now()
  if (kind === 'persona') return { id: '', name: '', displayName: '', nickname: '', description: '', createdAt: stamp, updatedAt: stamp }
  if (kind === 'world') return { id: '', name: '', worldSetting: '', interactionExample: '', lorebookIds: [], createdAt: stamp, updatedAt: stamp }
  return { id: '', name: '', activePersonaId: '', activeWorldId: '', desktopCharacters: [], lorebookIds: [], moduleOverrides: {}, createdAt: stamp, updatedAt: stamp }
}

/** 三種預設組共用一個編輯器；資料通道只經 appStore 取得。 */
export function PresetEditor({ presetKey }: { presetKey: string }): JSX.Element {
  const [kind, id] = presetKey.split(':') as [Kind, string]
  const pop = useUiStore((s) => s.pop); const toast = useUiStore((s) => s.toast); const confirm = useUiStore((s) => s.confirm)
  const setCloseGuard = useUiStore((s) => s.setCloseGuard)
  const refresh = useAppStore((s) => s.refresh)
  const [draft, setDraft] = useState<Draft | null>(null); const [busy, setBusy] = useState(false)
  const [lorebooks, setLorebooks] = useState<{ id: string; name: string }[]>([])
  const [modules, setModules] = useState<{ id: string; label: string; enabled: boolean }[]>([])
  const [personas, setPersonas] = useState<PresetListItem[]>([])
  const [worlds, setWorlds] = useState<PresetListItem[]>([])
  const dirty = useRef(false)
  const [isDirty, setIsDirty] = useState(false)
  const mark = (): void => { dirty.current = true; setIsDirty(true) }
  const load = useCallback(async () => {
    try {
      const api = getData(); const fetched = id === 'new' ? blank(kind) : kind === 'persona' ? await api.presets.getPersona(id) : kind === 'world' ? await api.presets.getWorld(id) : await api.presets.getScene(id)
      setDraft(fetched)
      if (kind !== 'persona') setLorebooks(await api.lorebooks.list())
      if (kind === 'scene') {
        const [moduleList, personaList, worldList] = await Promise.all([
          api.settings.listModules(), api.presets.listPersonas(), api.presets.listWorlds()
        ])
        setModules(moduleList); setPersonas(personaList); setWorlds(worldList)
      }
    } catch (e) { toast(describeSettingsError(e, '載入預設組'), 'error') }
  }, [id, kind, toast])
  useEffect(() => { void load() }, [load])
  useEffect(() => { setCloseGuard(() => {
    if (!dirty.current) return true
    void (async () => { if (await confirm({ title: '還沒儲存', message: '要捨棄這些改動嗎？', confirmLabel: '捨棄', destructive: true })) { dirty.current = false; pop() } })()
    return false
  }); return () => setCloseGuard(null) }, [confirm, pop, setCloseGuard])
  const change = (next: Draft): void => { setDraft(next); mark() }
  const save = async (): Promise<void> => {
    if (!draft) return
    if (!draft.name.trim()) { toast('名稱不可空白', 'error'); return }
    setBusy(true); try {
      const api = getData().presets
      if (kind === 'persona') await api.savePersona(draft as PersonaPreset)
      else if (kind === 'world') await api.saveWorld(draft as WorldPreset)
      else await api.saveScene(draft as ScenePreset)
      dirty.current = false; setIsDirty(false)
      // 這個畫面關掉之後，`PersonaIdentity`／`CurrentContext` 那種常駐、不會重新
      // 掛載的元件是靠 snapshot 換了參照才知道要重抓清單——存檔／刪除不會自動
      // 觸發 state-invalidated，得自己呼叫一次，不然剛改的名字要等下次真正的
      // 狀態變動（切對話、重連……）才會顯示（owner 2026-08-05 實機回報）。
      await refresh(); toast('已儲存'); pop()
    } catch (e) { toast(describeSettingsError(e, '儲存'), 'error') } finally { setBusy(false) }
  }
  const remove = async (): Promise<void> => {
    if (!draft || id === 'new') return
    if (!await confirm({ title: `刪除「${draft.name}」`, message: '刪除後不能復原。', confirmLabel: '刪除', destructive: true })) return
    setBusy(true); try {
      const api = getData().presets
      if (kind === 'persona') await api.removePersona(id); else if (kind === 'world') await api.removeWorld(id); else await api.removeScene(id)
      dirty.current = false; setIsDirty(false)
      await refresh(); toast('已刪除'); pop()
    } catch (e) {
      // 這條路徑的 conflict 只有一種成因，直接講清楚 —— 共用文案會列出三種可能，
      // 使用者得自己猜是哪一種。
      const lastOne = e instanceof DataError && e.code === 'conflict' && kind !== 'scene'
      toast(lastOne ? `至少要留一組${kind === 'persona' ? '使用者設定' : '世界觀'}，最後一組不能刪。` : describeSettingsError(e, '刪除'), 'error')
    } finally { setBusy(false) }
  }
  if (!draft) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>
  const lore = 'lorebookIds' in draft ? draft.lorebookIds ?? [] : []
  const toggleLore = (bookId: string): void => change({ ...draft, lorebookIds: lore.includes(bookId) ? lore.filter(x => x !== bookId) : [...lore, bookId] } as Draft)
  return <div className="space-y-4 pb-2">
    {isDirty && <p className="text-xs text-[var(--text-sub)]">＊ 有未儲存的變更</p>}
    <Field label="名稱"><input className="field" value={draft.name} maxLength={60} onChange={e => change({ ...draft, name: e.target.value })} /></Field>
    {kind === 'persona' && <PersonaFields draft={draft as PersonaPreset} change={change} />}
    {kind === 'world' && <WorldFields draft={draft as WorldPreset} change={change} />}
    {kind === 'scene' && <SceneFields draft={draft as ScenePreset} change={change} lorebooks={lorebooks} modules={modules} personas={personas} worlds={worlds} toggleLore={toggleLore} />}
    {kind === 'world' && <LorePicker ids={lore} books={lorebooks} toggle={toggleLore} />}
    <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50">儲存</button>
    {id !== 'new' && <button type="button" disabled={busy} onClick={() => void remove()} className="w-full rounded-full border border-[var(--danger)] py-2.5 text-sm text-[var(--danger)] disabled:opacity-50">刪除</button>}
  </div>
}
function PersonaFields({ draft, change }: { draft: PersonaPreset; change: (x: Draft) => void }): JSX.Element { return <><Field label="顯示名稱"><input className="field" placeholder="你的名字" value={draft.displayName} onChange={e => change({ ...draft, displayName: e.target.value })} /></Field><Field label="暱稱"><input className="field" placeholder="主人、大人、小名..." value={draft.nickname} onChange={e => change({ ...draft, nickname: e.target.value })} /></Field><Field label="自我描述"><AutoTextarea minHeight={100} placeholder="讓角色更了解你..." value={draft.description} onChange={e => change({ ...draft, description: e.target.value })} /></Field></> }
function WorldFields({ draft, change }: { draft: WorldPreset; change: (x: Draft) => void }): JSX.Element { return <><Field label="世界觀"><AutoTextarea minHeight={120} placeholder="描述這個世界的背景設定..." value={draft.worldSetting} onChange={e => change({ ...draft, worldSetting: e.target.value })} /></Field><Field label="互動範例"><AutoTextarea minHeight={100} placeholder="角色之間如何互動的範例..." value={draft.interactionExample} onChange={e => change({ ...draft, interactionExample: e.target.value })} /></Field></> }
function SceneFields({ draft, change, lorebooks, modules, personas, worlds, toggleLore }: { draft: ScenePreset; change: (x: Draft) => void; lorebooks: {id:string;name:string}[]; modules: {id:string;label:string;enabled:boolean}[]; personas: PresetListItem[]; worlds: PresetListItem[]; toggleLore: (id:string)=>void }): JSX.Element { const overrides = draft.moduleOverrides ?? {}; return <><Field label="使用者設定"><select className="field" value={draft.activePersonaId} onChange={e => change({ ...draft, activePersonaId: e.target.value })}><option value="">沿用目前使用中的設定</option>{personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="世界觀"><select className="field" value={draft.activeWorldId} onChange={e => change({ ...draft, activeWorldId: e.target.value })}><option value="">沿用目前使用中的世界觀</option>{worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field><LorePicker ids={draft.lorebookIds ?? []} books={lorebooks} toggle={toggleLore} /><Field label="模組開關覆蓋" hint="未選擇就是跟隨全域設定。">{modules.map(m => <div key={m.id} className="mb-2 flex items-center justify-between text-sm"><span>{m.label}</span><select className="rounded border border-[var(--border)] bg-[var(--bg)] p-1" value={overrides[m.id] ?? ''} onChange={e => { const next = { ...overrides }; if (e.target.value) next[m.id] = e.target.value as 'on'|'off'; else delete next[m.id]; change({ ...draft, moduleOverrides: next }) }}><option value="">跟隨全域</option><option value="on">強制開啟</option><option value="off">強制關閉</option></select></div>)}</Field></> }
function LorePicker({ ids, books, toggle }: { ids: string[]; books: {id:string;name:string}[]; toggle: (id:string)=>void }): JSX.Element { return <Field label="用語解說">{books.length ? <div className="space-y-1">{books.map(b => <label key={b.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(b.id)} onChange={() => toggle(b.id)} />{b.name}</label>)}</div> : <p className="text-xs text-[var(--text-sub)]">尚無用語解說</p>}</Field> }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element { return <label className="block text-sm text-[var(--text)]"><span className="mb-1 block font-medium">{label}</span>{hint && <span className="mb-1 block text-xs text-[var(--text-sub)]">{hint}</span>}{children}</label> }
