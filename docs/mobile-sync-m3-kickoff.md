# S2 同步 M3 —— 真的推／拉資料（開工指令）

> **建立時間**：2026-08-12（M2 真機驗證通過之後）
> **狀態**：待開工。這份是給接手 AI 的完整指令，**照著這份就能開工，不必先讀長文**。
> **前置**：`CLAUDE.md`（必讀）。其餘只在下面指名的段落才讀。

---

## 0. 一句話

M1（模式可切換）與 M2（差異預覽，唯讀）都已經完成並真機驗證過。
這次要做的是讓 M2 算出來的差異**真的動手搬**：角色、人設、世界觀、情境、
用語解說、設定——**對話這一版還不動**（那是 M4）。

**不要重新設計差異演算法，不要重寫 M2 的 UI 骨架。** `core/sync/diff.ts` 的
`computeDiff()` 已經算好「誰新增／誰修改／誰刪除／誰衝突」，這次只是把
「帶過去」這個動作接上去，並且**成功之後才更新基準**。

---

## 1. 現況盤點（已查證，2026-08-12）

### 已經有的（M1／M2，不要重做）

```
src/core/sync/types.ts     SyncBaseline / EntityBaseline / ConversationBaseline / Manifest / SyncDiff
src/core/sync/diff.ts      computeDiff()：新增／修改／刪除／衝突，純函式，已有 10 個測試
src/mobile/runtime/syncTransport.ts   共用的 fetch／token header／錯誤正規化（getJson/getBinary/request）
src/mobile/runtime/syncManifest.ts    buildLocalManifest() / fetchRemoteManifest()
src/mobile/runtime/syncBaseline.ts    readBaseline()——目前只有讀，寫入函式故意還沒做
src/mobile/ui/shell/syncDiffMessage.ts  差異摘要格式化成文字（給 ui.confirm 用）
src/mobile/ui/shell/ModeSwitcher.tsx    切換模式的 UI，`previewBeforeSwitch()` 已經會抓
                                         雙邊清單、算差異、用 `ui.confirm` 顯示——
                                         但目前**不管使用者怎麼選都不會搬資料**，
                                         只有「繼續切換 / 取消」兩個選項
main/mobileServer.ts        GET /api/sync-manifest（輕量清單，M2 新增）
```

### 已經存在、M3 可以直接拿來用的推送端點（**幾乎不用新開**）

| 端點 | 方向 | 用途 |
|---|---|---|
| `POST /api/characters/import-pack` | 手機 → 電腦 | 角色本體（跟 S1 反向匯入同一種 `.dstpack` 格式） |
| `POST /api/presets/persona/save`／`world/save`／`scene/save` | 手機 → 電腦 | 人設／世界觀／情境（`mobileServer.ts:983` 的 regex 路由） |
| `POST /api/lorebooks/save` | 手機 → 電腦 | 用語解說（`mobileServer.ts:1425`） |
| `POST /api/settings/*` | 手機 → 電腦 | **一項一支**（`llm-provider`／`llm-model`／`memory`／`color-theme`／`modules/toggle`…，`mobileServer.ts:1019` 起），**沒有整包一次送的端點**——推設定要拆成好幾支呼叫，見 §3.3 |
| `GET /api/sync-pack?id=` | 電腦 → 手機 | 角色本體（S1 已在用，直接重用） |

> 反向（電腦 → 手機）角色／人設／世界觀／情境／用語解說已經有 `SyncInitBundle`
> 與 `syncImport.ts` 的既有拉取邏輯（S1），這次是**推廣到雙向**，不是重新發明。

### 這次真正要新增的東西

1. `writeBaseline()`（`syncBaseline.ts`）——寫回 `sync-baseline.json`。
2. 一支「逐項推送」的編排邏輯（新檔，建議 `mobile/runtime/syncPush.ts`）：
   拿 `SyncDiff` 裡「使用者勾選要帶的那些 id」，依序呼叫上面那些既有端點，
   每項成功後更新 `EntityBaseline`（`remoteId`／`localUpdatedAt`／`remoteUpdatedAt`）。
3. `ModeSwitcher.tsx` 的確認流程要從「繼續切換 / 取消」兩選項，
   變成 §7.1 講的三選項：**帶過去並切換 ／ 直接切換不帶 ／ 取消**。
   `ui.confirm` 目前只有 confirm/cancel，`extraActions`（`uiStore.ts:88`）
   可以加「額外動作」但要注意 `closeAfter` 語意——細節見 §4。

