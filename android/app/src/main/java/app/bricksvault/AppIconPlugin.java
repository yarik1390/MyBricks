package app.bricksvault;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Switches the launcher icon between the classic brick and the gold brick
 * (a Pro perk). Each icon is an activity-alias of MainActivity in the
 * manifest; exactly one alias is enabled at a time, so the launcher shows a
 * single BricksVault entry. Pro is checked by the web layer before calling.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {

    private static final String DEFAULT_ALIAS = "app.bricksvault.DefaultIcon";
    private static final String GOLD_ALIAS = "app.bricksvault.GoldIcon";

    private boolean isEnabled(Context ctx, String alias) {
        int state = ctx.getPackageManager().getComponentEnabledSetting(new ComponentName(ctx, alias));
        if (state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT) {
            return DEFAULT_ALIAS.equals(alias);
        }
        return state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    private void setEnabled(Context ctx, String alias, boolean on) {
        ctx.getPackageManager().setComponentEnabledSetting(
                new ComponentName(ctx, alias),
                on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP);
    }

    @PluginMethod
    public void get(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("icon", isEnabled(getContext(), GOLD_ALIAS) ? "gold" : "default");
        call.resolve(ret);
    }

    @PluginMethod
    public void set(PluginCall call) {
        boolean gold = "gold".equals(call.getString("icon", "default"));
        Context ctx = getContext();
        try {
            // Enable the new entry before disabling the old one, so there is never
            // a moment with no launcher entry at all.
            setEnabled(ctx, gold ? GOLD_ALIAS : DEFAULT_ALIAS, true);
            setEnabled(ctx, gold ? DEFAULT_ALIAS : GOLD_ALIAS, false);
            JSObject ret = new JSObject();
            ret.put("icon", gold ? "gold" : "default");
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not change the app icon", e);
        }
    }
}
