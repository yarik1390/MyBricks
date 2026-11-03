package app.bricksvault;

import android.content.Context;
import android.telephony.TelephonyManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * The phone's country for first-launch defaults (shop and currency), with no
 * location permission: the SIM's country and the mobile network's country
 * from TelephonyManager (neither needs a permission), plus the phone's region
 * setting. Empty strings when a value is unknown (no SIM, Wi-Fi-only tablet).
 */
@CapacitorPlugin(name = "PhoneRegion")
public class RegionPlugin extends Plugin {

    @PluginMethod
    public void getCountry(PluginCall call) {
        String sim = "";
        String network = "";
        try {
            TelephonyManager tm = (TelephonyManager) getContext().getSystemService(Context.TELEPHONY_SERVICE);
            if (tm != null) {
                sim = clean(tm.getSimCountryIso());
                network = clean(tm.getNetworkCountryIso());
            }
        } catch (Exception ignored) {
            // Some devices throw without telephony; fall back to empty.
        }
        JSObject ret = new JSObject();
        ret.put("sim", sim);
        ret.put("network", network);
        ret.put("locale", clean(Locale.getDefault().getCountry()));
        call.resolve(ret);
    }

    private static String clean(String code) {
        if (code == null) return "";
        String c = code.trim().toUpperCase(Locale.ROOT);
        return c.length() == 2 ? c : "";
    }
}
