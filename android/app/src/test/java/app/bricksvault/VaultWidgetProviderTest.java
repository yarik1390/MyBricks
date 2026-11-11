package app.bricksvault;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class VaultWidgetProviderTest {
    private String meta(int sets) {
        Context context = ApplicationProvider.getApplicationContext();
        return context.getResources().getQuantityString(R.plurals.widget_sets_updated, sets, sets, "14:57");
    }

    @Test
    public void englishSingularAndPlural() {
        assertEquals("1 set · updated 14:57", meta(1));
        assertEquals("12 sets · updated 14:57", meta(12));
    }

    @Test
    @Config(qualifiers = "uk")
    public void ukrainianPluralForms() {
        assertEquals("1 набір · оновлено 14:57", meta(1));
        assertEquals("3 набори · оновлено 14:57", meta(3));
        assertEquals("5 наборів · оновлено 14:57", meta(5));
    }
}
