# 設定載入全等比對工具

驗證「讀 settings.json 之後產生的設定物件有沒有被改變」。
**不需要 API Key、不連網、不碰你的真實資料。**

與 `README-prompt-equivalence.md` 是同一套做法，只是對象換成 `fileStore.loadSettings`。

## 什麼時候用

- 改了 `core/store/`（設定遷移、預設值合併、模型 id 改名、金鑰加解密）
- 改了 `fileStore.ts` 的載入或存檔路徑
- 想確認某次改動「只改了該改的地方」

## 為什麼需要它

設定遷移是**靜默失敗**的那種東西：寫歪了不會有錯誤訊息、測試不會紅，
使用者只會發現升級後設定跑掉。而它偏偏又是手機版一定要共用的邏輯（B2.7）。
所以固定成可自動比對的快照。

## 涵蓋範圍（18 個人造樣本）

空檔案／舊 `persona` 與 `worldSetting` 欄位遷移／世界觀空白時不建 preset／
已有 activePersonaId 不被蓋掉／已下架模型 id 自動換新／明文舊金鑰 migration／
已加密金鑰解密／**解密失敗時清成空字串但磁碟密文不可毀**／更舊的單一 apiKey 欄位／
便利貼從 ui 舊欄位搬出／獨立檔優先／onboarding 旗標／CWA 天氣金鑰／
desktopCharacters 補 flipped／memory 部分欄位／損毀 JSON／以上混合。

每個樣本比對四樣東西：產出的設定物件、遷移建立的 persona／world preset 檔、
**回寫後的 settings.json**、pinned-notes.json。

## 怎麼跑

```bash
npx esbuild scripts/settings-hydration-harness.ts --bundle --platform=node --format=cjs --alias:electron=./scripts/_fakeElectron.ts --outfile=.sh.cjs && node .sh.cjs > .sh.json && node -e "const a=require('./scripts/__golden__/settings-hydration.json'),b=require('./.sh.json');const d=Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));console.log(d.length?'差異:\n'+d.join('\n'):'全部相同')"
```

`scripts/__golden__/settings-hydration.json` 是 **2026-08-03 於重構前的 `7f5ef7b`
產生**的基準快照——也就是 B2.7 動工之前的行為。

**設定行為有意的改動會讓這個比對紅字，那是正常的**。確認差異符合預期後，
把新快照覆蓋上去即可（`cp .sh.json scripts/__golden__/settings-hydration.json`）。

## 四個必要的細節（踩過才知道）

1. **`electron` 必須換成假的**（`--alias:electron=./scripts/_fakeElectron.ts`）。
   `fileStore` 在模組載入當下就呼叫 `app.getPath('userData')`，真 electron 在純 Node 下跑不起來。
2. **加密必須可決定性**。真 DPAPI 對同一明文每次產生不同密文，逐字比對會永遠紅字。
   `_fakeElectron.ts` 的 safeStorage 用固定 XOR ＋ 魔術前綴。
   ⚠️ 那個**魔術前綴不是裝飾**：沒有它的話 XOR 對任何位元組都會「解密成功」，
   就測不到「解密失敗要保住磁碟上的密文」這條最重要的保護路徑。
3. **每個樣本要跑在自己的 process**。`fileStore` 在模組載入時就把 DATA_DIR 算好存進
   模組層變數，bundle 之後沒有 `require.cache` 可清 —— 同一個 process 內換不了資料夾。
   harness 沒帶參數時會自我 spawn 18 次再合併結果。
4. **時間與 uuid 必須凍結**。`Date.now` 直接蓋掉；uuid 蓋不掉（bundle 後 binding 唯讀），
   改成輸出階段把 uuid 形狀的字串依首次出現順序換成 `uuid#1`、`uuid#2`…

## 驗證這個工具本身有沒有效（反向驗證）

改壞一行再跑，確認抓得到。例如把 `core/store/settings.ts` 的
`flipped: !!dc?.flipped` 改成 `!dc?.flipped`，應該**只有樣本 15** 出現差異
（2026-08-03 實測結果）。記得改回來。

## 2026-08-03 的比對結果

重構前 `7f5ef7b` vs B2.7 完成後：

```
樣本: 18 | 差異: 0
```
