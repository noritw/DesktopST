package tw.nori.dest.reminder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 提醒通知的發送。
 *
 * ⚠️ **頻道 importance 必須是 HIGH(4)**。Capacitor 預設頻道是 3，
 * 只會安靜躺進通知欄、不會有橫幅彈出——手機又常在震動模式，
 * 使用者看到的就是「時間到了什麼都沒發生」（owner 2026-08-09 實機回報）。
 *
 * **頻道建好之後 importance 就改不動了**（Android 限制，除非重裝），
 * 所以 id 帶版號；日後要調整就換一個 id。
 * 這裡的 id 與 JS 側 `reminderScheduler.ts` 的 CHANNEL_ID 是**同一個**，
 * 兩邊發出來的通知才會落在同一個頻道、同一組使用者設定底下。
 */
public class ReminderNotifier {

  public static final String CHANNEL_ID = "dest-reminders-v1";

  public static void ensureChannel(Context context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = context.getSystemService(NotificationManager.class);
    if (nm == null) return;
    NotificationChannel ch = new NotificationChannel(
      CHANNEL_ID,
      "提醒",
      NotificationManager.IMPORTANCE_HIGH
    );
    ch.setDescription("排定的角色提醒");
    ch.enableVibration(true);
    ch.enableLights(true);
    nm.createNotificationChannel(ch);
  }

  /**
   * 發出提醒通知。點擊會打開 App。
   *
   * `notificationId` 由提醒 id 雜湊而來（與 JS 側 `hashStringToNumber` 同語意）：
   * 同一則提醒重複觸發時覆蓋自己，而不是在通知欄疊成一排。
   */
  public static void notify(Context context, String reminderId, String title, String body) {
    ensureChannel(context);

    Intent open = context
      .getPackageManager()
      .getLaunchIntentForPackage(context.getPackageName());
    PendingIntent pi = null;
    if (open != null) {
      open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      pi = PendingIntent.getActivity(
        context,
        notificationIdFor(reminderId),
        open,
        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
      );
    }

    NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(Notification.CATEGORY_REMINDER)
      .setAutoCancel(true);
    if (pi != null) b.setContentIntent(pi);

    try {
      NotificationManagerCompat.from(context).notify(notificationIdFor(reminderId), b.build());
    } catch (SecurityException e) {
      // POST_NOTIFICATIONS 沒授權。這裡不能做什麼，前景時 JS 會再要一次權限。
    }
  }

  public static int notificationIdFor(String reminderId) {
    int hash = 0;
    for (int i = 0; i < reminderId.length(); i++) {
      hash = (hash << 5) - hash + reminderId.charAt(i);
    }
    return Math.abs(hash) % 2147483647 + 1;
  }
}
