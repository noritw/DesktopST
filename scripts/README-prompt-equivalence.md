# Prompt 全等比對工具

驗證「送給 LLM 的內容有沒有被改變」。**不需要 API Key、不連網、不花錢。**

## 什麼時候用

- 重構了 `core/llm/`、`core/prompt/`、provider 或任何影響 prompt 組裝的東西
- 想確認某次改動「只改了該改的地方」

## 原理

用假的 `fetch` 攔截各家 SDK **實際組好的 HTTP 請求本體**，dump 成 JSON。
比對的是真正要送出去的那串位元組，不是中間某個函式的回傳值。

48 個情境 = 4 家 provider × 12 種情境（一般聊天／帶圖／群組／新聞 directive／
記憶摘要／提醒／關閉時間注入／minimal／splitEmotion／無 persona／空對話／多張圖）。

### 三個必要的細節（踩過才知道）

1. **攔截器必須第一個 import**（`_fetchIntercept.ts`）。
   `main/adapters/httpAdapter.ts` 在模組載入當下就 `globalThis.fetch.bind(globalThis)`，
   晚裝就攔不到，請求會真的送出去。
2. **`node-fetch` 也要一起換掉**（`--alias:node-fetch=./scripts/_fakeNodeFetch.ts`）。
   `openai` 與 `@anthropic-ai/sdk` 在 Node 下走 `node-fetch`，不走全域 `fetch`。
3. **時間必須凍結**。prompt 會注入「現在時間」，不凍結的話兩次執行只要跨過一分鐘
   就會產生假差異。（第一次做這個比對時「48/48 相同」其實是因為兩次剛好在同一分鐘內
   跑完 —— 那是運氣不是證明。）

## 怎麼跑

### A. 產生目前版本的快照，與 golden 比對

```bash
npx esbuild scripts/prompt-equivalence-harness.ts --bundle --platform=node --format=cjs --alias:node-fetch=./scripts/_fakeNodeFetch.ts --outfile=.eq.cjs && node .eq.cjs > .eq.json && node -e "const a=require('./scripts/__golden__/prompt-requests.json'),b=require('./.eq.json');const d=Object.keys(a).filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));console.log(d.length?'差異:\n'+d.join('\n'):'全部相同')"
```

`scripts/__golden__/prompt-requests.json` 是 2026-08-03 於 `feat/mobile-standalone`
產生、並已確認與重構前 `main` 逐字相同的基準快照。

**prompt 有意的改動會讓這個比對紅字，那是正常的** —— 確認差異符合預期後，
把新快照覆蓋上去即可（`cp .eq.json scripts/__golden__/prompt-requests.json`）。

### B. 兩個 git 版本互比

```bash
git worktree add ../DeST-ref <要比對的 commit>
cp scripts/prompt-equivalence-harness.ts scripts/_fetchIntercept.ts scripts/_fakeNodeFetch.ts ../DeST-ref/scripts/
ln -s "$(pwd)/node_modules" ../DeST-ref/node_modules
```

兩邊各跑一次 A 的第一段指令，再 diff 兩個 JSON。用完 `git worktree remove ../DeST-ref --force`。

> ⚠️ harness 刻意只 import `src/main/llm`，因為重構前後該路徑的對外簽名相同，
> 同一份 harness 才能在兩個版本上跑。改動若動到那個簽名，就要同步調整 harness。

## 驗證這個工具本身有沒有效（反向驗證）

改壞一行再跑，確認抓得到。例如把 `core/llm/claude.ts` 的
`maxResponseTokens * 3` 改成 `* 4`，應該**只有 12 個 `claude/` 情境**出現差異
（2026-08-03 實測結果）。記得改回來。

## 2026-08-03 的比對結果

`main`（重構前）vs `feat/mobile-standalone`（B1 收尾後）：

```
總情境: 48 | 完全相同: 48 | 差異: 0
```

涵蓋 B1 收尾搬動的 `chatWithLLM` 主流程、四家 provider 的訊息組裝、
圖片改走 data URI、reaction 展開、時間斷層標註、記憶摘要注入。
