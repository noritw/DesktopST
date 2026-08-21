# 地方新聞併回關鍵字組 —— 實作計畫

> **建立時間**：2026-08-12（新聞報 UI 四項回報收尾之後）
> **狀態**：**已完成**（2026-08-12）。owner 拍板 §2.3 選 A、保留「偵測我的縣市」。
> 落地與真機驗證見文末 §9。
> **前置**：`CLAUDE.md`（必讀）。其餘只在下面指名的段落才讀。
> **提出者**：owner 2026-08-12 —— 「有興趣看地方新聞的人自己設個關鍵字組就好了」。

---

## 0. 一句話

把「地方新聞」這個系統特製的欄位**降級成一般的關鍵字組**，
刪掉散在 9 個檔案裡的特例，桌面／遙控／獨立版自動一致。

**這是減法，不是新功能。** 不要順手擴充地方新聞的能力。

---

## 1. 為什麼值得做（已查證）

### 地方新聞本來就是關鍵字，只是使用者沒打字

```ts
// core/news/sources.ts:341
const locSource: NewsSource = {
  id: `loc-${loc.name}`,
  type: 'keyword',        // ← 就是 keyword
  label: loc.name,        // ← 縣市名直接當查詢字
  weight: loc.weight,
  enabled: true,
  origin: 'location'      // ← 唯一的差別
}
```

桌面設定那邊也不是縣市選單，是**自由輸入框**
（`SettingsPanel.tsx:848`「輸入縣市，例如：台北、新北、台南」）。
所以它跟使用者自己加一個「台南」關鍵字，抓出來的東西一模一樣。

### 代價：9 個檔案、10 處特例

| 檔案 | 位置 | 特例內容 |
|---|---|---|
| `core/news/filter.ts` | 244／252／390 | `READER_LOCAL_BUCKET` 獨立分桶 |
| `core/news/reader.ts` | 26／46／103 | `LOCAL_SECTION_ID`、`sectionIdOf`、分欄 |
| `core/news/reader.ts` | 142–147／276 | 欄位排序清單要濾掉 `origin === 'location'` |
| `core/news/readerFetch.ts` | 110–130 | `__local__` 專屬的抓取分支 |
| `core/news/sources.ts` | 340–352 | 批次抓取時另外組一批 loc source |
| `core/news/settings.ts` | 88／130／148／184／217 | `NewsLocation` 正規化、`localNews` 預設值 |
| `core/news/types.ts` | 65–70／106–110 | `NewsLocation`、`localNews` 型別 |
| `main/modules/news/readerPack.ts` | 25／114 | 搬家包排除 |
| `renderer/.../SettingsPanel.tsx` | 367–410／819–860 | 桌面 UI（新增／刪除／權重／偵測縣市） |
| `renderer/.../groupNewsItems.ts` | 9 | `LOCAL_GROUP_ID` 轉出 |

### 順帶解決一個現有缺口

`NewsEditableSettings`（`core/data/types.ts:570`）**不含 `localNews`**
—— 也就是**手機（遙控與獨立版）目前完全編輯不到地方新聞**，
只看得到結果、改不了。變成一般關鍵字之後兩邊自動都能編，
不必為此再開一支 API。

---

## 2. 三個必須先決定的點

### 2.1 「偵測我的縣市」按鈕要不要留？——**建議留**

我原本以為 `fromDetection` 是自動帶入（那會有「憑空多出使用者沒答應的關鍵字」
的問題，比照提醒那次的教訓）。**查證後不是**：它只由
`SettingsPanel.tsx:401` 的 `detectMyCounty()` 觸發，是使用者自己按的按鈕。

所以保留即可，只是行為改成「偵測到城市 → 加一個**一般關鍵字**到指定組」。
`fromDetection` 這個欄位可以直接廢掉（它只用來在清單旁邊顯示一個 📍）。

### 2.2 搬家包的語意會變 ——**建議接受**

`readerPack.ts:25` 目前**刻意排除** `origin === 'location'`，
視為「裝置／地點相關，不跟著搬家」。合併之後它們是一般關鍵字，會跟著走。

我認為這樣才對（所在地是人的屬性、不是裝置的），但**這是行為改變**。
`origin === 'character'` 的排除要留著，那個是跟著角色卡走的，性質不同。

### 2.3 ⚠️ 情境切換會影響地方新聞 ——**這是最大的行為改變**

關鍵字組可以被情境**取代式**切換（`keywordGroups`／`readerKeywordGroupIds`，
見 `core/news/keywordGroups.ts`）。地方新聞現在是 **always-on**、不受情境影響；
變成一般組之後，**套用某個只選了「ACG」組的情境時，地方新聞就會消失**。

三個選項：

