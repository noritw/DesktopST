# 對白泡泡 & 角色分層 — 狀態機設計

## 目標

角色發話時，即使使用者沒勾「永遠在最上層」，角色和對白泡泡都要一起浮到最前面。
使用者關閉對白框、或點擊/拖曳角色後，再把角色降回原本層級。

---

## 涉及的視窗

| 視窗 | 建立時的 alwaysOnTop | 說明 |
|------|---------------------|------|
| Character Window (cw) | `charactersAlwaysOnTop ? 'floating' : false` | 透明桌寵視窗 |
| Bubble Window (bw) | `charactersAlwaysOnTop ? 'screen-saver' : false` | 對白泡泡視窗 |

---

## 角色分層狀態（per character）

```
                    ┌──────────────────────────────────────────────────┐
                    │                                                  │
    ┌───────┐  showBubble   ┌──────────┐   closeBubble/     ┌───────┐ │
    │ IDLE  │──────────────▶│ SPEAKING │──dragStart/click──▶│ IDLE  │ │
    └───────┘               └──────────┘                    └───────┘ │
        ▲                        │                              │     │
        │                        │ nextMessage                  │     │
        │                        ▼                              │     │
        │                   ┌──────────┐                        │     │
        │                   │ SPEAKING │ (bubble still visible) │     │
        │                   └──────────┘                        │     │
        │                        │                              │     │
        └────────────────────────┴──────────────────────────────┘     │
                                                                      │
    (dragEnd 且 bubble 還在 → 重新進入 SPEAKING)                       │
                                                                      │
```

### 狀態定義

| 狀態 | cw.alwaysOnTop | bw.alwaysOnTop | 說明 |
|------|---------------|---------------|------|
| **IDLE** | `charactersAlwaysOnTop ? 'floating' : false` | (hidden 或 false) | 正常待機 |
| **SPEAKING** | `'screen-saver'` | `'screen-saver'` | 對白顯示中，兩者都在最頂層 |

### 轉換觸發

| 從 | 到 | 觸發事件 | 動作 |
|----|----|---------|----|
| IDLE → SPEAKING | `showSpeechBubble` (bubble hidden→visible) | `cw.setAlwaysOnTop(true, 'screen-saver')` + `bw.setAlwaysOnTop(true, 'screen-saver')` + `moveTop()` |
| SPEAKING → SPEAKING | `showSpeechBubble` (bubble already visible) | **只 `moveTop()`，不動 setAlwaysOnTop** + 送 `bubble:show` 更新文字 |
| SPEAKING → IDLE | `closeBubble` / `hideSpeechBubble` | `cw.setAlwaysOnTop(原始level)` + `bw.setAlwaysOnTop(false)` + `bw.hide()` |
| SPEAKING → IDLE | `beginCharacterDrag` (使用者拖曳) | `cw.setAlwaysOnTop(原始level)` (bubble 會在 drag 中被 hide) |
| IDLE → SPEAKING | drag 結束且 bubble 重現 | 重新 promote 兩者 |

---

## 關鍵原則

1. **`setAlwaysOnTop` 只在狀態轉換時呼叫**（IDLE↔SPEAKING）。狀態內重複發話只用 `moveTop()`。
2. **降層（demote）一定是成對的**：character 降 + bubble 降（或 hide）。
3. **`charactersAlwaysOnTop = true` 時**：SPEAKING 和 IDLE 差別只在 cw 是 'floating' vs 'screen-saver'。
4. **`charactersAlwaysOnTop = false` 時**：IDLE = 都不 topmost；SPEAKING = 都 topmost。

---

## 如何追蹤當前狀態

新增一個 Map：`characterSpeakingState: Map<string, boolean>`

- 進入 SPEAKING：設為 `true`
- 回到 IDLE：設為 `false` / 刪除

判斷邏輯：
- `showSpeechBubble` 中，如果 `characterSpeakingState.get(id)` = true → 已在 SPEAKING，只 moveTop
- 如果 = false/undefined → 進入 SPEAKING，做 promote

---

## 與原始碼的對應

| 原始函式 | 狀態機角色 |
|---------|-----------|
| `raiseBubbleAndCharacterForShow()` | IDLE → SPEAKING 的 promote 動作 |
| `restoreCharacterAlwaysOnTopAfterBubbleHide()` | SPEAKING → IDLE 的 demote 動作（但原本只處理 cw） |
| `hideSpeechBubble()` | 觸發 SPEAKING → IDLE |
| `closeBubble()` (renderer) | 觸發 SPEAKING → IDLE（透過 IPC） |
| `beginCharacterDrag()` | 觸發 SPEAKING → IDLE |
| `reconcileSpeechBubbleAfterCharacterDrag()` | 拖曳結束，若 bubble 重現 → 觸發 IDLE → SPEAKING |

