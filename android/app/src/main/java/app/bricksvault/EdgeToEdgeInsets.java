package app.bricksvault;

import android.app.Activity;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;

/**
 * Inset fallback for edge-to-edge on Android 14 and older.
 *
 * MainActivity turns edge-to-edge on for every Android version (Play's
 * "edge-to-edge may not display for all users" advice). Capacitor's SystemBars
 * plugin keeps content out from under the bars on Android 15+, and on any
 * version when the WebView is new enough (140+) to apply env(safe-area-inset-*)
 * itself, which the web CSS uses. That leaves one gap: Android 14 and older
 * with an old WebView (e.g. Android 8/9, whose WebView stopped updating),
 * where Capacitor neither pads the WebView nor reports non-zero safe areas.
 * There we pad the content view by the bar (and keyboard) insets, exactly as
 * the pre-edge-to-edge window did, and hand the WebView zeroed bar insets.
 */
final class EdgeToEdgeInsets {
    /** Same threshold as Capacitor's SystemBars (WEBVIEW_VERSION_WITH_SAFE_AREA_FIX). */
    static final int WEBVIEW_SAFE_AREA_MAJOR = 140;

    private EdgeToEdgeInsets() {}

    static void install(Activity activity) {
        if (!needsPadding(Build.VERSION.SDK_INT, webViewMajorVersion(activity))) return;
        View content = activity.findViewById(android.R.id.content);
        if (content == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
            int types = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(types);
            boolean keyboard = insets.isVisible(WindowInsetsCompat.Type.ime());
            int bottom = keyboard
                    ? Math.max(bars.bottom, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
                    : bars.bottom;
            v.setPadding(bars.left, bars.top, bars.right, bottom);
            return new WindowInsetsCompat.Builder(insets)
                    .setInsets(types, Insets.NONE)
                    .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                    .build();
        });
        ViewCompat.requestApplyInsets(content);
    }

    /** Pure decision, unit-tested: pad only where Capacitor won't handle insets. */
    static boolean needsPadding(int sdkInt, int webViewMajor) {
        return sdkInt < Build.VERSION_CODES.VANILLA_ICE_CREAM && webViewMajor < WEBVIEW_SAFE_AREA_MAJOR;
    }

    static int webViewMajorVersion(Activity activity) {
        try {
            PackageInfo info = WebViewCompat.getCurrentWebViewPackage(activity);
            if (info != null && info.versionName != null) {
                return Integer.parseInt(info.versionName.split("\\.")[0]);
            }
        } catch (RuntimeException ignored) {
            // Unknown WebView: fall through to the safe (padded) layout.
        }
        return 0;
    }
}
