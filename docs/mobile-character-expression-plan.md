# 手機版對話記錄換表情 ＋ 手動指定表情 —— 設計文件

> **建立時間**：2026-08-22。
> **狀態**：規格已定案，待實作。
> **這份文件是 `docs/mobile-android-widget-plan.md` 的前置依賴**：小工具要顯示
> 「框選過的臉部特寫」，而框選這個動作現在**同時服務對話記錄與小工具**，
> 所以框選 UI／儲存格式的設計搬來這份文件，小工具那份文件改成直接引用這裡。
>
> ⚠️ **這份文件推翻一個舊決策**：`src/mobile/ui/characters/CharacterEditor.tsx`
> 檔頭註解與 `docs/b3-mobile-ui-plan.md` §3.1／§5.1 寫著「情緒圖片那一頁不做，
> 手機版是單張主圖免表情差分，這是範圍決定不是資料缺口」——那是 2026-08 初
> 的決議，owner 2026-08-22 改變主意，這份文件的內容以**現在**為準。**不要**
> 因為看到那句舊註解就以為這是在做本來被否決的東西——是 owner 重新拍板，
> 不是接手 AI 誤讀規格。
>
> **2026-08-22（續）owner 再追加一項**：手機端也要能新增／指定表情圖片本身
> （不只是框選既有圖片的顯示範圍），理由是「可能有人拿去平板上用，畫完就
> 直接指定過來」——這比原本規劃的範圍更大一步，等於把桌面版
> `EmotionSpritesTab.tsx` 那套「上傳圖片＋分配情緒」的功能也搬一份到手機，
> 已併入 §3.3／§6.4。

---

## 1. 需求（owner 原話，2026-08-22）

> 手機版 DeST 我希望對話記錄頭像的部分也能換表情，同樣採用框選臉部的範圍
> （也就是同個框選範圍用在對話記錄和小工具）；手機版也希望能給每則對話
> 手動換表情，避免 AI 選出來的表情不是我要的；沒有表情變化的角色卡或者
> 沒有框選臉部的，在手機上就還是走預設顯示。

拆解成三件事：

1. **對話記錄的頭像跟著訊息的 `emotion` 換圖**（目前手機聊天畫面完全沒有
   這個機制，`useAvatarUrl.ts` 只回傳固定的主圖，見 §2）。
2. **换表情時，顯示的圖要先套用「框選臉部範圍」再顯示**，而且這個框選範圍
   **跟小工具共用同一份設定**——使用者只框一次，兩個地方都生效。
3. **使用者可以手動幫某一則訊息指定要顯示哪張表情圖**，蓋過 AI 判斷的
   `emotion` 結果（AI 判斯可能跟訊息內容的情緒對不上）。
4. **降級規則**：角色卡沒有設定任何 `emotions`／`spriteIds`，或使用者沒有
   框選過臉部範圍 → 維持現有行為（顯示主圖 `avatar`，不裁切）——**不是**
   「沒框選就不能用這個功能」，是「沒框選的部分就簡單處理，不強迫使用者
   一定要先做設定才能用」。
5. **手機端也能新增／指定表情圖片**（owner 追加，見文件開頭）：使用者可以
   直接在手機上傳一張圖（例如平板上剛畫完的圖），指定給某個情緒 key，
   這張圖從此就是 `character.emotions[key]`——**這是真正的角色卡內容變更**，
   跟桌面版新增/替換表情圖片是同一件事，只是操作介面搬到手機，見 §3.3。

---

## 2. 現況：手機聊天畫面目前怎麼顯示頭像

`src/mobile/ui/characters/useAvatarUrl.ts` 的 `useAvatarUrl(id)` 只認
角色 id，回傳值來自 `DataSource.avatarUrl(id)`（`core/data/types.ts:284`）
——**沒有任何管道可以指定要哪張表情圖**，獨立模式與遙控模式的實作都只讀
`character.avatar` 這一張圖。訊息列表（聊天泡泡）目前顯示的頭像因此
**跟訊息內容、跟 `message.emotion` 完全無關**，每一則同一個角色的訊息用的
都是同一張圖。

`Message` 型別（`core/types.ts:100`）本來就有 `emotion?: string` 欄位——
桌面版早就在用（配合 `character.emotions`／`spriteIds` 換桌寵表情），
只是手機端從來沒有讀過這個欄位來決定要顯示哪張圖。**這次不用新增
`emotion` 欄位本身，資料早就在那裡，只是手機沒有消費它。**