---

## 實作計劃

1. 新增 `const characterSpeakingState = new Map<string, boolean>()`
2. 新增 `promoteForSpeaking(characterId, bw)` — IDLE → SPEAKING 的完整動作
3. 新增 `demoteAfterSpeaking(characterId)` — SPEAKING → IDLE 的完整動作
4. 修改 `dispatchShow`：
   - bubble visible → 只 `moveTop()` + send content（不碰 alwaysOnTop）
   - bubble hidden → 呼叫 `promoteForSpeaking()` （在 reveal 時）
5. 修改 `hideSpeechBubble` / `closeBubble` → 呼叫 `demoteAfterSpeaking()`
6. 修改 `beginCharacterDrag` → 呼叫 `demoteAfterSpeaking()`
7. 修改 `reconcileSpeechBubbleAfterCharacterDrag` → 呼叫 `promoteForSpeaking()`

---

## 泡泡間歇性不顯示的排查紀錄（2026-08-03，v0.3.11）

症狀：多角色連續發話時，偶爾有角色的泡泡完全不出現（Log 有訊息），或出現了但內容是上一句。
去 Log 點該則訊息（`bubble:debug-show`）也叫不出來。

### 根因：顯示路徑不該信任 `isVisible()`

`hideSpeechBubble()` 執行 `bw.hide()` 之後，Electron 的 `bw.isVisible()` **仍會回報 `true`**
（主程序 log 實測：hide 後的下一次 `showSpeechBubble` 讀到 `wasVisible=true`）。

而顯示路徑上兩處 `showInactive()` 都拿它當守衛：

- `dispatchShow`：`if (!alreadyVisible) bw.showInactive()`
- `revealSpeechBubble`：`if (!bw.isVisible()) bw.showInactive()`

於是**被關閉過的泡泡再也沒有人叫它 show**。後續的 `setBounds` / `setOpacity(1)` / `moveTop()`
全部作用在未顯示的視窗上（都會「成功」），而且沒有任何路徑能恢復
→ 那個角色的泡泡從此不再出現。這解釋了「手動按 X 關掉之後，下一輪那個角色就沒泡泡」。

**修法**：兩處都改為無條件 `bw.showInactive()`。對已顯示的視窗重複呼叫無副作用（不奪焦）。

### 一併修掉的其他競態

| 問題 | 修法 |
|---|---|
| 內容純推送、無拉取，推送早於 React 掛載就丟事件；保底逾時卻無條件 reveal → 掀開空白／上一句 | payload 帶 `seq`；renderer 掛好 listener 後主動 `bubble:request-latest` 拉取，套用後 `bubble:ack`；保底逾時**只在 ack 之後**才准 reveal |
| 上一次現身的 measure 慢一拍回報，掀開新內容 | `bubble:reveal` 需帶 `seq` 且與 pending 相符 |
| 上一句的自動消失計時器在新對白在途時燒完，`bubble:close` 把 pending 清掉 → 該則永遠不出現 | `bubble:close` 帶 `seq`，主程序若已排入更新的一次現身則忽略 |
| `setAlwaysOnTop` 造成 DWM 位移，`moved` 誤判成使用者拖曳寫入 `bubbleUserOffset`（實測 -14,66 / -32,62），泡泡越用越歪 | `promoteForSpeaking` 期間 `suppressBubbleOffsetWrite()` |

### 查過但**不是**成因的方向（不要重查）

- **B1 抽 core**：`windowManager.ts` 完全沒被碰過，與本問題無關
- **訊息產生／持久化／廣播**：對話正常寫入、LogWindow 顯示正常
- **泡泡位置跑掉**：log 顯示每次 reveal 的 bounds 都在螢幕內、尺寸合理
- **opacity 被壓成 0**：每次 reveal 都是 `opacity=1`
- **renderer 沒收到內容**：renderer 端 log 確認 `applyShow` 有套用、`measure` 量到真實文字長度
- **LRU `pruneSpeechBubbleWindows` 砍掉 renderer**：會提高重建頻率，但不是本症狀的成因

排查方式：在 `showSpeechBubble` / `revealSpeechBubble` / `hideSpeechBubble` /
`refreshBubbleUserOffsetFromWindow` 印狀態，再加一個 `bubble:diag` IPC 把 renderer 端
（`applyShow` / `measure` / 收到 `bubble:hide`）轉發到同一個終端機對時序。
**決定性線索是 hide 之後的 `wasVisible=true`** —— 主程序每一環都「正常」卻看不到畫面時，
要先懷疑視窗狀態查詢本身，而不是繼續調時序。診斷 log 已於包版前移除。
