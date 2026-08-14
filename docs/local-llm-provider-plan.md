# 本地 LLM 供應商（Ollama／LM Studio…）當輔助模型 — 實作進度

狀態：**已實作（core 路徑端到端驗過；桌面 UI / 手機真機待驗）**
提案日：2026-08-15
更新日：2026-08-15
起因：owner 買了 Mac Mini M4 16GB，跑 Ollama + Qwen3 8B，已用 Tailscale 打通跨機連線。
想拿它當 DeST 的**輔助模型**（情緒分類、提醒發話、天氣潤飾、新聞主觀度評分），
省掉這些雜活的雲端費用。

> 這份文件仍是**設計與落地筆記**，但實作已經落地到 `core/llm`／設定遷移／provider 判斷。
> 目前的驗收重點是桌面 UI 與手機真機路徑；core 已通過端到端測試。

---

## 1. 目標與非目標

**目標**
- 新增一個通用的「本地／自訂 OpenAI 相容端點」供應商，任何人都能用
  （Ollama、LM Studio、llama.cpp server、vLLM、自架 LiteLLM…）。
- 主模型與輔助模型可以是**不同供應商且不同端點**——最想要的組合是
  「扮演主模型＝Claude 雲端、輔助模型＝家裡的 Qwen3 8B」。
- 桌面版可用；手機版在同一個 Tailnet／區網下也可用。

**非目標（明確不做）**
- 不做 Tailscale 專屬邏輯。對 DeST 而言 Tailscale IP 只是一個
  「另一個 host 的 http URL」，不需要任何特別處理。文件裡寫設定指南就好。
- 不做模型下載／管理 UI。DeST 不負責幫使用者裝模型。
- 主模型也可以選 local，這是**正式支援的選項**（owner 2026-08-15 指定）：
  斷網備援，以及日後換更大的模型時直接沿用。技術上與其他四家等價（同一支 adapter），
  UI 上不加任何「不建議」的警告或阻擋。
  只是 8B 級的角色扮演品質不在這次的驗收標準裡——驗收看「能不能正確送出並收回」，
  不看回覆好不好。
- 不做本地模型的 streaming（現有四家也都沒做，維持一致）。

---

## 2. 現況盤點（為什麼現在接不上）

三個各自獨立的阻礙，缺一不可解：

### 2.1 供應商 union 只有四家

`src/core/data/types.ts:332`
```ts
export type LlmProvider = 'openai' | 'claude' | 'gemini' | 'grok'
```
`AppSettings.llm.provider`（`src/core/types.ts:374`）與 `utilityProvider` 同一組。

### 2.2 端點只有一個，而且輔助模型不換端點

`AppSettings.llm.endpoint` 是**單一字串**（`src/core/types.ts:381`），
而 `applyUtilitySettings()`（`src/core/prompt/promptUtils.ts:416`）只覆蓋
`provider` 與 `models`、**不動 `endpoint`**。

於是「主＝Claude 雲端／輔助＝本機 Ollama」在資料模型上根本表達不出來：
兩者共用同一個 endpoint 欄位。**這是本案最核心的改動。**

### 2.3 ~~OpenAI 那支走 Responses API~~ → **P0 實測推翻，改成 thinking 問題**

原本預期 Ollama 沒有 `/v1/responses`，需要另寫 chat/completions adapter。
**2026-08-15 實測發現 Ollama 支援 Responses API**（回傳格式完整，含
`output[].content[].output_text` 與 `usage.input_tokens`），
所以 `src/core/llm/openai.ts` 那支可以**原樣重用**，不必新寫 adapter。

真正的地雷是另一件事：**Qwen3 這類思考模型會把 token 預算全部吃在 reasoning 上，
`output_text` 回空字串**。實測 `max_output_tokens: 50` 問一句 "Say hello in one word."：

```
output[0].type = "reasoning"   ← 50 tokens 全花在這
output[1].content[0].output_text = ""    ← 空的
```

這在 DeST 裡是**硬故障**，不是品質降級：
- `openai.ts:113` 對空回應會 `throw new Error('Empty response from model')`
- 情緒分類的 `max_output_tokens` 是 **20**（`index.ts:161`）、
  新聞主觀度是 **40**（`index.ts:268`）——思考模型在這個預算下 100% 回空

