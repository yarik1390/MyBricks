package app.bricksvault;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.review.ReviewInfo;
import com.google.android.play.core.review.ReviewManager;
import com.google.android.play.core.review.ReviewManagerFactory;

/**
 * Rating BricksVault from inside the app.
 *
 * requestReview shows the Google Play In-App Review card. Play decides whether
 * the card actually appears (it has a quota and never says), so the web layer
 * only calls it at a happy moment, never from a button.
 *
 * openStoreListing opens the Play Store page (the "Rate BricksVault" row in
 * Profile), which always works.
 */
@CapacitorPlugin(name = "AppReview")
public class AppReviewPlugin extends Plugin {

    @PluginMethod
    public void requestReview(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        ReviewManager manager = ReviewManagerFactory.create(activity);
        manager.requestReviewFlow().addOnCompleteListener(request -> {
            if (!request.isSuccessful()) {
                call.reject("Review flow unavailable");
                return;
            }
            ReviewInfo info = request.getResult();
            manager.launchReviewFlow(activity, info).addOnCompleteListener(done -> {
                JSObject ret = new JSObject();
                ret.put("completed", true);
                call.resolve(ret);
            });
        });
    }

    @PluginMethod
    public void openStoreListing(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        String pkg = activity.getPackageName();
        Intent market = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg));
        market.setPackage("com.android.vending");
        market.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(market);
        } catch (ActivityNotFoundException e) {
            Intent web = new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=" + pkg));
            web.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                activity.startActivity(web);
            } catch (ActivityNotFoundException ignored) {
                call.reject("No store or browser");
                return;
            }
        }
        call.resolve();
    }
}
