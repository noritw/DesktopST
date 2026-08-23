package tw.nori.dest;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import tw.nori.dest.reminder.ReminderPlugin;
import tw.nori.dest.widget.DeSTWidgetBridgePlugin;

public class MainActivity extends BridgeActivity {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 自訂外掛要在 super.onCreate 之前註冊，Bridge 建立時才看得到
    registerPlugin(ReminderPlugin.class);
    registerPlugin(DeSTWidgetBridgePlugin.class);
    super.onCreate(savedInstanceState);
  }
}