---

## 3. 資料模型

### 3.1 框選臉部範圍（對話記錄與小工具共用）

> ⚠️ **2026-08-25 附註：本節「mobile-only」推翻**。owner 要求桌面角色庫縮圖
> 也套用同一套框選範圍，而且要真的跨裝置同步——`faceCrop` 現在雙端各自存一份
> 本地檔案（手機仍是 `character-display-config.json`，桌面是
> `main/fileStore.ts` 的 `loadCharacterDisplayConfig`/`saveCharacterDisplayConfig`），
> 靠 S2 新同步種類 `characterDisplay`（`core/sync/pair.ts` 的 `KINDS`）對齊內容，
> 走法比照 `docs/reminder-sync-kickoff.md` 的提醒同步。下面「為什麼是
> mobile-only」那條理由**已經不成立**，看到時不要照舊決策行事——細節見
> `core/store/keys.ts` 的 `CHARACTER_DISPLAY_CONFIG_KEY` 附註與
> `core/sync/` 的 `characterDisplayContentHash()`／`characterDisplay` 種類。

新檔：`character-display-config.json`（單一檔案，key 是 characterId）：

```ts
interface CharacterDisplayConfig {
  /** 框選的臉部矩形，比例座標（0–1），套用到這個角色的主圖與所有表情圖。 */
  faceCrop?: { x: number; y: number; size: number }
}
type CharacterDisplayConfigMap = Record<string, CharacterDisplayConfig>
```

- **為什麼是 mobile-only、不進 `Character` 型別**：跟 `docs/mobile-android-widget-plan.md`
  §2.2 A 層當初的理由一樣——這是「手機想怎麼呈現」的裝置偏好，桌面版沒有
  這個概念（桌面桌寵本來就是全身圖），不需要牽動 `core/sync/contentHash.ts`／
  `stCardMapper.ts`／S1／S2／搬家包。`core/store/keys.ts` 加一個新 key
  常數，比照 `PINNED_NOTES_KEY` 的寫法。
- **框選 UI 沿用既有的頭像裁切元件**：`src/mobile/ui/characters/AvatarCropView.tsx`
  ＋ `avatarCropMath.ts`（純函式，覆蓋縮放＋拖曳平移）。角色編輯器新增
  「顯示設定」區塊，按鈕「框選臉部顯示範圍」，帶入角色目前的 `avatar`
  （或任一張已有的表情圖）當裁切來源圖，存檔前把 `computeCropRect()` 回傳的
  絕對像素 `sx`/`sy`/`sSize` 除以原圖寬高換成比例（`x = sx/naturalW` 等），
  好處是同一組比例可以套用到所有表情圖（假設同一角色的表情圖彼此構圖一致，
  即同一套人設美術只是換臉，ST 風格的表情包通常如此）。
- **這份設定同時被兩個地方讀**：§4 的 `resolveDisplayEmotionImage()`（對話
  記錄用）與 `docs/mobile-android-widget-plan.md` 的 `refreshWidgetCache()`
  （小工具 Bridge 用）——**只寫一份邏輯**（下面 §4 的純函式），不要兩邊
  各自算一次裁切矩形。

### 3.2 手動指定表情（訊息層級，正常隨對話同步）

`core/types.ts` 的 `Message` 型別新增：

```ts
/** 使用者手動指定要顯示的表情（覆蓋 AI 判斷的 `emotion`，只影響顯示，不影響已送出的 prompt）。 */
emotionOverride?: string
```

- **這是普通的 `Message` 欄位，不是 mobile-only 資料**——訊息整包同步時
  （`convPair.ts`／S1／S2 對話同步）本來就是整個 `Message` 物件一起帶走，
  加一個欄位不需要碰任何同步引擎的程式碼，桌面端如果哪天想讀這個欄位
  （例如桌寵表情也吃使用者手動指定），一樣不用改同步邏輯。
- **這次只做「顯示層」消費這個欄位**：不影響下一輪 LLM prompt（`emotion`
  欄位原本用途不變，`emotionOverride` 純粹是「畫面上想看哪張圖」）、
  也不影響桌面版現有的桌寵表情渲染（桌面這次不接這個欄位，只是資料庫欄位
  已經有了，之後想接是很小的增量）。
