package app.bricksvault;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import android.app.Activity;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class SystemBarsPluginTest {
    @Test
    public void noActivityMeansNoWindow() {
        assertNull(SystemBarsPlugin.usableWindow(null));
    }

    @Test
    public void liveActivityExposesItsWindow() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        assertNotNull(SystemBarsPlugin.usableWindow(activity));
    }

    @Test
    public void finishingOrDestroyedActivityIsSkipped() {
        ActivityController<Activity> controller = Robolectric.buildActivity(Activity.class).setup();
        controller.get().finish();
        assertNull(SystemBarsPlugin.usableWindow(controller.get()));
        controller.pause().stop().destroy();
        assertNull(SystemBarsPlugin.usableWindow(controller.get()));
    }
}
