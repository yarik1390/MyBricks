package app.bricksvault;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowManager;

import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
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
        registerPlugin(TextOcrPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(AppIconPlugin.class);
        registerPlugin(AppReviewPlugin.class);
        registerPlugin(GoogleIdSignInPlugin.class);
        registerPlugin(RegionPlugin.class);
        boolean appLockEnabled = getSharedPreferences(
                SystemBarsPlugin.PRIVACY_PREFS, MODE_PRIVATE)
                .getBoolean(SystemBarsPlugin.KEY_APP_LOCK, false);
        if (appLockEnabled) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
        boolean isNightMode = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int launchColor = ContextCompat.getColor(this, R.color.brickvault_splash_background);
        // Edge-to-edge on every Android version (Android 15+ enforces it for
        // targetSdk 35+). The bars are transparent and the window background
        // shows through them, so paint that instead of the deprecated
        // status/navigation bar colors. Insets: Capacitor's SystemBars on
        // Android 15+, EdgeToEdgeInsets on older versions.
        EdgeToEdge.enable(this,
                SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
                SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT));
        getWindow().getDecorView().setBackgroundColor(launchColor);
        WindowInsetsControllerCompat insetsController = new WindowInsetsControllerCompat(
                getWindow(), getWindow().getDecorView());
        insetsController.setAppearanceLightStatusBars(!isNightMode);
        insetsController.setAppearanceLightNavigationBars(!isNightMode);
        super.onCreate(savedInstanceState);
        EdgeToEdgeInsets.install(this);

        // Keep the branded launch screen until the bundled WebView is ready,
        // while retaining a hard timeout so a failed load can never trap users.
        splashScreen.setKeepOnScreenCondition(() -> {
            long elapsed = SystemClock.uptimeMillis() - splashStartedAt;
            boolean webViewLoading = getBridge() == null
                || getBridge().getWebView() == null
                || getBridge().getWebView().getProgress() < 100;
            return elapsed < 900 || (elapsed < 5000 && webViewLoading);
        });

        // Hand over to the app with a short fade instead of a hard cut. The
        // system's animator scale applies, so "Remove animations" makes this
        // instant; remove() always runs, so the splash can never linger.
        splashScreen.setOnExitAnimationListener(provider ->
            provider.getView().animate()
                .alpha(0f)
                .setDuration(220)
                .withEndAction(provider::remove)
                .start());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Alert buttons don't auto-cancel their notification (only a tap on the
        // body does), so clear it once the app has opened on the button's route.
        AlertMessagingService.dismissFrom(this, intent);
    }
}
