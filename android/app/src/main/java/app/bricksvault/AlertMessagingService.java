package app.bricksvault;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Map;

/**
 * Replaces the push plugin's FCM service (see AndroidManifest.xml). Every
 * message still reaches the plugin first (JS events, token refresh). Alerts the
 * server sends as data-only messages with "actions" are drawn here with their
 * buttons ("Sell options", "Raise target", ...), because a notification drawn
 * by the system from an FCM `notification` block cannot carry any.
 *
 * Taps and buttons reopen MainActivity with the same extras an FCM tap carries
 * ("google.message_id" + "url"), so the push plugin reports them to JS as
 * pushNotificationActionPerformed and lib/native-push.js routes to the URL.
 */
public class AlertMessagingService extends MessagingService {
    static final String CHANNEL_ID = "bv_alerts";
    static final String EXTRA_TAG = "bv_notification_tag";
    static final String EXTRA_ID = "bv_notification_id";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        if (message.getNotification() != null || !data.containsKey("actions")) return;
        String title = data.get("title");
        String body = data.get("body");
        if (title == null || body == null) return;
        showAlert(this, message.getMessageId(), title, body, data.get("url"), data.get("tag"), data.get("actions"));
    }

    static void showAlert(Context context, @Nullable String messageId, String title, String body,
                          @Nullable String url, @Nullable String tag, @Nullable String actionsJson) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return;
        ensureChannel(context);

        // Same tag replaces the previous alert for that set instead of stacking.
        String key = tag != null ? tag : (messageId != null ? messageId : String.valueOf(System.nanoTime()));
        int id = key.hashCode();
        String route = isRoute(url) ? url : "#/";
        String messageKey = messageId != null ? messageId : key;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_bricksvault)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(openIntent(context, messageKey, route, tag, id, 0));

        try {
            JSONArray actions = new JSONArray(actionsJson == null ? "[]" : actionsJson);
            for (int i = 0; i < actions.length() && i < 2; i++) {
                JSONObject action = actions.optJSONObject(i);
                if (action == null) continue;
                String label = action.optString("title", "");
                String actionUrl = action.optString("url", "");
                if (label.isEmpty() || !isRoute(actionUrl)) continue;
                builder.addAction(0, label, openIntent(context, messageKey, actionUrl, tag, id, i + 1));
            }
        } catch (Exception ignored) {
            // Malformed buttons: the alert still shows and opens its main route.
        }

        try {
            manager.notify(tag, id, builder.build());
        } catch (SecurityException ignored) {
            // Notification permission revoked between the check and notify().
        }
    }

    /** Taps and buttons reopen the app on the given in-app route. */
    private static PendingIntent openIntent(Context context, String messageKey, String route,
                                            @Nullable String tag, int id, int slot) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction("app.bricksvault.OPEN_ALERT." + slot)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra("google.message_id", messageKey)
                .putExtra("url", route)
                .putExtra(EXTRA_ID, id);
        if (tag != null) intent.putExtra(EXTRA_TAG, tag);
        int requestCode = 31 * id + slot;
        return PendingIntent.getActivity(context, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Buttons don't auto-cancel their notification, so MainActivity clears it on open. */
    static void dismissFrom(Context context, @Nullable Intent intent) {
        if (intent == null || !intent.hasExtra(EXTRA_ID)) return;
        NotificationManagerCompat.from(context)
                .cancel(intent.getStringExtra(EXTRA_TAG), intent.getIntExtra(EXTRA_ID, 0));
    }

    private static boolean isRoute(@Nullable String url) {
        return url != null && url.startsWith("#/") && url.length() <= 500;
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, context.getString(R.string.alerts_channel_name), NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(context.getString(R.string.alerts_channel_description));
        manager.createNotificationChannel(channel);
    }
}
