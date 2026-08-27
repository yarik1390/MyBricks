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
    static final String KEY_SETS = "sets";
    static final String KEY_UPDATED = "updated_at";
    static final String KEY_OWNER = "owner";

    private void refreshWidgets(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, VaultWidgetProvider.class));
        if (ids.length > 0) {
            new VaultWidgetProvider().onUpdate(ctx, mgr, ids);
        }
    }

    @PluginMethod
    public void updateWidget(PluginCall call) {
        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String owner = call.getString("owner", "");
        String previousOwner = prefs.getString(KEY_OWNER, "");
        SharedPreferences.Editor ed = prefs.edit();
        if (!previousOwner.isEmpty() && !previousOwner.equals(owner)) {
            // Never let account A's portfolio survive an account switch while
            // account B's first widget update is being written.
            ed.clear();
        }
        ed.putString(KEY_VALUE, call.getString("value", "—"));
        ed.putString(KEY_DELTA, call.getString("delta", ""));
        ed.putBoolean(KEY_DELTA_UP, Boolean.TRUE.equals(call.getBoolean("deltaUp", true)));
        ed.putInt(KEY_SETS, call.getInt("sets", 0));
        ed.putString(KEY_OWNER, owner);
        ed.putLong(KEY_UPDATED, System.currentTimeMillis());
        ed.apply();

        refreshWidgets(ctx);
        call.resolve();
    }

    @PluginMethod
    public void clearWidget(PluginCall call) {
        Context ctx = getContext();
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        refreshWidgets(ctx);
        call.resolve();
    }
}
