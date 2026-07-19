package app.bricksvault;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridge for the home-screen vault widget. The web layer pushes the latest
 * vault totals (already formatted in the user's currency) after each portfolio
 * load; they land in SharedPreferences and every widget instance is refreshed.
 * The widget itself never touches the network — it only mirrors these values.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    static final String PREFS = "bv_widget";
    static final String KEY_VALUE = "value";
    static final String KEY_DELTA = "delta";
    static final String KEY_DELTA_UP = "delta_up";
    static final String KEY_UPDATED = "updated_at";

    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        ed.putString(KEY_VALUE, call.getString("value", "—"));
        ed.putString(KEY_DELTA, call.getString("delta", ""));
        ed.putBoolean(KEY_DELTA_UP, Boolean.TRUE.equals(call.getBoolean("deltaUp", true)));
        ed.putLong(KEY_UPDATED, System.currentTimeMillis());
        ed.apply();

        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, VaultWidgetProvider.class));
        if (ids.length > 0) {
            new VaultWidgetProvider().onUpdate(ctx, mgr, ids);
        }
        call.resolve();
    }
}
