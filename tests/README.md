# 自動測試（vitest）

> 導入日期：2026-08-04｜依據 `docs/pre-b3-work-assessment.md` §6.2

## 這是做什麼的

**把「我改壞了嗎」這個問題自動化。**

寫一次「這個函式餵 A 應該吐出 B」，之後每次改程式自動全部重跑。
哪裡壞了立刻指出是哪一支、哪一行、預期什麼、實際拿到什麼。

## 怎麼跑

```bash
npm test
```

改東西時讓它一直開著，存檔就自動重跑：

```bash
npm run test:watch
```

## 測什麼、不測什麼

**判準：有沒有標準答案。**

| ✅ 這裡測 | ❌ 這裡不測 |
|---|---|
| prompt 組出來的字串 | 角色回話有沒有走味 |
| 誰該回話、怎麼排序 | 視窗拖曳、點擊穿透、泡泡定位 |
| 新聞六層篩選與加權抽選 | 要真 API Key 的實際發訊 |
| 骰子、角色卡、base64、提醒時刻 | 「用起來順不順」 |

**測試對象只有 `src/core/`** —— 那是 B1／B2／B2.7 抽出來的純函式層，
不碰網路、檔案、視窗。`src/main/`（Electron）與 `src/renderer/`（React）不在範圍：
前者要真的 Electron 環境，後者要真的畫面，兩者都在
`pre-b3-work-assessment.md` §6.4「只能靠人」那一側。

## 目前涵蓋範圍（206 項）

| 檔案 | 測什麼 | 對應 §6.2 |
|---|---|---|
| `prompt/promptUtils.test.ts` | system prompt 快照、trigger 訊息、時間斷層標註、reaction 展開、情緒解析 | 第 1 項（**最有價值**）|
| `group/responders.test.ts` | 點名判定、關鍵字排序、洗牌、他人台詞清除、對白正規化 | 第 2 項 |
| `news/filter.test.ts` | 六層篩選逐層淘汰、加權抽選分布 | 第 3 項 |
| `random/dice.test.ts` | 擲出邏輯、內嵌 token 展開、HTTP 邊界夾擠、prompt 格式化 | — |
| `card/stCardMapper.test.ts` | ST 卡匯入匯出往返、PNG 嵌入取出 | 第 5、6 項 |
| `util/base64.test.ts` | 與 Node `Buffer` 逐位元組比對 | 第 7 項 |
| `reminder/nextFire.test.ts` | daily／weekly／interval 觸發時刻 | 第 8 項 |
| `lore/scan.test.ts` | Lorebook 觸發判定（keys／constant／selective）、排序、預算裁切 | B2.5 |
| `lore/format.test.ts` | `[Glossary]` 區塊組裝、無條目時完全不出現 | B2.5 |
| `lore/resolve.test.ts` | 疊加（角色卡＋世界觀）vs 取代（情境）、載入失敗略過 | B2.5 |
| `lore/stLorebook.test.ts` | ST `character_book` 往返、`_passthrough` 不掉欄位 | B2.5 |

**還沒補的**：`store/`（設定遷移、正規化）、`llm/summarizer` 的訊息挑選、
`news/trigger` 的六個 builder 快照。這幾塊有各自的替代驗證
（`scripts/settings-hydration-harness.ts`、`scripts/prompt-equivalence-harness.ts`），
不是完全沒防護，但補進來會更即時。

## 兩條寫測試的規則

### 1. 不准依賴「現在幾點」與「這次抽到什麼」

否則測試會在半夜跑的時候莫名其妙紅字，或十次有一次失敗 —— 那比沒有測試更糟，
因為大家會開始忽略紅字。

- 時間：用 `vi.useFakeTimers()` + `vi.setSystemTime(T0)`，或把 `now` 當參數傳進去
- 亂數：用 `fixtures.ts` 的 `makeSeededRandom(seed)`。同一個 seed 永遠給同一串數列
- 新聞的 `filterAndPick` 直接收 `rng` 參數，注入即可

### 2. 測試紅了，先確認是「程式錯了」還是「測試寫錯了」

導入這批測試時，**有四次是測試寫錯而不是程式壞掉**（`splitEmotion` 只在有表情圖時才有差別、
情緒清單裡沒有 `happy` 只有 `joy`、新聞權重是 `often/normal/rarely` 不是 `high/low`、
`mergeStPersonality` 不做去重）。這很正常，別急著改程式。

## 關於 snapshot（快照）

`buildSystemPrompt` 這類「輸出是一大段字串」的用快照測試：
第一次跑會把結果存進 `__snapshots__/`，之後每次比對。

**prompt 有意的改動會讓它紅字，那是正常的。** 確認差異符合預期後更新快照：

```bash
npx vitest run -u
```

⚠️ **更新前一定要看 diff**。快照的價值全在於「改動被看見」，
無腦 `-u` 等於把測試關掉。

## 驗證這批測試本身有沒有效（反向驗證）

導入時實測過，**確認它抓得到、也不誤報**：

| 故意改壞的地方 | 結果 |
|---|---|
| `core/random/dice.ts` 擲筊權重 40/30/30 → 60/20/20 | 精準抓到 1 項（機率分布那支）|
| `core/prompt/promptUtils.ts` trigger 訊息大小寫 | 精準抓到 3 項（`buildTriggerMessage` 那組）|
| `core/lore/format.ts` 標籤 `[Glossary]` → `[Lore]` | 精準抓到 3 項（format 那支）|
| `core/lore/scan.ts` 裁切改成「先砍高 priority」 | 精準抓到 2 項（預算裁切那組）|

兩次都**只有相關的測試變紅**，其餘照常通過。

## 與既有兩支 harness 的關係

專案裡已經有兩個一次性比對工具，**不重複、各有分工**：

| 工具 | 比什麼 | 何時用 |
|---|---|---|
| 本目錄（vitest） | 函式的輸入輸出 | **每次改動**，自動 |
| `scripts/prompt-equivalence-harness.ts` | 四家 SDK **實際組好的 HTTP 請求本體** | 重構 `llm/` 後，手動 |
| `scripts/settings-hydration-harness.ts` | 設定載入的完整結果 | 動到 `store/` 後，手動 |

後兩者比的是「整條鏈的最終產物」，粒度更粗但更貼近真實；
vitest 比的是個別函式，粒度細、跑得快。兩種都要。