---

## 2. 這次的範圍

### 要做

1. **角色／人設／世界觀／用語解說**：新增、修改都推；刪除**不推**（§5.4，只標「僅在
   手機／僅在電腦」，不動另一邊）。
2. **情境（Scene）**：手機 → 電腦推送時，`desktopCharacters` **只帶「有誰在場、誰被
   禁言」**（`characterId`／`muted`），座標／大小／翻面／視窗位置一律沿用電腦上原本
   那份——§7.4 已經寫死這條規則，**這是最容易漏掉、漏了就會把電腦桌寵位置洗掉的地方**。
   反向（電腦 → 手機）整份收下即可。
3. **設定**：`llm`（除 apiKey）／`memory`／`colorTheme`／`modules` 這四類，
   跟 M2 `settingsHash` 算的子集完全對齊（`syncManifest.ts` 裡已經寫死這個子集，
   照抄不要自己另外挑欄位）。
4. **衝突**：`SyncDiff.conflicts` 裡的項目**預設不勾**，UI 要讓使用者看得到但不強迫
   選邊（§7.3——這一版不做欄位級合併，衝突就是衝突，使用者自己決定要不要覆蓋）。
5. 推送成功後**更新基準**（§7.2：「直接切、不帶」時基準不能動；只有真的搬過去的
   那幾筆才更新對應的 `EntityBaseline`）。
6. 換同步主機（`hostBaseUrl` 跟基準不同）→ 整份基準作廢，退化成第一次同步（§7.6）。

### 不要做

- **對話**（`ConversationBaseline` 的推送邏輯）——那是 M4，需要新端點
  `POST /api/sync-conversation-merge`（§6.2 已經定義好形狀，但這次不用開）。
- **刪除同步**——這一版刪除只標籤，不動手。
- **欄位級合併**——衝突就是衝突，不做「description 兩邊都改，各留一半」這種事。
- **提醒（Reminder）**——已經在 §3.1 的「明確不同步」清單裡，不要順手加。

---

## 3. 三個容易做錯的地方

### 3.1 基準只在「真的搬過去」才更新

`docs/mobile-mode-switch-sync.md` §7.2：使用者選「直接切、不帶」時，**基準完全不能動**。
如果順手把基準更新成「現在」，那些變動就永遠不會再被偵測到。

**做法**：`writeBaseline()` 只在推送迴圈裡、每一項**真的成功送出**之後，
才更新那一筆的 `EntityBaseline`；使用者選「直接切」時整個推送迴圈根本不會跑，
基準檔案原封不動。

### 3.2 情境推送要過濾欄位（§7.4）

```ts
// 手機 → 電腦推送情境時：
const toPush = {
  ...scene,
  desktopCharacters: scene.desktopCharacters.map(dc => ({ characterId: dc.characterId, muted: dc.muted }))
  // ⚠️ 不要整個 desktopCharacters 原樣送——手機那份的座標／大小／翻面
  // 只是預設值，送過去會把電腦上排好的桌寵位置洗掉。
}
```

反向（電腦 → 手機）不用過濾，整份收下即可（手機用不到的欄位留著不礙事）。

### 3.3 設定沒有整包端點，要拆成好幾支呼叫

跟角色／預設組不同，`/api/settings/*` 是**一項一支**（`llm-provider`／`llm-model`／
`memory`／`color-theme`／`modules/toggle`…）。`buildLocalManifest()` 算
`settingsHash` 用的子集是：

```ts
{ llm: { provider, model, models, endpoint, maxResponseTokens, maxGroupRounds, maxImagesPerMessage },
  memory, colorTheme, modules }
```

推送時要把這個子集拆開，依序打對應的端點（`modules` 要對每一個模組各打一次
`/api/settings/modules/toggle`）。**不要漏欄位**，漏了會出現「`settingsHash`
明明相等但畫面上有些設定沒真的推過去」的假象。

---

## 4. UI：三選項確認

`ModeSwitcher.tsx` 目前的 `previewBeforeSwitch()`：

```ts
if (isDiffEmpty(diff)) return true
return await confirm({ title: '切換前預覽', message: formatDiffMessage(diff), confirmLabel: '繼續切換' })
```

