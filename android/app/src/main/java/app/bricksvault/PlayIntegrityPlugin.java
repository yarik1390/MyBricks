package app.bricksvault;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.integrity.IntegrityManager;
import com.google.android.play.core.integrity.IntegrityManagerFactory;
import com.google.android.play.core.integrity.IntegrityTokenRequest;

/**
 * Google Play Integrity token for a server-issued nonce (classic request).
 * The Worker decodes the token with Google and, for the genuine Play build on
 * a real device, returns a short-lived attestation used on scans
 * (worker/src/lib/play-integrity.ts). Failures reject; the web layer simply
 * carries on without an attestation.
 */
@CapacitorPlugin(name = "PlayIntegrity")
public class PlayIntegrityPlugin extends Plugin {

    @PluginMethod
    public void requestToken(PluginCall call) {
        String nonce = call.getString("nonce", "");
        if (nonce == null || nonce.length() < 16 || nonce.length() > 500) {
            call.reject("Invalid nonce");
            return;
        }
        IntegrityManager manager = IntegrityManagerFactory.create(getContext().getApplicationContext());
        manager.requestIntegrityToken(IntegrityTokenRequest.builder().setNonce(nonce).build())
                .addOnSuccessListener(response -> {
                    JSObject ret = new JSObject();
                    ret.put("token", response.token());
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> call.reject("Integrity token unavailable: " + e.getClass().getSimpleName()));
    }
}
