package app.bricksvault;

import android.graphics.Color;
import android.view.Window;

import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the native status/navigation bars in sync with the WebView theme.
 * MainActivity boots them light (matching the default light shell); the web
 * layer calls setStyle on every theme/skin change (see public/js/theme.js).
 */
@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {

    @PluginMethod
    public void setStyle(PluginCall call) {
        String colorHex = call.getString("color", "#F5F1E8");
        // lightIcons=true → white icons for dark backgrounds.
        boolean lightIcons = Boolean.TRUE.equals(call.getBoolean("lightIcons", false));

        int color;
        try {
            color = Color.parseColor(colorHex);
        } catch (IllegalArgumentException e) {
            call.reject("Invalid color: " + colorHex);
            return;
        }

        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            // Capacitor lays the WebView out with margins for the system bars;
            // the strip behind them is the WINDOW background (OS DayNight
            // colors, not app theme). Paint it to match the app.
            window.getDecorView().setBackgroundColor(color);
            // No-ops on API 35+ (edge-to-edge enforced) but still honored on
            // older devices where the bars have their own background.
            window.setStatusBarColor(color);
            window.setNavigationBarColor(color);
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                // Edge-to-edge: without this the system paints a light
                // contrast scrim over the gesture bar, which glares in dark
                // mode. The app's own background is what should show through.
                window.setStatusBarContrastEnforced(false);
                window.setNavigationBarContrastEnforced(false);
            }
            WindowInsetsControllerCompat controller =
                    new WindowInsetsControllerCompat(window, window.getDecorView());
            controller.setAppearanceLightStatusBars(!lightIcons);
            controller.setAppearanceLightNavigationBars(!lightIcons);
            call.resolve();
        });
    }
}
