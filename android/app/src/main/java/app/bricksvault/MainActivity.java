package app.bricksvault;

import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        final long splashStartedAt = SystemClock.uptimeMillis();
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Light defaults matching the light shell; theme.js re-syncs both bars
        // through the SystemBars plugin as soon as the web theme resolves.
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        boolean appLockEnabled = getSharedPreferences(
                SystemBarsPlugin.PRIVACY_PREFS, MODE_PRIVATE)
                .getBoolean(SystemBarsPlugin.KEY_APP_LOCK, false);
        if (appLockEnabled) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        getWindow().setStatusBarColor(Color.parseColor("#F5F1E8"));
        getWindow().setNavigationBarColor(Color.parseColor("#FFFFFF"));
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        super.onCreate(savedInstanceState);

        // Keep the branded launch screen until the bundled WebView is ready,
        // while retaining a hard timeout so a failed load can never trap users.
        splashScreen.setKeepOnScreenCondition(() -> {
            long elapsed = SystemClock.uptimeMillis() - splashStartedAt;
            boolean webViewLoading = getBridge() == null
                || getBridge().getWebView() == null
                || getBridge().getWebView().getProgress() < 100;
            return elapsed < 900 || (elapsed < 5000 && webViewLoading);
        });
    }
}
