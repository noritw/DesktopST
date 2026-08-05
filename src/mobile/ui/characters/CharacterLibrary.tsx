import { useCallback, useEffect, useState } from 'react'
import type { CharacterListItem } from '@core/data'
import { getData, useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { describeCharacterError } from './characterErrors'
import { downloadBytes, pickFile } from '../shell/fileTransfer'

/**
 * 角色庫（決議④：手機要能自己建角色，不然「不需要電腦」不成立）。
 *
 * 與「這次對話有誰在場」（`PresenceSheet`）是**兩件事，刻意分開**：
 * 這裡管的是「有哪些角色存在」，那裡管的是「這次對話誰上場」。
 * 合成一頁的話，刪除與移出會長得一模一樣但後果差很多 ——
 * 同一種坑在 `docs/news-future-keyword-groups.md` §8 記過一次了。
 */
export function CharacterLibrary(): JSX.Element {
  const push = useUiStore((s) => s.push)
  const toast = useUiStore((s) => s.toast)
  const confirm = useUiStore((s) => s.confirm)
  const refresh = useAppStore((s) => s.refresh)
  const presentIds = new Set(useAppStore((s) => s.snapshot?.presentCharacters ?? []).map((c) => c.id))

  const [list, setList] = useState<CharacterListItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setFailed(false)
    try {
      setList(await getData().characters.list())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async (): Promise<void> => {
    const name = await useUiStore.getState().prompt({
      title: '新角色',
      message: '先取個名字，其他之後再慢慢填。',
      defaultValue: '新角色',
      confirmLabel: '建立'
    })
    if (name === null) return
    setBusy(true)
    try {
      const char = await getData().characters.create(name)
      await load()
      push('character-editor', char.id)
    } catch (e) {
      toast(describeCharacterError(e, '建立角色'), 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 匯入：PNG 角色卡、JSON 角色卡、DST Pack 三種吃同一個入口。 */
  const importFile = async (): Promise<void> => {
    // 副檔名給桌面瀏覽器看，MIME 給 Android 看（見 `pickFile` 的說明）——
    // 只寫副檔名的話，`.dstpack` 在 Android 對映不到任何格式，檔案會整片不能選。
    // `application/octet-stream` 是 `.dstpack` 這種自訂副檔名唯一涵蓋得到的類別。
    // 判斷實際是哪一種仍然看檔名（下面的 `lower.endsWith`），accept 只管「選得到」。
    const file = await pickFile('.png,.json,.dstpack,image/png,application/json,application/octet-stream')
    if (!file) return
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.dstpack')) {
        // 桌面版會逐一彈對話框問衝突怎麼辦；手機端**先問一次、整包套用** ——
        // 電腦前面沒有人，彈框等於讓手機這頭卡住。
        const overwrite = await confirm({
          title: '匯入角色包',
          message: '如果裡面有本機已經存在的角色（同 id 或同名），要覆蓋本機那份嗎？\n選「不覆蓋」的話那幾隻會被略過。',
          confirmLabel: '覆蓋'
        })
        const r = await getData().characters.importPack(bytes, {
          onConflict: overwrite ? 'overwrite' : 'skip',
          // 世界觀與使用者資料屬於預設組，在這裡靜靜換掉會嚇到人（而且手機上看不出來哪裡變了）。
          applyGlobalSettings: false
        })
        toast(`匯入 ${r.imported} 隻角色${r.skipped ? `，略過 ${r.skipped} 隻` : ''}`)
      } else {
        const char = await getData().characters.importCard({
          bytes,
          kind: lower.endsWith('.json') ? 'json' : 'png'
        })
        toast(`已匯入「${char.name}」`)
      }
      await Promise.all([load(), refresh()])
    } catch (e) {
      toast(describeCharacterError(e, '匯入'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const exportPack = async (): Promise<void> => {
    if (!list || list.length === 0) return
    setBusy(true)
    try {
      const file = await getData().characters.exportPack(
        list.map((c) => c.id),
        // 用語解說預設不外流（規格 §7.3：那是私人資料）。
        { includeGlobalSettings: false, includeLorebooks: false }
      )
      downloadBytes(file.bytes, file.filename)
      toast('已匯出角色包')
    } catch (e) {
      toast(describeCharacterError(e, '匯出'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (failed) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--text-sub)]">載入角色清單失敗</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 rounded-full bg-[var(--mint)] px-5 py-2 text-sm text-[var(--text)]"
        >
          重試
        </button>
      </div>
    )
  }

  if (!list) return <div className="py-8 text-center text-sm text-[var(--text-sub)]">載入中⋯⋯</div>

  return (
    <div className="pb-2">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="flex-1 rounded-full bg-[var(--mint)] py-2.5 text-sm text-[var(--text)] disabled:opacity-50"
        >
          ＋ 新角色
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void importFile()}
          className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text-sub)] disabled:opacity-50"
        >
          匯入⋯
        </button>
      </div>

      {list.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-sub)]">還沒有任何角色，先建一隻吧。</p>
      ) : (
        list.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => push('character-editor', item.id)}
            className="mb-2 flex w-full items-center gap-3 rounded-[14px] bg-[var(--bg)] px-3 py-2.5 text-left active:opacity-70"
          >
            <Avatar characterId={item.id} size={38} />
            <span className="min-w-0 flex-1 truncate text-[15px] text-[var(--text)]">{item.name}</span>
            {presentIds.has(item.id) && (
              <span className="shrink-0 rounded-full bg-[var(--mint2)] px-2 py-0.5 text-[11px] text-[var(--text)]">
                在場
              </span>
            )}
            <span className="shrink-0 text-[var(--text-sub)]">›</span>
          </button>
        ))
      )}

      {list.length > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportPack()}
          className="mt-2 w-full rounded-full border border-[var(--border)] py-2.5 text-sm text-[var(--text-sub)] disabled:opacity-50"
        >
          匯出全部角色（.dstpack）
        </button>
      )}
    </div>
  )
}