**解法**：送 `reasoning: { effort: 'none' }`。實測乾淨俐落：
- `"Say hello in one word."` → `output_text: "Hello!"`，output_tokens 3，沒有 reasoning 區塊
- 真正的情緒分類 prompt（`buildEmotionClassifierSystemPrompt` 的實際輸出，
  中文角色回覆，`max_output_tokens: 20`）→ `"angry"`，output_tokens 3。**完全可用**
- 非思考模型（`willqiu/Llama-Breeze2-8B-Instruct`）帶這個參數**不會報錯**，原樣忽略

所以 local 一律帶 `reasoning: { effort: 'none' }`，不做模型能力偵測。

> 未決：日後若有人想用本地的推理模型做扮演主模型並保留思考，
> 需要一個開關。**現在不做**（YAGNI，且 DeST 的回覆要解析情緒標籤，
> 思考區塊只會添亂）。要做的話是 `llm.localReasoning?: boolean`。

> ⚠️ 這條的教訓：`/v1/responses` 存不存在是**跟著 Ollama 版本走的**。
> 如果日後收到「本機模型完全連不上、404」的回報，先確認對方的 Ollama 版本，
> 舊版可能真的只有 `/v1/chat/completions`——那時再補 fallback adapter 也不遲。

### 2.4 其他小阻礙

- `testLLMConnection()` / `testLLMMessage()` 開頭就 `if (!apiKey) return { errorCode: 'no-api-key' }`
  （`index.ts:296`、`347`）。本地端點通常**沒有金鑰**，這個檢查要對 local 放行。
- `MODELS_BY_PROVIDER` / `DEFAULT_MODEL_BY_PROVIDER` 是
  `Record<LlmProvider, string[]>`（`modelCatalog.ts:74`、`88`），加 provider 會編譯錯——
  這是好事，TS 會幫我們把所有漏改的地方點出來。
- 價格表 `MODEL_PRICES` 查無型號時回 `null`、UI 不顯示價格。本地模型正好落在這條路徑，
  **不需要特別處理**（但可以考慮顯示「本機・免費」，見 §5.3）。

---

## 3. 設計決策

### 3.1 provider id 叫 `'local'`，不叫 `'ollama'`

理由：實際協定是「OpenAI 相容的 chat/completions」，Ollama 只是其中一種伺服器。
叫 `ollama` 會讓 LM Studio 使用者以為不能用，之後也很難改名（設定檔已存了字串）。

UI 文案：**「本機／自訂端點（OpenAI 相容）」**，說明文字舉例 Ollama、LM Studio。

### 3.2 端點改成 per-provider map

```ts
llm: {
  endpoint?: string                      // @deprecated 保留給遷移
  endpoints?: Partial<Record<LlmProvider, string>>
  utilityEndpoints?: Partial<Record<LlmProvider, string>>   // ← 見下方討論
  …
}
```

**為什麼不是只加 `utilityEndpoint` 一個欄位？**
因為「主模型也可能是 local」。如果主用本機 A 機、輔助用本機 B 機（少見但合理），
單一欄位又會撞在一起。做成 map，`applyUtilitySettings()` 換 provider 時
endpoint 自然跟著換，不需要額外的 if。

**簡化選項（推薦先做這個）**：只做 `endpoints`（per-provider，主輔共用同一張表）。
主＝Claude／輔＝local 這個核心情境已經成立，因為兩者 provider 不同、
查表自然拿到不同 endpoint。`utilityEndpoints`（同 provider 但主輔不同機）
先不做，等真的有人要再說。**§7 的工項以此為準。**

**遷移**：讀取時若 `endpoints` 不存在而 `endpoint` 有值，
依當時的 `provider` 寫進 `endpoints[provider]`。
⚠️ 照 CLAUDE.md §5 的教訓：**遷移要寫回磁碟**，
不能只做在讀取路徑的純函式裡，否則冪等旗標永遠不生效。
落點：`src/core/store/settings.ts`（`renameModelIdMap` 附近已有同類遷移可比照）。

### 3.3 沿用 `core/llm/openai.ts`，不寫新 adapter

