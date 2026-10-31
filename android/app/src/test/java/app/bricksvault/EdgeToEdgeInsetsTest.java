package app.bricksvault;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Who pads for the system bars once the app is edge-to-edge everywhere. */
public class EdgeToEdgeInsetsTest {
    @Test
    public void android15AndUpIsLeftToCapacitor() {
        assertFalse(EdgeToEdgeInsets.needsPadding(35, 0));
        assertFalse(EdgeToEdgeInsets.needsPadding(36, 120));
    }

    @Test
    public void olderAndroidWithModernWebViewUsesCssSafeAreas() {
        assertFalse(EdgeToEdgeInsets.needsPadding(28, 140));
        assertFalse(EdgeToEdgeInsets.needsPadding(34, 146));
    }

    @Test
    public void olderAndroidWithOldOrUnknownWebViewIsPadded() {
        assertTrue(EdgeToEdgeInsets.needsPadding(24, 0));
        assertTrue(EdgeToEdgeInsets.needsPadding(28, 138));
        assertTrue(EdgeToEdgeInsets.needsPadding(34, 139));
    }
}