- **顯示優先序**：`emotionOverride ?? emotion`——有手動指定就用手動指定的，
  沒有就退回 AI 判斷的原值。

### 3.3 手機新增／指定表情圖片（真正的角色卡內容，正常隨 S1/S2/搬家包同步）

跟 §3.1／§3.2 都不一樣——**這是角色卡本身的內容**（`character.emotions`／
`spriteIds`），不是裝置偏好，也不是訊息層資料。桌面版已經有一整套機制，
手機這次是**照搬同一套資料模型**，只是另外做一個手機自己的操作介面。

**桌面版現況（先讀懂，不要另外發明一套）**：
`src/renderer/src/components/tabs/EmotionSpritesTab.tsx` ＋
`src/renderer/src/utils/emotionUtils.ts` 的 `EMOTION_OPTIONS`（28 個固定
情緒 key，`en`／`zh` 對照，例如 `joy`/喜悅、`anger`/憤怒⋯）。使用者選檔案
→ IPC `character:save-emotion-sprite`（`{ id, filename, buffer, ext }`）
存檔、回傳圖片相對路徑 → 前端把 `draft.emotions[選的情緒 key] = 那個路徑`。
一張圖可以同時分配給多個情緒 key（`assignedEmotions: string[]`）。

**`EMOTION_OPTIONS` 要先搬到 `core/`**（新檔，可以跟 §4 的
`resolveDisplayImagePath()` 放同一支 `core/character/`，例如
`core/character/emotionCatalog.ts`），`renderer/src/utils/emotionUtils.ts`
改成從那裡 re-export，手機端直接 import 同一份——**不要在手機端另外
抄一份 28 個 key 的清單**，兩邊字面（`en`/`zh`）只要有一個字打錯，
使用者在手機挑的情緒名稱跟桌面看到的名稱就會兜不起來。

**手機端新增流程**（角色編輯器「顯示設定」區塊，跟 §3.1 框選 UI 相鄰）：

1. 列出 `EMOTION_OPTIONS` 的每個 key，已經有圖的顯示縮圖（套用 §3.1 的
   `faceCrop`，跟聊天泡泡/小工具看到的裁切結果一致）＋「更換」；沒有圖的
   顯示「新增」。
2. 選檔案／拍照（比照既有的 `avatarFile.ts`／`prepareAvatar()` 那套挑檔
   邏輯，格式/大小限制照抄 `EmotionSpritesTab.tsx` 的 `MAX_BYTES`／
   `isAllowedImageExt`）。
3. 存檔：**獨立模式**新增 `session.saveEmotionSprite(characterId, emotionKey, bytes, ext)`
   ——照抄 `session.ts` 既有的 `avatarPath = keys.characterDirKey(id)/avatar.png`
   那個寫法，改存到例如 `characters/<id>/emotions/<key>.png`（新的子路徑，
   跟桌面端目前的檔案佈局要對得起來——**動工前先看桌面端
   `character:save-emotion-sprite` 實際存去哪個相對路徑**，兩邊必須一致，
   `core/store/keys.ts` 的檔案佈局規則見 CLAUDE.md「檔案佈局兩邊必須一致」
   那條）；**遙控模式**新增 `/api/characters/save-emotion-sprite` 端點，
   比照桌面 IPC handler 的邏輯搬一份到 `mobileServer.ts`（或直接讓端點呼叫
   同一支 `saveEmotionSprite` 桌面函式，能重用就不要複製）。
4. 存檔成功後更新 `character.emotions[key]`（同步走既有的角色卡儲存管道，
   不需要另開流程——這就是編輯角色卡的一部分，跟改名字、改人設是同一種
   操作）。

**這是真正的內容，會走 S1/S2/搬家包**：不像 §3.1 的 `faceCrop`，這裡存的
圖片路徑是 `Character.emotions` 本身，跟桌面版新增的表情圖片完全等價——
手機新增一張表情圖之後，S1 從電腦重新拉設定／S2 同步／匯出搬家包都會照
既有的角色卡邏輯把這張圖帶著走，不需要為它另外設計同步規則。

---

## 4. 顯示邏輯：`resolveDisplayEmotionImage()`（新的共用純函式）

放在 `src/core/character/displayImage.ts`（新檔，純 TS，不吃 electron／fs，
比照 `CLAUDE.md` §2 的 `core/` 規則）：

