package app.bricksvault;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TextOcrPluginTest {
    @Test
    public void smallImagesAreDecodedAtFullSize() {
        assertEquals(1, TextOcrPlugin.sampleSizeFor(1600, 1200, 2048));
        assertEquals(1, TextOcrPlugin.sampleSizeFor(2048, 1536, 2048));
    }

    @Test
    public void largeImagesAreSubsampledUnderTheCap() {
        assertEquals(2, TextOcrPlugin.sampleSizeFor(4000, 3000, 2048));
        assertEquals(4, TextOcrPlugin.sampleSizeFor(8000, 6000, 2048));
        assertEquals(32, TextOcrPlugin.sampleSizeFor(60000, 40000, 2048));
    }

    @Test
    public void invalidOrAbsurdDimensionsAreRejected() {
        assertEquals(0, TextOcrPlugin.sampleSizeFor(0, 100, 2048));
        assertEquals(0, TextOcrPlugin.sampleSizeFor(-1, -1, 2048));
        assertEquals(0, TextOcrPlugin.sampleSizeFor(100000, 10, 2048));
    }
}
