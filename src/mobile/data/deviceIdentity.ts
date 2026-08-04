/**
 * 裝置識別（清單 G8，**遙控專屬**）。
 *
 * 電腦端會在 prompt 前面加一行 `[from: 裝置名稱]`，讓角色知道這句話是從哪裡說的
 * （`ipcHandlers.ts` 的 `sourceDeviceName`）。名稱來自兩個 HTTP header；
 * **沒送的話電腦端會退回預設值 `'Desktop'`**，角色就會以為你是在電腦前面打字。
 *
 * 獨立模式不需要這個 —— 沒有「從哪台送來」的問題，所以這支只有遙控實作會用。
 */

const ID_KEY = 'dest.deviceId'
const NICKNAME_KEY = 'dest.deviceNickname'

/**
 * 預設暱稱。
 *
 * ⚠️ **不要用 `'unnamed'`**：電腦端看到這個字會改用裝置 id，
 * 角色收到的就會是一長串 UUID（`mobileServer.getDeviceDisplayNameFromRequest`）。
 *
 * 使用者可在設定裡改（階段 4）。在那之前一律是這個。
 */
const DEFAULT_NICKNAME = '手機'

export interface DeviceIdentity {
  id: string
  nickname: string
}

/**
 * 取得（必要時建立）本機裝置識別。
 *
 * id 只是為了在電腦端的遙控紀錄裡分辨來源，不是憑證 —— 認證走 token。
 * 因此用 `crypto.randomUUID()` 就夠，不需要與任何東西對應。
 */
export function getDeviceIdentity(store: Storage = localStorage): DeviceIdentity {
  let id = ''
  let nickname = ''
  try {
    id = store.getItem(ID_KEY) ?? ''
    nickname = store.getItem(NICKNAME_KEY) ?? ''
  } catch {
    // 無痕模式或儲存被停用：每次都給一個新的，功能不因此中斷。
  }

  if (!id) {
    id = crypto.randomUUID()
    try {
      store.setItem(ID_KEY, id)
    } catch {
      /* 存不進去就算了，下次再產一個 */
    }
  }

  return { id, nickname: nickname.trim() || DEFAULT_NICKNAME }
}

export function setDeviceNickname(nickname: string, store: Storage = localStorage): void {
  try {
    store.setItem(NICKNAME_KEY, nickname.trim())
  } catch {
    /* 同上 */
  }
}

/**
 * 把暱稱編成可以放進 HTTP header 的形式。
 *
 * ⚠️ **header 只能是 ASCII**，中文暱稱（例如預設的「手機」）直接塞進去
 * 會讓整個請求送不出去。電腦端會 `decodeURIComponent` 解回來。
 */
export function encodeNicknameHeader(nickname: string): string {
  return encodeURIComponent(nickname)
}