```ts
interface DisplayImageResult {
  /** 要讀的圖片相對路徑：character.avatar 或 emotions[key] 其中一個。 */
  path: string
  /** 有沒有找到對應這個 emotion 的專屬圖片（false＝退回主圖）。 */
  matchedEmotion: boolean
}

function resolveDisplayImagePath(
  character: Pick<Character, 'avatar' | 'emotions' | 'spriteIds'>,
  emotion: string | undefined
): DisplayImageResult {
  const key = emotion && (character.emotions?.[emotion] ?? character.spriteIds?.[emotion])
  return key ? { path: key, matchedEmotion: true } : { path: character.avatar, matchedEmotion: false }
}
```

裁切矩形的套用（§3.1 的 `faceCrop`）由讀圖那一層做（獨立模式：
`session.avatarDataUrl()` 這類方法讀完 binary 後，若有 `faceCrop` 就用
canvas 依比例裁切成正方形再轉 `data:` URL；遙控模式：讀取端點回傳完整圖後
一樣在手機端用 canvas 裁切——**裁切永遠在手機端做，不需要伺服器/桌面端
知道「這支手機框選了什麼」**，這樣桌面端完全不用改。

**降級規則直接由這支函式的邏輯保證**：`emotion` 是 `undefined`、或角色卡
`emotions`／`spriteIds` 裡沒有這個 key → `matchedEmotion: false` → 用
`avatar`；`faceCrop` 沒設定 → 完全不裁切，原圖直接顯示。兩個降級是獨立的
（可能「换到表情圖了但沒框選」→ 顯示未裁切的表情圖整張）。

---

## 5. 資料源方法擴充

`core/data/types.ts` 的 `DataSource` 介面新增：

```ts
/** 依訊息決定要顯示的表情圖（已套用 §3.1 框選，找不到對應表情圖時回傳主圖）。 */
characterDisplayImageUrl(characterId: string, emotion: string | undefined): Promise<string | null>
```

- **獨立模式**（`localDataSource`）：呼叫 `session.characterDisplayImageUrl()`
  （新方法，仿照既有 `avatarDataUrl()` 的寫法，改讀 `resolveDisplayImagePath()`
  算出的路徑，再套 `character-display-config.json` 的 `faceCrop`）。
- **遙控模式**（`remoteDataSource`）：現有 `/api/avatar/:id` 端點加一個
  可選 query `?emotion=xxx`，伺服端一樣呼叫 `resolveDisplayImagePath()`
  決定要吐哪一張圖的位元組——**裁切仍然在手機端做**（伺服端只負責給對的
  原圖，不需要知道手機的框選設定，見 §4 最後一段的理由）。
  `GET /api/avatar/:id/:emotion` 這種路徑寫法都可以，跟現有端點的既有慣例
  一致即可，不用堅持哪一種。
- **快取 key 要包含 emotion**：`useAvatarUrl.ts` 的 `cache: Map<string, …>`
  現在 key 只有 `characterId`，改用 `characterId + '|' + (emotion ?? '')`，
  否則同一支手機同時開著兩則不同表情的訊息會互相蓋掉彼此的快取。

---

## 6. UI 改動

### 6.1 聊天泡泡（顯示用）

聊天泡泡目前用 `useAvatarUrl(characterId)` 取頭像網址的地方，改用新的
`useCharacterDisplayImage(characterId, effectiveEmotion)`
（`effectiveEmotion = message.emotionOverride ?? message.emotion`），
其餘渲染邏輯不變（一樣是 `<img>`，只是網址/data URL 來源换了）。

### 6.2 手動換表情（訊息選單）

`src/mobile/ui/chat/MessageMenu.tsx`（已有「重新發送／編輯／刪除」）
新增一項「換表情」：

- **只在 `message.role === 'character'` 且該角色 `emotions`／`spriteIds`
  非空時顯示**（跟現有「只有使用者訊息能重新發送」同一種角色限定寫法，
  沒有表情圖的角色顯示這個選項毫無意義，直接不顯示比顯示了按下去又沒反應好）。
- 點下去開一個簡單的表情選擇畫面：所有 `emotions`／`spriteIds` 的 key
  各自顯示一張小縮圖（已套用 §3.1 框選，跟聊天泡泡、小工具看到的是同一張
  裁切結果，使用者選的時候就知道會長怎樣）＋ 一個「跟隨 AI 判斷」選項
  （清掉 `emotionOverride`，回到看 `message.emotion`）。