| 做法 | 說明 |
|---|---|
| **A. 接受**（建議） | 地方就是一個普通組，要它一直在就把它加進每個情境的選取。語意最單純。 |
| B. 給組一個 `alwaysOn` 旗標 | 保留現行行為，但等於把特例從「地方新聞」搬到「組」，只是換個地方長。 |
| C. 遷移時把地方組加進所有既有情境的選取 | 一次性補償，之後新建情境仍要自己記得加。 |

**建議 A，但這題必須 owner 拍板**——它會改變既有情境的實際行為。

---

## 3. 資料遷移設計

### 在哪裡做

`core/news/settings.ts` 的設定正規化（讀檔時），**一次性、冪等**。
放這裡的原因：桌面與手機共用同一支，兩邊自動都會遷移，不必各寫一份。

### 做什麼

```
若 localNews.locations 非空 且 尚未遷移：
  1. 確保存在一個關鍵字組「地方」（id 固定，例如 'local'）
  2. 每個 location → 一個 NewsSource：
       { type:'keyword', label: loc.name, weight: loc.weight,
         groupId:'local', origin:'user',
         enabled: localNews.enabled }        ← 見下方說明
  3. 已有同名（label 相同）的 keyword 就跳過，不重複加
  4. localNews.locations 清空、寫入遷移旗標
```

**`enabled` 要跟著 `localNews.enabled` 走**：使用者原本把地方新聞整個關掉時，
遷移不能讓那幾個關鍵字突然全部啟用 —— 那等於替他做了沒答應過的決定。
關著的就加進去但 `enabled: false`，他之後想開自己開。

### 回復路徑

遷移時把原本的 `locations` 原封不動存進 `localNews.migratedFrom`，
**不刪**。真的要退回時有東西可以照著補。旗標與 `migratedFrom` 都留在檔案裡，
不佔多少空間，但省掉「使用者說我的縣市不見了」時的考古。

### 不會壞的東西（已查證）

新聞 id 是 `stableId(source.type, guid || link || title)`
（`core/news/stableId.ts`）—— **不含 `sourceId`**，而 location source 的
`type` 本來就是 `'keyword'`。所以遷移後**同一篇新聞算出來的 id 完全不變**，
釘選／「不看了」／`seenIds` 全部繼續有效。**這是本次最大的風險點，先確認掉了。**

### 會壞的小東西

`feedback.adjustments` 以 `sourceId` 當鍵，舊的 `loc-台南` 學習權重會變成孤兒
（不會報錯，只是那份微調失效）。可接受；遷移時順手把 `loc-*` 的鍵刪掉，
免得永遠留在檔案裡。

---

## 4. 建議順序（每步都可獨立驗證）

| 步驟 | 內容 | 驗證方式 |
|---|---|---|
| ① | 遷移函式 ＋ 單元測試（含冪等、`enabled=false`、同名去重） | `npm test` |
| ② | 刪 `filter.ts`／`reader.ts` 的 `__local__` 分桶與分欄 | 針對 `groupReaderSections` 的既有測試要跟著改 |
| ③ | 刪 `readerFetch.ts` 的 `__local__` 分支、`sources.ts` 的 loc 批次 | 桌面開新聞報：縣市欄變成一般關鍵字欄 |
| ④ | 刪 `reader.ts` 的排序清單排除、`readerPack.ts` 的排除 | 欄位上下移現在可以移動縣市欄 |
| ⑤ | 桌面 `SettingsPanel` 拿掉地方新聞區塊，「偵測我的縣市」改成加關鍵字 | 桌面設定面板 |
| ⑥ | 刪 `types.ts` 的 `NewsLocation`／`localNews`（保留遷移讀得到的形狀） | `npm run typecheck` |
| ⑦ | 手機真機確認縣市關鍵字可編、可排序、可分組 | APK |

每一步做完就 `npm test` ＋ `npm run typecheck`。
**②–⑥ 中間桌面版可能短暫不一致，不要在中途發版。**

---

## 5. 一定會踩、先寫在這裡的坑

1. **`sectionIdOf`（`reader.ts:44`）與 `filter.ts` 的分桶必須用同一套判斷。**
   檔案裡已經有這句警告了：兩邊不一致時「重抓一欄」會換錯欄。
   刪特例要**兩邊一起刪**，不要只刪一邊跑測試看起來還是綠的。

2. **遷移必須冪等。** 使用者刪掉「台南」這個關鍵字之後，下次開 App
   不可以又被建回來 —— 這就是旗標的用途，不要用「locations 是不是空的」當判斷。

3. **`origin` 這個欄位不要一起廢掉。** `'character'`（角色卡帶入）與
   `'builtin'` 還在用，只有 `'location'` 這個值退場。

4. **手機端會突然多出幾個關鍵字。** 遙控模式下電腦遷移完，手機拉到的
   `sources` 就會多幾筆 —— 這是預期的，但要確認手機的「管理關鍵字」畫面
   顯示與排序都正常（那個畫面沒預期過會有它沒建立過的來源）。