P0 推翻了原本的假設（見 §2.3），local 走的協定與 OpenAI／Grok **完全相同**，
所以 `chatWithLLM()` 的 switch（`index.ts:47`）把 `'local'` 併進 `'openai'`／`'grok'`
那條路徑即可，`classifyEmotionWithLLM` 等三支「OpenAI / Grok」註解的區塊也一樣通吃。

**唯一的實作差異**：local 要在 request body 加 `reasoning: { effort: 'none' }`。
四個呼叫點都要加（chat／emotion／newsSubjectivity／testMessage），
抽一個小 helper 避免漏：

```ts
/** 本機模型的思考關閉參數。思考模型會把 token 預算吃光導致回空字串（§2.3）。 */
export function localReasoningParams(provider: string): { reasoning?: { effort: 'none' } } {
  return provider === 'local' ? { reasoning: { effort: 'none' } } : {}
}
```

> ⚠️ **漏加就是空回應**，而且 `openai.ts:113` 會把它變成
> `Empty response from model` 這種看不出根因的錯誤。四個點要一起加。

### 3.4 API Key 可選

`endpointForProvider()` 加 local 分支；`no-api-key` 檢查改成
「local 以外才強制」。SDK 需要非空字串，傳 `'ollama'` 之類的 placeholder
（OpenAI SDK 會照樣塞進 `Authorization` header，本地伺服器一律忽略）。

若使用者真的在自架端點上設了金鑰（LiteLLM、有 auth 的反向代理），
`apiKeys.local` 照樣可填，走既有的 `safeStorage` 加密路徑。

### 3.5 模型清單改成動態

本地模型的型號是使用者自己 pull 的，寫死清單毫無意義。
`MODELS_BY_PROVIDER.local = []`，UI 改成：
- 「測試連線」成功時把 `GET /v1/models` 的結果填進下拉（現有 `testLLMConnection`
  已經回傳 `models`，只是**上限 5 筆**要放寬給 local）。
- 下拉旁保留自由輸入框（現在其他家也允許手打自訂 ID）。

`DEFAULT_MODEL_BY_PROVIDER.local = ''`（切過去時不預選，逼使用者測連線）。

---

## 4. 手機版的額外考量

手機（獨立模式）直接連 Mac Mini 是可行的，但踩點都在 CLAUDE.md §5 列過：

- **`androidScheme` 必須是 `'http'`** — 已經是了。本地端點是 `http://100.x.x.x:11434`，
  若哪天有人改回 `'https'`，這個功能會第一個死掉（Mixed Content）。
  在 `capacitor.config.ts` 那行註解補一句「本地 LLM 端點也依賴這個」。
- **逾時要自己算，而且要放寬**。CapacitorHttp 忽略 `signal`，
  `mobile/adapters/httpAdapter.ts` 已用 `Promise.race` 翻譯過，照走即可。
  但**本地模型冷啟動很慢**（模型要載進記憶體，8B 在 M4 上首次可能 10–30 秒），
  現有 30 秒的預設對本地首呼可能不夠 → local 的逾時獨立設定，建議 90 秒。
- **Tailscale 在 Android 上是 VPN**：手機要裝 Tailscale App 並連著才連得到。
  這是使用者環境問題，DeST 只需要在連線測試失敗時給出**可行動的錯誤訊息**
  （「連不上這個端點，若是家中電腦請確認同一區網或 VPN 已連線」）。
- 手機端的 provider 清單在 `src/mobile/ui/settings/providerInfo.ts`，要一起加。

**Ollama 本身要開放區網**：`OLLAMA_HOST=0.0.0.0:11434`（macOS 是
`launchctl setenv OLLAMA_HOST "0.0.0.0:11434"` 後重啟 Ollama）。
預設只聽 `127.0.0.1`，不改的話只有 Mac Mini 自己連得到。
這條寫進 §8 使用者指南。

---

## 5. 通用性設計（「大家都能用」的部分）

owner 自己只用 Tailscale + Ollama，但設定要對所有人通用：

### 5.1 只有一個輸入框
UI 上 local 供應商就是：**端點 URL** ＋ **模型**（＋選填金鑰）。
`http://localhost:11434/v1`、`http://100.70.201.116:11434/v1`、
`http://192.168.1.50:1234/v1`（LM Studio）對程式而言毫無差別。

