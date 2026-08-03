# Lorebook 注入預覽

**看見「用語解說接上去之後，prompt 裡會多出什麼」。**
不需要 API Key、不連網、不碰你的真實資料。

## 為什麼有這支

B2.5 只做了 `src/core/lore/` 的純函式，**還沒接進聊天流程**（那是 B2.6）。
所以開 DeST 是看不到任何東西的。這支讓你在接線之前就能先驗證
「條目要怎麼寫、什麼時候會被觸發、實際注入幾個字」。

接線之後這支的角色會由 UI 取代（比照日曆設定視窗那塊「目前讀到的內容」）。

## 怎麼跑

```bash
npx esbuild scripts/lore-preview.ts --bundle --platform=node --format=cjs --outfile=.lore.cjs && node .lore.cjs
```

## 怎麼玩

改 `scripts/lore-preview-input.json`，重跑上面那行。裡面兩塊：

| 區塊 | 是什麼 |
|---|---|
| `lorebook.entries` | 你的用語解說條目 |
| `summary` / `recentContents` / `currentInput` | 模擬「這一輪聊天會被掃描到的內容」 |

值得試試看的幾件事：

- **一條目多個叫法**：`keys` 填 `["DeST", "桌友", "我的桌面小程式"]`，
  然後在 `currentInput` 只提其中一個 —— 照樣會命中
- **常駐 vs 觸發**：把 `constant` 改成 `false`，再把 `currentInput` 裡的該詞拿掉 →
  條目就消失了。這就是「核心術語建議勾常駐」的理由
- **掃描深度**：`recentContents` 放超過 `scan_depth` 則，最舊的那幾則不會被掃到
  （已被摘要吃掉的舊訊息不該再觸發 lore）
- **預算裁切**：把 `token_budget` 調到很小（例如 50），看誰先被砍
- **全部清空**：`entries` 設成 `[]` → 輸出會告訴你 prompt 完全不受影響，
  連 `[Glossary]` 標籤都不會出現

## 輸出怎麼看

```
=== 掃描文字 ===        實際被拿去比對關鍵字的那段文字
=== 逐條判定 ===        ✅ 會注入 / ⬜ 不會，後面附理由
=== 實際會注入 prompt === 逐字內容，就是角色會看到的那段
```
