package app.bricksvault;

import android.content.res.Configuration;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowManager;

import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        final long splashStartedAt = SystemClock.uptimeMillis();
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        // Match the resource-selected splash immediately, before the WebView can
        // resolve its theme. SystemBarsPlugin re-syncs after the web theme loads.
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        boolean appLockEnabled = getSharedPreferences(
                SystemBarsPlugin.PRIVACY_PREFS, MODE_PRIVATE)
                .getBoolean(SystemBarsPlugin.KEY_APP_LOCK, false);
        if (appLockEnabled) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        boolean isNightMode = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int launchColor = ContextCompat.getColor(this, R.color.brickvault_splash_background);
        getWindow().getDecorView().setBackgroundColor(launchColor);
        getWindow().setStatusBarColor(launchColor);
        getWindow().setNavigationBarColor(launchColor);
        WindowInsetsControllerCompat insetsController = new WindowInsetsControllerCompat(
                getWindow(), getWindow().getDecorView());
        insetsController.setAppearanceLightStatusBars(!isNightMode);
        insetsController.setAppearanceLightNavigationBars(!isNightMode);
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
