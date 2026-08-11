package tw.nori.dest.reminder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;
import android.util.Log;

/**
 * 鬧鐘到點時的廣播接收器。
 *
 * ⚠️ **這裡只有大約 10 秒**（BroadcastReceiver 的執行上限），
 * 不可以在這裡打網路。目前的做法是直接用「離開前景時生好的快取台詞」發通知，
 * 不需要網路；現場生成（headless WebView）是下一步，屆時改成在這裡啟動前景服務。
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

    // 響過就不留了。下一次由 JS 在前景重新排（interval／daily 的下一輪）。
    store.remove(id);

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
        Log.i(TAG, "螢幕暗著，略過: " + id);
      }
      return;
    }

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
    Log.i(TAG, "已發出提醒通知: " + id);
  }

  private boolean screenOn(Context context) {
    PowerManager pm = context.getSystemService(PowerManager.class);
    return pm == null || pm.isInteractive();
  }
}
