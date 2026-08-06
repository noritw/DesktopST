import { DataError } from '@core/data'

/**
 * 遙控操作的錯誤文案（B6）。與 `settingsErrors.ts` 分開是因為這裡
 * `unauthorized` 專指「這個能力被桌面設定關掉，或這台裝置不在白名單裡」——
 * 不是連線權杖失效（那個情境下整個畫面早就進不來了）。
 */
export function describeRemoteError(e: unknown, action: string): string {
  const code = e instanceof DataError ? e.code : 'unknown'
  switch (code) {
    case 'unreachable':
      return `${action}失敗：連不上電腦。請確認電腦已開機且 DeST 正在執行。`
    case 'unauthorized':
      return `${action}失敗：這個功能目前被電腦端關閉，或這台裝置不在允許清單裡。`
    case 'invalid-input':
      return `${action}失敗：參數不符合限制。`
    case 'not-found':
      return `${action}失敗：找不到目標（可能已經關閉或消失）。`
    case 'not-supported':
      return `${action}失敗：這台電腦上的 DeST 版本還不支援，請更新到新版。`
    default:
      return `${action}失敗，請再試一次。`
  }
}