- 存檔走新方法：獨立模式呼叫 `session` 既有的訊息更新管道（比照
  `messages.edit()` 的寫法，改成 `messages.setEmotionOverride(messageId, emotion | null)`）；
  遙控模式新增 `/api/messages/set-emotion` 端點（比照現有 `/api/messages/edit`
  等端點的既有寫法）。**跟 `MessageMenu.tsx` 檔頭註解的既有規則一樣**：
  這支端點做完後要自己 `refresh()`，`/api/messages/*` 不會推 WebSocket 事件。

### 6.3 框選 UI（角色編輯器）

角色編輯器新增「顯示設定」區塊（跟現有頭像上傳區塊相鄰即可），框選部分
內容見 §3.1。

### 6.4 新增／指定表情圖片 UI（角色編輯器，§3.3）

同一個「顯示設定」區塊（或緊鄰的獨立區塊，UI 排版由實作時決定）新增
28 個情緒 key 的縮圖清單＋選檔/拍照上傳，流程見 §3.3。**這次不再受舊決議
限制**——舊決議「情緒圖片那一頁不做」已經被 owner 2026-08-22 明確推翻
（見文件開頭），手機角色卡現在跟桌面版一樣可以直接新增/替換表情圖片。

---

## 7. 已知風險 / 之後會踩的坑

- **CapacitorHttp 相關既有踩坑全部適用**（`CLAUDE.md` §5）：遙控模式抓
  表情圖位元組要走注入的 `HttpAdapter`，不要另外裸寫 `fetch`。
- **快取 key 忘記帶 emotion 會導致表情圖顯示錯亂**（§5 最後一點）——這是
  最容易漏掉的地方，`useAvatarUrl.ts` 現有的 `invalidateAvatar()`／
  `invalidateAllAvatars()` 這兩支「全部清掉重問」的函式邏輯不用改，
  但快取本身的 key 結構要改。
- **`emotionOverride` 不要跟 `emotion` 混寫進同一個欄位**——覆蓋是「使用者
  想看哪張圖」，`emotion` 是「AI 當時判斷的情緒」，這兩者語意不同，混在一起
  的話「跟隨 AI 判斷」這個還原選項就沒辦法實作（分不清楚原始值是什麼）。
- **裁切矩形套用到不同構圖的表情圖可能會歪**（跟 `mobile-android-widget-plan.md`
  §3 同一條已知限制，MVP 刻意接受，不做「每張表情圖各自框選」）。
- **這份文件只處理「顯示」，不處理「這則訊息的表情要不要影響下一句 AI 的
  判斷」**——`emotionOverride` 目前的定位純粹是使用者端的顯示偏好，若之後
  owner 希望這個手動指定也回饋給 LLM（例如「使用者覺得這句應該是開心，
  下次類似情境多往這個方向判斷」），那是全新的功能，不在這次範圍。
- **§3.3 手機端存表情圖的相對路徑一定要跟桌面端的檔案佈局一致**——動工前
  務必先讀桌面 `character:save-emotion-sprite` 的 IPC handler 實際存到哪個
  相對路徑，不要憑空決定一個新路徑；兩邊佈局對不起來的話，S1/S2/搬家包
  帶過去的圖片路徑會在另一個平台上讀不到檔案（CLAUDE.md 開頭就強調過
  「檔案佈局兩邊必須一致」）。
- **`EMOTION_OPTIONS` 只能有一份**——搬去 `core/` 之後，桌面 `emotionUtils.ts`
  要改成 re-export 而不是繼續維護自己的複本，否則兩邊清單遲早會不同步
  （這個專案已經在 `contentHash.ts`／`syncManifest.ts` 那幾次教訓裡反覆
  出現同一種坑：兩份「應該永遠相同」的清單/邏輯，一份改了另一份忘記改）。

---

## 8. 實作步驟順序

1. `core/types.ts`：`Message` 加 `emotionOverride?: string`。
2. `core/character/emotionCatalog.ts`（新檔）：把 `EMOTION_OPTIONS`／
   `emotionLabel()` 從 `renderer/src/utils/emotionUtils.ts` 搬過來；
   `emotionUtils.ts` 改成 re-export，桌面既有呼叫端不用改。
