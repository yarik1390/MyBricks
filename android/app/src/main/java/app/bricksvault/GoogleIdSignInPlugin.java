package app.bricksvault;

import android.app.Activity;
import android.os.CancellationSignal;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

/**
 * Native "Sign in with Google" for the Android app.
 *
 * Shows Google's own account sheet ("Sign in to BricksVault") through
 * Credential Manager instead of opening accounts.google.com in a browser tab.
 * It returns only a Google ID token; the web layer trades it for a Supabase
 * session (grant_type=id_token), so no token or secret is kept here.
 *
 * serverClientId is the Web OAuth client that Supabase's Google provider uses.
 * nonce is the SHA-256 (hex) of a random value the web layer keeps and sends
 * to Supabase, which binds the token to this sign-in.
 *
 * Errors are rejected with a code: "canceled" when the user closed the sheet
 * (the web layer stays quiet), anything else lets it fall back to the browser
 * flow.
 */
@CapacitorPlugin(name = "GoogleIdSignIn")
public class GoogleIdSignInPlugin extends Plugin {

    @PluginMethod
    public void signIn(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity", "unavailable");
            return;
        }
        String serverClientId = call.getString("serverClientId", "");
        String nonce = call.getString("nonce", "");
        if (serverClientId == null || serverClientId.isEmpty()) {
            call.reject("Missing serverClientId", "config");
            return;
        }

        GetSignInWithGoogleOption.Builder option = new GetSignInWithGoogleOption.Builder(serverClientId);
        if (nonce != null && !nonce.isEmpty()) option.setNonce(nonce);
        GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(option.build())
                .build();

        CredentialManager manager = CredentialManager.create(activity);
        manager.getCredentialAsync(
                activity,
                request,
                new CancellationSignal(),
                ContextCompat.getMainExecutor(activity),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse response) {
                        Credential credential = response.getCredential();
                        if (credential instanceof CustomCredential
                                && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                            try {
                                GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                                JSObject ret = new JSObject();
                                ret.put("idToken", google.getIdToken());
                                call.resolve(ret);
                            } catch (Exception e) {
                                call.reject("Unreadable Google credential", "failed");
                            }
                            return;
                        }
                        call.reject("Unexpected credential type", "failed");
                    }

                    @Override
                    public void onError(@NonNull GetCredentialException e) {
                        if (e instanceof GetCredentialCancellationException) {
                            call.reject("Sign-in canceled", "canceled");
                            return;
                        }
                        String type = e.getType();
                        call.reject(e.getMessage() != null ? e.getMessage() : type, "failed");
                    }
                });
    }
}
