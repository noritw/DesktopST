# 手機獨立版提醒 —— 實機驗證記錄

實作：2026-08-09 · 裝置：Pixel 10a（Android 15，`tw.nori.dest` debug build）
狀態：**端對端驗證通過**（排程 → 觸發 → 系統通知）

---

## 1. 驗證結果

用 `adb` 把一則提醒改成 70 秒後觸發，重啟 app 觀察完整鏈路：

```
[Reminder] 通知頻道已就緒
[Reminder] 更新 2 個提醒
[Reminder] 排程 "馬上提醒測試" - 63272ms 後 (下午4:06:56)
[Reminder] 觸發 "馬上提醒測試"
[Reminder] 發送通知: "馬上提醒測試" (ID: 1287788010)
[Reminder] 通知已發送
```

`dumpsys notification` 同時確認：

```
NotificationRecord(pkg=tw.nori.dest id=1287788010 importance=4
  Notification(channel=dest-reminders-v1 flags=ONLY_ALERT_ONCE|AUTO_CANCEL))
```

排程計算、觸發、通知送出全部正常。

---

## 2. owner 回報的三個現象，各自的真正原因

| 回報 | 真正原因 |
|---|---|
| 「設 2 分鐘後沒跳」 | 提醒**實際上設在 45 分鐘後**。切到「一次性」時預設是 `Date.now() + 1 小時`，沒改到就會是一小時後。已加「目前設定：約 N 分鐘後」提示，設錯當下就看得出來 |
| 「編輯器 16:43，清單變 4:43」 | 原生 `datetime-local`／`time` 選擇器照**裝置語系**畫（zh-TW ＝「下午4:43」），清單卻自己 `padStart` 拼 24 小時制。**資料沒錯**，是兩邊格式不一致。已統一走 `toLocaleTimeString()` |
| 「通知欄什麼都沒有」 | 兩個疊在一起：① 用 Capacitor 預設頻道 importance=3，不會有橫幅彈出，只會安靜躺進通知欄 ② **配對的 Wear OS 手錶把通知轉走後連帶清掉手機那則**（見下） |

### 2.1 手錶會把通知吃掉

```
16:06:57.080 WearNotifPipeline: Processing new notification: tw.nori.dest|1287788010
16:06:57.238 WearNotifPipeline: [Sender] Putting notification data item ...
16:07:06.718 WearNotifRemoval: Received dismissal from watch, now dismissing on phone
```

發出 0.3 秒後轉發到手錶，10 秒後手錶端被清掉，手機通知欄的也跟著消失。
**手機通知欄看不到 ≠ 沒發出去** —— 之後查這類問題要先看 `dumpsys notification` 與
`WearNotif*` 的 logcat，不要只看通知欄。

---

## 3. 這次改了什麼

| 檔案 | 改動 |
|---|---|
| `src/mobile/runtime/reminderScheduler.ts` | 專屬頻道 `dest-reminders-v1`（importance 4 ＋震動），通知帶 `channelId`；排程／觸發／發送各留一行 log |
| `src/mobile/ui/settings/reminderFormat.ts` | 新檔。時間格式統一走 `toLocaleTimeString()`；`formatRelative()` 算「還有多久」 |
| `src/mobile/ui/settings/RemindersView.tsx` | 改用共用的 `scheduleLabel`；一次性提醒的敘述帶「（約 N 分鐘後）」 |
| `src/mobile/ui/settings/ReminderEditor.tsx` | 一次性的時間欄位下方顯示「目前設定：約 N 分鐘後」／「這個時間已經過了」 |

⚠️ **channel 的 importance 建好就改不動**（Android 限制），要調整得換一個 channel id。

---

## 4. 真機除錯手法（下次照做）

```bash
adb logcat -c && adb shell am start -n tw.nori.dest/.MainActivity
adb logcat -d | grep -a Reminder                      # 排程與觸發
adb shell run-as tw.nori.dest cat files/reminders.json # 直接讀資料（debug build 限定）
adb shell dumpsys notification --noredact | grep -a tw.nori.dest
```

改裝置上的資料來測特定時間（記得先備份、測完還原）：

```bash
adb shell "run-as tw.nori.dest sh -c 'echo <base64> | base64 -d > files/reminders.json'"
```

---

## 5. 尚未做

- 桌面 ↔ 手機提醒同步（S2，排在獨立版功能補完之後）
- `notificationDevice` 的 `desktop`／`both` 需要兩台裝置才驗得到，目前只驗過 `mobile`
- 點通知開啟 app 並導向對話
- 提醒音量／自訂音效（桌面有 `ui.reminderNotificationSound`，手機還沒接）