### 5.2 端點預設值與提示
placeholder 給 `http://localhost:11434/v1`（最常見的 Ollama 本機情境）。
說明文字一行：「Ollama 預設 `http://localhost:11434/v1`；
LM Studio 預設 `http://localhost:1234/v1`。跨機請填該機 IP 並確認伺服器已開放區網。」

### 5.3 價格顯示
`modelPriceText()` 查無型號回 `null`，UI 顯示空白。
建議 local 特判顯示「本機・不計費」，比空白清楚（純 UI 層，不動 `modelCatalog`）。

### 5.4 視覺能力
多數本地模型不吃圖。**不做能力偵測**（沒有可靠的 API 可問），
改成：local 供應商時，若訊息帶圖就在 debug log 標一行
「本機模型可能不支援圖片」，行為上照送——支援的模型（llava、qwen-vl）能用，
不支援的會回錯誤，使用者看得到原因。不要自作聰明擋掉。

---

## 6. 影響範圍（TS 會逼你改的檔）

`LlmProvider` union 加一個值後編譯會炸的地方，就是全部的接點。
`grep "'grok'"` 目前命中 11 個檔，等同 blast radius：

| 檔案 | 要做什麼 |
|---|---|
| `src/core/data/types.ts` | union 加 `'local'` |
| `src/core/types.ts` | `provider`／`utilityProvider` 兩處字面量 union；新增 `endpoints` |
| `src/core/llm/modelCatalog.ts` | `MODELS_BY_PROVIDER`／`DEFAULT_MODEL_BY_PROVIDER` 補 local |
| `src/core/llm/index.ts` | switch 加 case；四支函式的 local 分支；`endpointForProvider` |
| `src/core/llm/openai.ts` | 加 `reasoning:{effort:'none'}`（local 時）；debug 標籤認 local |
| `src/core/prompt/promptUtils.ts` | `applyUtilitySettings()` 改成連 endpoint 一起換 |
| `src/core/store/settings.ts` | `endpoint` → `endpoints` 遷移（**要寫回磁碟**） |
| `src/core/sync/settingsSnapshot.ts` | `SYNC_LLM_PROVIDERS` 加 local；`endpoint: string` → `endpoints` |
| `src/core/sync/settingsPair.ts` | 端點比對列（原本一列變逐 provider 一列） |
| `src/shared/llmBadge.ts` | 徽章文字／顏色 |
| `src/renderer/src/types/index.ts` | 桌面型別鏡像 |
| `src/renderer/src/windows/SettingsWindow.tsx` | 供應商下拉、端點欄位改成跟著 provider 走（現在只在 openai/grok 顯示，`:1212`） |
| `src/main/ipcHandlers.ts` | provider 白名單／驗證 |
| `src/mobile/ui/settings/providerInfo.ts` | 手機供應商清單 |
| `src/mobile/runtime/session.ts` | `setLlmProvider` 等的驗證 |
| `src/main/mobileServer.ts` | `GET /api/settings/sync-snapshot` 跟著新子集 |

> ⚠️ **設定同步的子集改了就是雙邊都要改**，但因為 `settingsSnapshot.ts`
> 是唯一定義、兩端 import，只要不在別處手打物件字面量就不會重蹈 M4 的漂移坑。

---

## 7. 分階段工項

### ~~P0：先驗證可行性~~ ✅ 完成（2026-08-15，對 `100.70.201.116:11434`）

| # | 驗證 | 結果 |
|---|---|---|
| 1 | `GET /v1/models` | ✅ 回 `qwen3:8b`、`willqiu/Llama-Breeze2-8B-Instruct:latest`。**未帶任何 Authorization header 也通** → §3.4 金鑰可選成立 |
| 2 | `POST /v1/chat/completions` | ✅ 200，但 `content` 空、`reasoning` 吃光 50 tokens |
| 3 | `POST /v1/responses` | ✅ **200，不是預期的 404** → §2.3 假設推翻，不必寫新 adapter |
| 4 | 真實情緒分類 prompt（`max_output_tokens: 20`） | ❌ 預設吐空 → ✅ 帶 `reasoning:{effort:'none'}` 後回 `"angry"`，3 tokens。**判定可用** |
| 5 | 非思考模型帶 `reasoning.effort` | ✅ 不報錯，原樣忽略 → 不需能力偵測 |

