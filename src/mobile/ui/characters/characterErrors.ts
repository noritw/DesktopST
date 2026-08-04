import { DataError } from '@core/data'
import { AvatarFileError } from './avatarFile'

/**
 * 角色相關操作的錯誤文案（階段 3）。
 *
 * 與 `appStore.describeError` 分開，是因為那支講的是「訊息送不出去／畫面載不到」，
 * 這裡講的是「這張卡怎麼了」—— 同一個 `invalid-input` 在兩邊要說的話完全不同：
 * 那邊是「圖片太大」，這邊多半是「名稱空白」或「這不是一張角色卡」。
 *
 * **core 只給代碼，翻中文一律在 UI**（roadmap §3.3）。
 */
export function describeCharacterError(e: unknown, action: string): string {
  if (e instanceof AvatarFileError) {
    switch (e.code) {
      case 'bad-format':
        return '請選 PNG、JPG、GIF 或 WEBP 圖片'
      case 'too-large':
        return '圖片太大了（上限 10 MB），換一張小一點的'
      default:
        return '這個檔案讀不出來，可能已經損毀'
    }
  }

  const code = e instanceof DataError ? e.code : 'unknown'
  switch (code) {
    case 'unreachable':
      return `${action}失敗：連不上電腦。請確認電腦已開機且 DeST 正在執行。`
    case 'unauthorized':
      return `${action}失敗：連線權杖失效，請重新掃描 QR code。`
    case 'not-found':
      return `${action}失敗：找不到這個角色，可能已經在電腦上被刪掉了。`
    case 'invalid-input':
      return `${action}失敗：內容不符合限制（角色名稱不可空白；匯入的檔案要是角色卡或 .dstpack）。`
    case 'not-supported':
      return `${action}失敗：這台電腦上的 DeST 版本還不支援，請更新到新版。`
    default:
      return `${action}失敗，請再試一次。`
  }
}