3. `core/character/displayImage.ts`（新檔）：`resolveDisplayImagePath()`。
4. `core/store/keys.ts`：新增 `CHARACTER_DISPLAY_CONFIG_KEY` 常數。
5. `mobile/ui/characters/CharacterEditor.tsx`：「顯示設定」區塊——
   §3.1 框選（重用 `AvatarCropView.tsx`／`avatarCropMath.ts`，存
   `character-display-config.json`）＋ §3.3 表情圖片新增/替換清單
   （讀桌面 `character:save-emotion-sprite` 的實際存檔路徑當範本）。
6. 獨立模式 `session.ts`：`saveEmotionSprite()`（比照既有 `avatar.png`
   存檔那段）；遙控模式：`/api/characters/save-emotion-sprite` 端點
   （能重用桌面既有的 IPC handler 邏輯就重用，不要複製一份）。
7. `core/data/types.ts` ＋ 兩份 `DataSource` 實作：`characterDisplayImageUrl()`
   （獨立模式在 `session.ts` 新增對應方法；遙控模式的 HTTP 端點與
   `remoteDataSource.ts` 呼叫端）。
8. `mobile/ui/characters/useAvatarUrl.ts`：新增
   `useCharacterDisplayImage(characterId, emotion)`（cache key 含 emotion，
   其餘沿用既有的 `invalidateAvatar`/`invalidateAllAvatars` 機制）。
9. 聊天泡泡元件：改用新 hook，`effectiveEmotion = message.emotionOverride ?? message.emotion`。
10. `MessageMenu.tsx`：「換表情」項＋表情選擇畫面；獨立模式
    `session.setMessageEmotionOverride()`（新方法）；遙控模式
    `/api/messages/set-emotion` 端點。
11. 測試：`resolveDisplayImagePath()`（純函式，好測：有 emotion 對得到圖／
    對不到圖退回 avatar／emotion 是 undefined）、裁切比例換算的邊界值。
12. `npm run typecheck`／`npm test` 全過；真機驗證留給 owner（尤其
    「換表情」畫面的縮圖手感、聊天泡泡表情切換有沒有跑版、手機新增表情
    圖片後桌面版能不能正確讀到）。

---

## 9. 落地筆記（2026-08-23，已實作，與本文件原設計的偏離）

**狀態**：已實作，`npm run typecheck`／`npm test`（78 檔、993 項）皆過，
尚未真機驗證。詳細變更清單見 `docs/progress-log.md` 2026-08-23 條目。

- **§4／§5 的 `getFaceCrop`／`setFaceCrop` 沒有各自寫一套（獨立模式一份、
  遙控模式一份）**，而是抽成共用模組 `mobile/runtime/faceCropConfig.ts`。
  理由：`faceCrop` 是**裝置偏好**，跟 `MODE_PREF_KEY` 同一類——不管手機
  當下連哪一種模式都該讀寫同一份 `character-display-config.json`
  （`capacitorAdapters.storage`）。**遙控模式的 `getFaceCrop`/`setFaceCrop`
  完全不打 HTTP**，沒有 `/api/characters/face-crop` 這支端點；本文件字面
  暗示兩邊各自實作，但那樣反而會讓同一支手機切模式後框選範圍對不起來。
- **`FaceCropView.tsx`（框選 UI）不用 canvas 讀像素**，只讀
  `<img>.naturalWidth/naturalHeight` 算比例矩形（因為只存比例、不輸出
  裁切檔案）。真正需要讀像素的是套用階段的 `cropImageToFace()`
  （`faceCropConfig.ts`）——遙控模式呼叫這支之前，要先用
  `http.getBinary()` 把圖轉成同源 blob URL，不能直接把 `/api/avatar/:id`
  這種跨來源網址餵給 canvas，否則 `toDataURL()` 會因為「畫布已污染」丟
  `SecurityError`。
- 新增了兩支桌面 IPC 端沒有的函式：`saveCharacterEmotionSpriteAndAssignDirect`
  （`ipcHandlers.ts`）落地圖片**同時**指定情緒並持久化，跟桌面既有的
  `character:save-emotion-sprite`（只落地、不指定情緒，指派交給
  `EmotionSpritesTab.tsx` 的勾選 UI）是两套不同流程，服務不同的 UI 形狀；
  `setMessageEmotionOverrideDirect` 對應 `editMessageDirect` 的寫法。
