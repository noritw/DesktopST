package tw.nori.dest.reminder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;

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

  /** 沒有頭像／不需要摘要時用的簡化版，行為與加欄位前完全一致。 */
  public static void notify(Context context, String reminderId, String title, String body) {
    notify(context, reminderId, title, body, null, null);
  }

  /**
   * 發出提醒通知。點擊會打開 App。
   *
   * `notificationId` 由提醒 id 雜湊而來（與 JS 側 `hashStringToNumber` 同語意）：
   * 同一則提醒重複觸發時覆蓋自己，而不是在通知欄疊成一排。
   *
   * `avatarBytes` 有值時設成大圖示——標準 Android 版型固定畫在通知右側，
   * 小圖示會疊成右下角一個徽章蓋在上面（系統範本，不能改成左邊）。
   * 三條發通知路徑（App 活著＝`ReminderPlugin.notify`、headless 現場生成成功、
   * App 被劃掉時的快取底線）都走這一支，行為才會一致。
   */
  public static void notify(
    Context context,
    String reminderId,
    String title,
    String body,
    String summaryText,
    byte[] avatarBytes
  ) {
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

    NotificationCompat.BigTextStyle style = new NotificationCompat.BigTextStyle().bigText(body);
    if (summaryText != null && !summaryText.isEmpty()) style.setSummaryText(summaryText);

    NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_popup_reminder)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(style)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(Notification.CATEGORY_REMINDER)
      .setAutoCancel(true);
    if (pi != null) b.setContentIntent(pi);

    Bitmap avatar = decodeAvatar(avatarBytes);
    if (avatar != null) b.setLargeIcon(avatar);

    try {
      NotificationManagerCompat.from(context).notify(notificationIdFor(reminderId), b.build());
    } catch (SecurityException e) {
      // POST_NOTIFICATIONS 沒授權。這裡不能做什麼，前景時 JS 會再要一次權限。
    }
  }

  /** 壞掉的圖檔不該讓整則通知發不出去，解不出來就當沒有頭像。 */
  private static Bitmap decodeAvatar(byte[] bytes) {
    if (bytes == null || bytes.length == 0) return null;
    try {
      return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    } catch (Exception e) {
      return null;
    }
  }

  /** base64（不含 `data:` 前綴）解成位元組；壞掉就回 null，呼叫端一律視為沒有頭像。 */
  public static byte[] decodeAvatarBase64(String base64) {
    if (base64 == null || base64.isEmpty()) return null;
    try {
      return Base64.decode(base64, Base64.DEFAULT);
    } catch (Exception e) {
      return null;
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
