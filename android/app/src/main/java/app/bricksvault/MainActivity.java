package app.bricksvault;

import android.graphics.Color;
import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Light defaults matching the light shell; theme.js re-syncs both bars
        // through the SystemBars plugin as soon as the web theme resolves.
        registerPlugin(SystemBarsPlugin.class);
        setTheme(R.style.AppTheme_NoActionBar);
        getWindow().setStatusBarColor(Color.parseColor("#F5F1E8"));
        getWindow().setNavigationBarColor(Color.parseColor("#FFFFFF"));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        super.onCreate(savedInstanceState);
    }
}