- `GET /api/avatar/:id` 加了可選的 `?emotion=` query；找不到對應圖時退回
  主圖（跟 `resolveDisplayImagePath()` 的降級邏輯一致）。

### 9.1 二次修正（2026-08-23 二次實機回報）：§4 的 `resolveDisplayImagePath()` 原本漏了一層必要的對應

**這是本文件原始 §4 設計的一個實質缺陷，不只是實作偏離**，補在這裡讓下一個
接手的人不要重踩：

`core/prompt/promptUtils.ts` 的 `buildEmotionContract()`（桌面版本來就有,
跟這次功能無關的既有邏輯）決定「送給模型的情緒 id 合約長什麼樣子」時,
**只要角色卡有任何一張表情圖, id 就不是 `EMOTION_OPTIONS` 的 28 個
canonical key 本身**——是 `spriteIds[imagePath]`（自訂 id）,沒設自訂 id
時退回**檔名主幹**（去掉副檔名）。這是為了讓一張圖能同時涵蓋好幾個
canonical 情緒 key、只需要一個 id 的既有機制。

本文件 §4 給的 `resolveDisplayImagePath()` 虛擬碼只查了
`character.emotions?.[emotion] ?? character.spriteIds?.[emotion]`——後半段
`spriteIds?.[emotion]` 看似有查 spriteIds,但 spriteIds **是「圖片路徑→自訂
id」,不是「emotion→id」**,這樣查永遠查不到東西。真正需要的是反過來：
拿模型回傳的 id,透過 `buildSpriteIdMap()`（新增，見
`core/character/emotionCatalog.ts`）反查回圖片路徑。沒有這一層，**只要角色
卡有任何表情圖，AI 選的表情就 100% 對不到圖**，因為合約 id 幾乎不可能等於
canonical key 本身——這不是邊角案例，是主線路徑必然會踩到的。

修正後 `resolveDisplayImagePath(character, emotion)` 的正確邏輯：
1. `character.emotions?.[emotion]` 命中就用（emotion 剛好是 canonical key
   時，例如角色卡只有一張表情圖、沒有自訂 id 覆寫的情況）。
2. 否則用 `buildSpriteIdMap(emotions, spriteIds)` 反查——這支跟
   `buildEmotionContract()` 算 id 的規則必須對稱（同一份函式，不要各自
   維護一份）。
3. 都沒有才退回主圖。

`saveEmotionSprite` 新增表情圖時現在會順手填 `spriteIds[path] = emotionKey`
（乾淨的 id），但這只是讓新資料更好讀——即使不填，`buildSpriteIdMap()` 的
檔名主幹 fallback 本來就會生效，所以舊資料（這次修正前存的表情圖）不需要
補資料就能正常運作。

### 9.2 三次修正（2026-08-23 三次實機回報）：`message.emotion` 不能存裝置本地 id，要存 canonical key

§9.1 修的是「同一台裝置上，反查自訂 id／檔名主幹回圖片路徑」，但沒處理到
**訊息會跨裝置看**這件事——`docs/mobile-mode-switch-sync.md` 的 S2 對話同步
本來就會把訊息整包（含 `emotion` 欄位）複製到另一台裝置。自訂 id／檔名主幹
是**裝置本地產生的**（各裝置存表情圖的檔名時間戳不同），`message.emotion`
如果存的是這種本地 id，換一台裝置檢視時用那台**自己的** `emotions`／
`spriteIds` 反查就會對不上——即使那台裝置的角色卡也有同一個情緒的圖。

修法：**訊息落地前先換算成 canonical key**（`EMOTION_OPTIONS` 的固定英文字，
兩邊定義完全相同，不受裝置檔名差異影響），不要存自訂 id／檔名主幹本身。
新函式 `canonicalizeEmotionId()`（`core/prompt/promptUtils.ts`）接進
`chatWithLLM()`／`classifyEmotionWithLLM()`——這是**唯一**兩個會產生
`message.emotion` 的入口，桌面／獨立版／遙控版全部共用，不需要在各平台
呼叫端各自補一次。

**這次修正之前已經生成的舊訊息**（`emotion` 欄位還是裝置本地 id）不會
自動修好，換裝置檢視時仍會退回主圖，需要使用者手動「換表情」補一次；
之後新產生的訊息不受影響。細節見 `docs/progress-log.md`
2026-08-23（續三）條目。
