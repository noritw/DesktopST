import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Capacitor } from '@capacitor/core'
import { encodeLlmExportPayload } from '@core/llm/exportPayload'
import { PROVIDER_LABELS } from './providerInfo'
import { getData } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 把 AI 服務設定匯出給食記 App——**所有已經填金鑰的供應商都會帶走**，
 * 不是只有目前使用中那一組（owner 2026-08-25 要求：食記自己也能切供應商，
 * 只給目前那組的話，其他家還是得手動填）。
 *
 * 兩種傳遞管道，內容是同一段編碼字串：
 * - **QR**：跨裝置用（電腦／另一支手機的食記掃這支手機顯示的圖）。
 * - **分享**：同一支手機上兩個 App 之間用 Android 分享面板傳，不用開相機對自己螢幕掃。
 *
 * 只有本機模式看得到這個入口（見 `MainMenu.tsx` 的 filter）——
 * 遙控模式下金鑰屬於電腦，`exportLlmForNutrition()` 會直接擲 `not-supported`。
 */
export function NutritionExportView(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const [encoded, setEncoded] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [providerNames, setProviderNames] = useState<string[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await getData().settings.exportLlmForNutrition()
        if (cancelled) return
        if (!payload) {
          setState('empty')
          return
        }
        const text = encodeLlmExportPayload(payload)
        const qr = await QRCode.toDataURL(text, { margin: 1, width: 480 })
        if (cancelled) return
        setEncoded(text)
        setQrDataUrl(qr)
        setProviderNames(Object.keys(payload.keys).map((p) => PROVIDER_LABELS[p as keyof typeof PROVIDER_LABELS] ?? p))
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const share = async (): Promise<void> => {
    if (!encoded) return
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({
        title: '食記 AI 設定',
        text: encoded,
        dialogTitle: '傳給食記 App'
      })
    } catch {
      toast('分享失敗', 'error')
    }
  }

  return (
    <div className="space-y-4 pb-2">
      <p className="rounded-[14px] bg-[var(--bg)] px-3.5 py-2.5 text-[12px] leading-relaxed text-[var(--text-sub)]">
        把這支手機上<b>所有已經填過金鑰的 AI 供應商</b>（連同模型、端點）傳給食記 App，不用在食記裡逐家重填一次。
        {' '}<b>兩支手機都要有這支 QR 或分享對象</b>：
      </p>
      <ul className="list-disc space-y-1 pl-5 text-[12px] leading-relaxed text-[var(--text-sub)]">
        <li><b>不同裝置</b>（例如另一支手機、或電腦上的食記）：在食記的匯入畫面用相機掃下面這張 QR。</li>
        <li><b>同一支手機</b>（DeST 跟食記都裝在這支手機上）：不用掃碼，按下面的「分享給食記」，在跳出的分享面板裡選食記就好。</li>
      </ul>

      {state === 'loading' && (
        <p className="text-center text-[13px] text-[var(--text-sub)]">讀取中…</p>
      )}

      {state === 'empty' && (
        <p className="rounded-[14px] bg-[var(--bg)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-sub)]">
          目前還沒有任何供應商填過 API Key，沒有東西可以匯出。先到「設定」填好金鑰再回來。
        </p>
      )}

      {state === 'error' && (
        <p className="rounded-[14px] bg-[var(--bg)] px-3.5 py-2.5 text-[13px] leading-relaxed text-[var(--text-sub)]">
          讀取設定失敗，稍後再試一次。
        </p>
      )}

      {state === 'ready' && qrDataUrl && (
        <>
          {providerNames.length > 0 && (
            <p className="text-[12px] font-bold text-[var(--text)]">
              會帶走：{providerNames.join('、')}
            </p>
          )}

          <div className="flex justify-center rounded-[18px] bg-white p-4">
            <img src={qrDataUrl} alt="食記匯入 QR" className="h-auto w-full max-w-[280px]" />
          </div>

          {Capacitor.isNativePlatform() && (
            <button
              type="button"
              onClick={() => void share()}
              className="w-full rounded-full bg-[var(--mint)] px-4 py-3 text-[14px] font-bold text-[var(--text)]"
            >
              分享給食記
            </button>
          )}

          <p className="rounded-[14px] bg-[var(--bg)] px-3.5 py-2.5 text-[11px] leading-relaxed text-[var(--text-sub)]">
            這張 QR 跟分享出去的內容都包含你的 API Key 明碼，請不要截圖後轉傳或公開分享。
          </p>
        </>
      )}
    </div>
  )
}
