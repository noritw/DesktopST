package tw.nori.dest.reminder;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * AlarmManager 的註冊與取消。
 *
 * 為什麼一定要走原生鬧鐘：JS 的 `setTimeout` 活在 WebView 裡，
 * App 被劃掉或系統進入 Doze，計時器就跟著消失——這正是獨立版提醒
 * 最初要解決的問題（owner 切獨立版的主因）。
 *
 * 用 `setExactAndAllowWhileIdle`：Doze 中也會準點觸發，
 * 而且**待機期間不耗電**（是系統的排程，不是我們在輪詢）。
 */
public class ReminderScheduler {

  private static final String TAG = "ReminderAlarm";

  public static void schedule(Context context, ReminderAlarmStore.Entry entry) {
    AlarmManager am = context.getSystemService(AlarmManager.class);
    if (am == null) return;

    // 過去的時間不排——排了會立刻觸發，使用者會收到一則莫名其妙的提醒
    if (entry.triggerAtMs <= System.currentTimeMillis()) {
      Log.w(TAG, "略過已過期的鬧鐘 " + entry.id);
      return;
    }

    PendingIntent pi = pendingIntent(context, entry.id);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) {
        /*
         * Android 12+ 要使用者去系統設定授權「鬧鐘與提醒」。
         * 沒授權就退回 setAndAllowWhileIdle（可能誤差數分鐘）——
         * 晚幾分鐘還是比完全不響好。前端會另外引導使用者去開精準權限。
         */
        Log.w(TAG, "沒有精準鬧鐘權限，退回不精準模式 " + entry.id);
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.triggerAtMs, pi);
      } else {
        am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.triggerAtMs, pi);
      }
      Log.i(TAG, "已註冊鬧鐘 " + entry.id + " @ " + entry.triggerAtMs);
    } catch (SecurityException e) {
      Log.e(TAG, "註冊鬧鐘被拒: " + e.getMessage());
    }
  }

  public static void cancel(Context context, String reminderId) {
    AlarmManager am = context.getSystemService(AlarmManager.class);
    if (am != null) am.cancel(pendingIntent(context, reminderId));
  }

  private static PendingIntent pendingIntent(Context context, String reminderId) {
    Intent i = new Intent(context, ReminderAlarmReceiver.class);
    i.setAction(ReminderAlarmReceiver.ACTION_FIRE);
    // 每則提醒要有自己的 PendingIntent。只靠 requestCode 不夠：
    // Intent 的 extras 不參與比對，data 才會——不設的話會互相覆蓋。
    i.setData(android.net.Uri.parse("dest-reminder://" + reminderId));
    i.putExtra(ReminderAlarmReceiver.EXTRA_ID, reminderId);
    return PendingIntent.getBroadcast(
      context,
      ReminderNotifier.notificationIdFor(reminderId),
      i,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
  }
}
