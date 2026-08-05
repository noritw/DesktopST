import { DataError } from '@core/data'

/**
 * 設定相關操作的錯誤文案（B3 階段 4）。
 *
 * 與 `appStore.describeError`（聊天）、`characterErrors.ts`（角色卡）分開，
 * 是因為同一個代碼在這裡要講的話又不一樣——`invalid-input` 多半是數值超出範圍，
 * `conflict` 這裡專指「API Key 只能在區網直連時修改」（見 `mobileServer.ts`
 * 的 `/api/settings/llm-apikey`）。**core 只給代碼，翻中文一律在 UI**（roadmap §3.3）。
 */
export function describeSettingsError(e: unknown, action: string): string {
  const code = e instanceof DataError ? e.code : 'unknown'
  switch (code) {
    case 'unreachable':
      return `${action}失敗：連不上電腦。請確認電腦已開機且 DeST 正在執行。`
    case 'unauthorized':
      return `${action}失敗：連線權杖失效，請重新掃描 QR code。`
    case 'conflict':
      return `${action}失敗：API Key 只能在與電腦同一個區網時修改，經中繼連線時不行。`
    case 'invalid-input':
      return `${action}失敗：內容不符合限制（例如數值超出範圍、名稱空白）。`
    case 'not-supported':
      return `${action}失敗：這台電腦上的 DeST 版本還不支援，請更新到新版。`
    default:
      return `${action}失敗，請再試一次。`
  }
}