結論：提案成立且比原規劃簡單（少一支 adapter），改動集中在
「union 加值 ＋ endpoints 拆表 ＋ 四處加 reasoning 參數 ＋ UI」。

### P1：core 層（可單元測試，不碰 UI）
5. union 加值、`endpoints` 欄位與遷移
6. ~~`openaiCompat.ts` adapter~~ 不需要（P0 推翻）
7. `index.ts` 五處分支（chat／emotion／news／testConnection／testMessage）＋ `localReasoningParams()`
8. `applyUtilitySettings()` 換 endpoint
9. 測試：`tests/` 補 provider 路由與遷移的 case；`npm test` 綠

### P2：桌面 UI
10. 設定視窗：供應商選項、端點欄位改成 per-provider、金鑰改選填
11. 連線測試回填模型清單（放寬 5 筆上限）
12. 輔助模型區塊：能獨立選 local
13. 手動驗收：主＝Claude／輔＝local，聊一輪看情緒分類有沒有走本機
    （LogWindow 的 debugPrompt 會顯示 provider 與 model）

### P3：手機 ＋ 同步
14. `providerInfo.ts`、`session.ts` 驗證
15. local 的逾時放寬（90 秒）
16. 設定同步子集：`SYNC_LLM_PROVIDERS`、endpoints 比對列
17. 真機驗收：手機（Tailscale 連著）獨立模式選 local，送一則訊息

**建議切點**：P0 做完先回報結果再決定要不要投 P1。P1+P2 是一個 PR，
P3 另一個（同步子集改動要跟 M4/M5 真機驗證錯開，別讓兩件事的問題混在一起）。

---

## 8. 使用者設定指南（之後放進 README／設定頁說明）

**Mac／Linux 上的 Ollama 開放區網**
```
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"
```
（macOS；設完重啟 Ollama。Linux 是改 systemd unit 的 `Environment=`。）

**在 DeST 填**
- 供應商：本機／自訂端點
- 端點：`http://<那台機器的 IP>:11434/v1`（同機就是 `localhost`）
- 模型：按「測試連線」後從下拉挑，或手打（如 `qwen3:8b`）
- 金鑰：留空

**跨機連線**：同一區網直接填內網 IP；不同網路建議 Tailscale
（裝好後用它給的 100.x.x.x）。手機要用的話，手機也要裝並連著。

---

## 9. 落地筆記（2026-08-15）

**P1（core）＋ P2（桌面 UI）＋ P3 的手機部分已完成。**
`npm run typecheck` 過；`npm test` 58 檔 731 項全過（新增 18 項）。

### 9.1 與規劃不同的決定

- **不需要新 adapter**（§2.3）：Ollama 支援 Responses API，`openai.ts` 原樣重用，
  `chatWithLLM` 的 switch 把 `local` 併進 `openai` 那條路徑。
- **`utilityEndpoints` 沒做也不需要做**：`endpoints` 一張表就夠了。
  `applyUtilitySettings()` 換 provider 時順手把 `endpoint` 換成
  `endpoints[utilityProvider]`，主輔自然分流。
- **`resolveApiKeyForProvider()` 這支是新加的**：規劃只寫「放行 local」，
  實作時發現金鑰在四個地方各自取用（`index.ts` 三處 ＋ `promptUtils.resolveApiKey`），
  各自加 if 遲早漏一個，抽成一支。

### 9.1b 金鑰檢查散落十幾處（owner 2026-08-15 追問後才補完）

第一輪實作**只改了連線測試與 SDK 呼叫**，於是 local 仍然聊不了天：
`ipcHandlers.ts` 與手機 runtime 各自寫著
`settings.llm.apiKeys[settings.llm.provider]?.trim()`，共 9 處關卡
（送訊息 ×2、群組發話、提醒發話、自動摘要 ×2、手動摘要 ×2、主動發話），
每一處都會回「尚未設定 API Key」——而使用者根本不需要金鑰，**訊息本身是錯的**。