5. **`docs/news-reader-mobile-plan.md` 與 `b3-mobile-ui-plan.md` §4.21 裡
   有「📍 地方新聞」的字樣**，改完要一起更新，否則下一個接手的人會照著舊規格做回來。

6. **不要順手改 `breakout`（熱門話題）。** 它同樣是固定欄，但它**不是關鍵字**
   （走 Google Trends，`sources.ts:273`），不能用同一套併法。範圍守住。

---

## 6. 完工判準

- [ ] 既有使用者開啟後，原本的縣市變成「地方」組底下的一般關鍵字，`enabled` 與原本一致
- [ ] 遷移是冪等的：刪掉其中一個縣市關鍵字 → 重開 App → 不會被建回來
- [ ] 釘選／「不看了」在遷移前後指向同一批新聞（id 不變）
- [ ] 縣市欄可以上下移、可以改配額、可以改分組（原本三件都不行）
- [ ] **手機（遙控與獨立版）可以編輯縣市關鍵字**（原本完全編不到）
- [ ] `grep -rn "localNews\|LOCAL_SECTION_ID\|origin === 'location'" src/` 只剩遷移那一處
- [ ] `npm test` ＋ `npm run typecheck` 全過；桌面與 APK 各手動確認一次
- [ ] `progress-log.md` 補條目、本文件標成完成

---

## 7. 不要做的事

- **不要動熱門話題**（見坑 §5.6）。
- **不要順便改情境綁定的機制**。§2.3 選 A 的話就是「什麼都不做」，不要藉機重構。
- **不要保留相容層**。留著 `localNews` 的抓取路徑等於特例沒刪，
  維護成本原封不動 —— 遷移一次到位，舊欄位只留資料不留邏輯。

---

## 8. 依任務選讀

| 你要做的事 | 讀這些 |
|---|---|
| 關鍵字組與情境綁定怎麼運作 | `core/news/keywordGroups.ts`（63 行，直接讀原始碼） |
| 分欄／重抓一欄的判斷 | `core/news/reader.ts` §`sectionIdOf` 與 `groupReaderSections` |
| 設定正規化與遷移放哪 | `core/news/settings.ts` |
| 搬家包的排除規則 | `main/modules/news/readerPack.ts:25` |
| 手機那側的關鍵字管理 UI | `src/mobile/ui/news/NewsKeywordsPanel.tsx` |

---

## 9. 落地紀錄（2026-08-12）

依 §4 的七步做完，`npm test` 540 全過、typecheck 過、APK 真機驗證。
兩處**與計畫不同**、以及兩個**真機才抓得到的 bug**：

### 與計畫不同的兩處（都是更好的做法）

1. **縣市關鍵字的 `id` 沿用 `loc-<縣市>`，沒有換新的。**
   計畫原本寫「順手把 `loc-*` 的 feedback 鍵刪掉」，但既然 `loc-` 前綴的
   特例判斷全刪光了，前綴就只是歷史痕跡、不再有任何行為 ——
   沿用 id 反而讓 `feedback.adjustments` 累積的學習權重**整份留下來**。
   測試 `localMerge.test.ts` 有一條專門釘住這件事。

2. **`origin: 'location'` 這個值沒有從 `normalizeSource` 拿掉。**
   留著只是為了讀舊資料時不炸；新的遷移一律產出 `origin: 'user'`。

### 真機才抓得到的兩個 bug

**① 遷移沒有寫回磁碟。** 正規化是純函式、只作用在記憶體，磁碟要等下次有人
存設定才會被覆蓋。在那之前**每次讀都會重跑遷移，`migratedAt` 這個冪等旗標
永遠不會生效** —— 使用者刪掉縣市關鍵字，下次讀又被建回來，正是這支最該
避免的事。症狀很隱蔽：畫面上一切正常，只有去 `adb shell run-as ... cat
settings.json` 才看得到磁碟仍是舊的。已在 `loadNewsModuleSettings` 
（同步／非同步兩版）加上「這次真的遷移了就立刻寫回」。

**② 一個都沒加時仍然建了空的「地方」組。** owner 的機器上四個縣市**早就
自己建成一般關鍵字**了，去重全部跳過，但組已經先建好 → 管理畫面多出一個
空的同名複本。改成 `added.length === 0` 就不建組。

> 這兩個都是「單元測試全綠但真機不對」的類型。**遷移類的改動一定要看磁碟，
> 不要只看畫面。**

### 對既有使用者的實際影響（owner 的機器）

`localNews.locations` 的四個縣市在他的關鍵字裡**本來就有**（自己建的「地方」組），
所以遷移只是把 `locations` 清空、蓋旗標、把原值存進 `migratedFrom`，
沒有新增任何關鍵字。畫面完全沒變 —— 這正是預期結果。