`ui.confirm` 的 `resolve` 只能回 `boolean`（`uiStore.ts:89-90`），沒辦法表達
三選項。有兩條路可選，**建議走第一條**：

1. **改用 `extraActions`**：confirm 按鈕當「直接切換，不帶」；`extraActions` 加一顆
   「帶過去並切換」，`onClick` 裡跑推送迴圈、`closeAfter: true`。取消就是點背景或
   ✕。三顆按鈕都在同一個對話框，不用碰 `uiStore.ts` 的型別。
2. 改 `DialogRequest`／`useUiStore.confirm` 讓它能回傳三態——影響面較大（`confirm`
   目前全站到處在用），**沒有必要不要選這條**。

推送迴圈跑的時候要有進度／忙碌狀態（比照 `tryConnect` 現有的 `busy`），
角色多的話逐一 `import-pack` 需要一點時間，不能讓使用者以為沒反應。

---

## 5. 建議順序（每步都可獨立驗證）

| 步驟 | 內容 | 驗證方式 |
|---|---|---|
| ① | `writeBaseline()`（`syncBaseline.ts`） | 單元測試：寫入後 `readBaseline()` 讀得回來 |
| ② | `syncPush.ts`：角色／人設／世界觀／用語解說推送 ＋ 基準更新（不含情境／設定） | 單元測試：mock fetch，驗證呼叫了正確端點、基準正確更新、刪除不推 |
| ③ | 情境推送（§3.2 欄位過濾） | 單元測試：桌寵座標欄位沒有被送出 |
| ④ | 設定推送（§3.3 拆分呼叫） | 單元測試：每個子欄位都對到正確端點 |
| ⑤ | 衝突處理：預設不勾，UI 能顯示但不阻擋其他項目推送 | 單元測試 ＋ 手動情境 |
| ⑥ | `ModeSwitcher.tsx` 接上三選項（§4） | 瀏覽器煙測（`MobileST.bat [3]`）＋ 真機 |
| ⑦ | 換主機時基準作廢（§7.6） | 單元測試：`hostBaseUrl` 不同時 `computeDiff` 收到 `baseline: null` |

每一步做完就 `npm test` ＋ `npm run typecheck`；動到 UI 就用
`MobileST.bat [3]` 或 `preview_start` 看一眼；**真的要驗證「基準寫回磁碟」
這件事一定要重開 App 或用 `adb shell run-as tw.nori.dest cat files/sync-baseline.json`
直接看磁碟**——CLAUDE.md §5 已經記過這個坑：只驗記憶體裡的狀態、沒重開驗證過，
很容易做出「看起來動了、其實沒寫回磁碟」的東西。

---

## 6. 已經寫好、直接繼承的測試基礎

- `tests/core/sync/diff.test.ts`——10 例，diff 邏輯本身**不用改**，M3 只是消費
  `SyncDiff` 的輸出。
- `tests/mobile/syncManifest.test.ts`／`tests/mobile/syncBaseline.test.ts`——
  新增 `writeBaseline()` 測試時比照這兩份的 mock storage 寫法
  （`createMemoryStorage()`，見 `tests/mobile/syncImport.test.ts` 的 `adapters()`）。
- `tests/mobile/syncImport.test.ts`——36 例，S1 的既有推送／拉取模式（尤其是
  id remap、分批下載失敗不中斷整批）**直接照抄精神**，不要重新發明。

---

## 7. 依任務選讀（不要整份開）

| 你要做的事 | 讀這些 |
|---|---|
| 完整設計脈絡（基準結構、變動判定、流程圖） | `docs/mobile-mode-switch-sync.md` §5～§7（已經讀過可以跳過） |
| M1／M2 落地時踩過的坑 | 同上 §8.1／§8.2 |
| 既有推送端點的完整簽章 | `src/main/mobileServer.ts`（regex 路由集中在 900～1450 行附近） |
| S1 既有的拉取／id remap 邏輯（這次要推廣成雙向） | `src/mobile/runtime/syncImport.ts` |
| 手機端資料模型（`StandaloneSession` 的欄位） | `src/mobile/runtime/session.ts` |

**不要讀**：整份 roadmap、M4（對話合併）相關的 §6.2 ② 與 §9 未決清單（那是之後的事）。