現在統一走 `hasUsableApiKey(settings)`（`core/prompt/promptUtils.ts`），
`providerNeedsApiKey(provider)` 是唯一判斷「這家要不要金鑰」的地方。
**新增擋在 LLM 前面的檢查一律用這支**，不要再手寫 `apiKeys[provider]?.trim()`。

UI 文案也一起改：手機設定頁的金鑰欄位在 local 下顯示「不需要填」而非「尚未設定」；
桌面提醒管理視窗不再把 local 誤報成「離線模式」。

### 9.2 實作時發現的既有 bug（順手修掉）

1. **輔助模型的連線測試用錯端點**（`SettingsWindow.tsx`）：
   原本寫死 `endpoint: draft.llm.endpoint`（主模型的），
   在「主＝雲端／輔助＝本機」時會拿雲端 URL 去測本機端點，永遠失敗。
   改成 `getEndpoint(utilityProvider)`。
2. **`httpAdapter` 的 30 秒天花板會套在有 signal 的請求上**
   （`mobile/adapters/httpAdapter.ts`）：程式與自己的註解矛盾——
   註解寫「放得比任何呼叫端自己的逾時都寬」，實作卻是無條件 race，
   等於**手機上任何請求最多 30 秒**。本機 LLM 冷啟動（8B 載進記憶體）
   很容易超過，症狀會是「第一次問一定失敗、之後才正常」。
   改成有 signal 就只聽呼叫端的。
   ⚠️ 這條影響的**不只本機模型**——雲端長回覆過去也會在 30 秒被砍，
   只是比較少見。手機真機驗證時值得留意有沒有副作用。

### 9.3 端到端驗證（走真正的程式路徑，不是 curl）

臨時腳本 `import` 真正的 `core/llm` 對 `100.70.201.116:11434` 實跑，四條全過：

| # | 路徑 | 結果 |
|---|---|---|
| 1 | `testLLMConnection`（金鑰留空） | ✅ 回 `qwen3:8b`、`Llama-Breeze2-8B` |
| 2 | `testLLMMessage` | ✅ `"Hello!"` |
| 3 | `chatWithLLM`（完整角色扮演 prompt） | ✅ 「考試沒考好嗎？別太難過⋯⋯」297/30 tokens，情緒標籤解析正常 |
| 4 | `classifyEmotionWithLLM`，**主＝claude／輔助＝local** | ✅ 回 `annoyance`，137/4 tokens |

第 4 條是整個功能的核心情境：主模型設成 Claude、輔助設成 local，
請求確實走到本機端點——證明 `endpoints` 分流有效。

### 9.3b 自訂補充指示（owner 2026-08-15 追問後補上）

owner 用 Qwen3 實測角色扮演「不差」，但想強制輸出繁體中文。**沒有寫死
`if (provider === 'local')` 塞一條語言規則**——那樣做只是把同一種寫死換了個位置，
以後想對雲端模型也加類似規則、或想加其他規則，都得再改一次程式。

改成通用欄位 `settings.llm.extraInstruction`（字串，選填，上限 2000 字），附加在
`buildSystemPrompt()` 最尾端、對**所有供應商**生效，不特判 provider。放在最尾端是
刻意的：使用者的補充規則理應蓋過前面的通用規則，不該被稀釋在中間。

桌面／手機 UI 都在「進階」區塊加了一個文字框；也接進 S2 M5 設定同步
（`settingsSnapshot.ts`／`settingsPair.ts`／`syncSettingsApply.ts`，比照 `llm.provider`
單一欄位的處理方式）與遙控模式的電腦端 API
（`POST /api/settings/llm-extra-instruction`）。新增測試 6 項（3 項 `buildSystemPrompt`
行為、既有兩個同步測試補欄位）。

### 9.4 尚未驗證

- **桌面 UI 沒有實際點過**（Electron 跑不進瀏覽器預覽）。
  設定視窗的供應商下拉、端點欄位、快速填入、連線後的模型清單回填都只有型別保證。
- **手機真機完全沒驗**：APK 沒重打。特別要看 §9.2 第 2 點的逾時改動有無副作用。
- **設定同步**：`llm.endpoints.<provider>` 的逐列比對只有單元測試，
  沒跟真的電腦對過。這部分建議跟 M4/M5 的真機驗證一起做。
