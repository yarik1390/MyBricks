package app.bricksvault;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.robolectric.Shadows.shadowOf;

import android.Manifest;
import android.app.Application;
import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowNotificationManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class AlertMessagingServiceTest {
    private static final String BUTTONS = "["
            + "{\"action\":\"sell\",\"title\":\"Sell options\",\"url\":\"#/set/75192-1/sell\"},"
            + "{\"action\":\"target\",\"title\":\"Set sell target\",\"url\":\"#/set/75192-1/target\"},"
            + "{\"action\":\"extra\",\"title\":\"Third\",\"url\":\"#/x\"}]";

    private Context context;
    private NotificationManager manager;
    private ShadowNotificationManager shadow;

    @Before
    public void setUp() {
        context = ApplicationProvider.getApplicationContext();
        shadowOf((Application) context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS);
        manager = context.getSystemService(NotificationManager.class);
        shadow = shadowOf(manager);
    }

    private Notification only(String tag) {
        assertEquals(1, shadow.size());
        return shadow.getNotification(tag, tag.hashCode());
    }

    @Test
    public void drawsTheAlertWithItsFirstTwoButtons() {
        AlertMessagingService.showAlert(context, "m1", "Falcon is up 12%", "Now $950",
                "#/set/75192-1", "spike-75192-1", BUTTONS);

        Notification n = only("spike-75192-1");
        assertNotNull(manager.getNotificationChannel(AlertMessagingService.CHANNEL_ID));
        assertEquals(AlertMessagingService.CHANNEL_ID, n.getChannelId());
        assertEquals("Falcon is up 12%", n.extras.getString(Notification.EXTRA_TITLE));
        assertEquals(2, n.actions.length);
        assertEquals("Sell options", n.actions[0].title.toString());
        assertEquals("Set sell target", n.actions[1].title.toString());

        // Each button reopens the app with the extras an FCM tap carries.
        Intent sell = shadowOf(n.actions[0].actionIntent).getSavedIntent();
        assertEquals(MainActivity.class.getName(), sell.getComponent().getClassName());
        assertEquals("m1", sell.getStringExtra("google.message_id"));
        assertEquals("#/set/75192-1/sell", sell.getStringExtra("url"));
        assertEquals("#/set/75192-1/target",
                shadowOf(n.actions[1].actionIntent).getSavedIntent().getStringExtra("url"));
        assertEquals("#/set/75192-1", shadowOf(n.contentIntent).getSavedIntent().getStringExtra("url"));
    }

    @Test
    public void aNewAlertForTheSameSetReplacesTheOldOne() {
        AlertMessagingService.showAlert(context, "m1", "Up 12%", "Now $950", "#/set/1", "spike-1", BUTTONS);
        AlertMessagingService.showAlert(context, "m2", "Up 15%", "Now $980", "#/set/1", "spike-1", BUTTONS);
        assertEquals("Up 15%", only("spike-1").extras.getString(Notification.EXTRA_TITLE));
    }

    @Test
    public void onlyInAppRoutesBecomeButtons() {
        AlertMessagingService.showAlert(context, "m1", "Title", "Body", "https://evil.example/", "t1",
                "[{\"action\":\"a\",\"title\":\"Web\",\"url\":\"https://evil.example/\"},"
                        + "{\"action\":\"b\",\"title\":\"Offers\",\"url\":\"#/set/1\"}]");
        Notification n = only("t1");
        assertEquals(1, n.actions.length);
        assertEquals("Offers", n.actions[0].title.toString());
        // A non-route main URL falls back to the app's home.
        assertEquals("#/", shadowOf(n.contentIntent).getSavedIntent().getStringExtra("url"));
    }

    @Test
    public void malformedButtonsStillShowTheAlert() {
        AlertMessagingService.showAlert(context, "m1", "Title", "Body", "#/", "t2", "not json");
        Notification n = only("t2");
        assertNull(n.actions);
    }

    @Test
    public void openingTheAppFromAButtonClearsItsNotification() {
        AlertMessagingService.showAlert(context, "m1", "Title", "Body", "#/set/1", "t3", BUTTONS);
        Notification n = only("t3");
        Intent fromButton = shadowOf(n.actions[0].actionIntent).getSavedIntent();
        AlertMessagingService.dismissFrom(context, fromButton);
        assertEquals(0, shadow.size());
    }

    @Test
    public void staysQuietWhenNotificationsAreOff() {
        shadow.setNotificationsEnabled(false);
        AlertMessagingService.showAlert(context, "m1", "Title", "Body", "#/", "t4", BUTTONS);
        assertEquals(0, shadow.size());
    }
}
