package tw.nori.destnutrition;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import tw.nori.destnutrition.widget.NutritionWidgetBridgePlugin;
import tw.nori.destnutrition.share.ShareReceiverPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NutritionWidgetBridgePlugin.class);
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
        ShareReceiverPlugin.deliver(getIntent());
    }

    // MainActivity 是 singleTask，App 已在背景時分享進來不會重開實例，
    // 是走這裡而不是 onCreate——兩處都要接住。
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        ShareReceiverPlugin.deliver(intent);
    }
}
