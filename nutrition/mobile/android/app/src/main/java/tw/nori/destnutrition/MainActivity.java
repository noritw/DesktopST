package tw.nori.destnutrition;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import tw.nori.destnutrition.widget.NutritionWidgetBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NutritionWidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
