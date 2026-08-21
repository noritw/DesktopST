package tw.nori.dest.reminder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * 鬧鐘到點時的廣播接收器。
 *
 * ⚠️ **這裡只有大約 10 秒**（BroadcastReceiver 的執行上限），不可以在這裡打網路。
 * 所以真正的工作交給 `ReminderForegroundService`：它起一個隱藏 WebView
 * 現場生成當下的台詞（§2.1 主線）。服務起不來時才退回這裡直接用快取台詞發通知。
 *
 * 螢幕狀態判定放在這裡，是因為只有原生層問得到 `PowerManager.isInteractive()`——
 * JS 側的 `screenLikelyOn()` 一律回 true（App 在背景不等於螢幕暗）。
 * 判斷本身的語意與 `core/reminder/gate.ts` 對齊，別在這裡另立規則。
 */
public class ReminderAlarmReceiver extends BroadcastReceiver {

  public static final String ACTION_FIRE = "tw.nori.dest.REMINDER_FIRE";
  public static final String EXTRA_ID = "reminderId";

  private static final String TAG = "ReminderAlarm";

  @Override
  public void onReceive(Context context, Intent intent) {
    String id = intent.getStringExtra(EXTRA_ID);
    if (id == null) return;

    ReminderAlarmStore store = new ReminderAlarmStore(context);
    ReminderAlarmStore.Entry entry = store.get(id);
    if (entry == null) {
      Log.w(TAG, "鬧鐘響了但找不到紀錄: " + id);
      return;
    }

    if ("screen_on_only".equals(entry.wakeMode) && !screenOn(context)) {
      if ("notify_on_unlock".equals(entry.inactiveBehavior)) {
        /*
         * 押後：留在 store 裡，等 App 下次回到前景時由 JS 補發。
         * 這裡不自己排一個「亮屏廣播」的接收器——那需要常駐註冊 SCREEN_ON，
         * 為了一個補發功能養一個常駐 receiver 不划算。
         */
        entry.triggerAtMs = 0; // 0 = 已到期、等補發
        store.put(entry);
        Log.i(TAG, "螢幕暗著，押後等亮屏補發: " + id);
      } else {
        store.remove(id);
        Log.i(TAG, "螢幕暗著，略過: " + id);
      }
      return;
    }

    /*
     * 主線：交給前景服務現場生成。
     *
     * 這裡**不能**先把 store 的紀錄刪掉——服務要靠它拿快取台詞當底線，
     * 由服務自己在結束時清（`ReminderForegroundService.finish()`）。
     */
    try {
      /*
       * 這裡固定傳 screenOn=true 是對的，不是偷懶：
       * `screen_on_only` 的螢幕判定在上面就做完了，能走到這行代表
       * 「螢幕亮著」或「這則本來就不管螢幕」，兩種情況對 gate 而言都等同亮著。
       */
      ContextCompat.startForegroundService(
        context,
        ReminderForegroundService.intentFor(context, id, true, entry.occurrenceAtMs)
      );
      Log.i(TAG, "已交給前景服務現場生成: " + id);
      return;
    } catch (Exception e) {
      /*
       * 起不來的情況：系統沒給白名單豁免、或 Android 15+ 的
       * shortService 限制。退回直接用快取台詞——晚一點、舊一點，
       * 但至少該響的響了。
       */
      Log.w(TAG, "前景服務起不來，退回快取台詞: " + e.getMessage());
    }

    store.remove(id);
    notifyFromCache(context, id, entry);
  }

  private void notifyFromCache(Context context, String id, ReminderAlarmStore.Entry entry) {
    String body = entry.body == null ? "" : entry.body.trim();
    if (body.isEmpty()) {
      /*
       * 沒有快取台詞就**不發通知**。
       * 這是刻意的：提醒的賣點是角色用自己的口吻講話，
       * 硬發一則「提醒：喝水」等於把功能降級成行事曆
       * （見 reminderSpeak.ts 檔頭與計畫書 §2.1）。
       */
      Log.i(TAG, "沒有可用的台詞，不發通知: " + id);
      return;
    }

    String title = entry.title == null || entry.title.isEmpty() ? "提醒" : entry.title;
    ReminderNotifier.notify(context, id, title, body);
    Log.i(TAG, "已發出提醒通知（快取台詞）: " + id);
  }

  private boolean screenOn(Context context) {
    PowerManager pm = context.getSystemService(PowerManager.class);
    return pm == null || pm.isInteractive();
  }
}
