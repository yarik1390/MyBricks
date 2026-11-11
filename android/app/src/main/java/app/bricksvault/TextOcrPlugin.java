package app.bricksvault;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * On-device Latin OCR for a captured scan still (data-URL / base64 JPEG).
 * Used by the photo-identify path so a printed set number can resolve from D1
 * before Brickognize or the paid vision cascade. Failures resolve empty —
 * the web layer then omits ocr_candidates and falls through.
 */
@CapacitorPlugin(name = "TextOcr")
public class TextOcrPlugin extends Plugin {
    private static final int MAX_IMAGE_BYTES = 2_000_000;
    private static final long TIMEOUT_SECONDS = 3;
    /** Longest side of the bitmap handed to ML Kit; larger stills are subsampled. */
    static final int MAX_DECODE_SIDE = 2048;

    // One OCR worker with a short queue: rapid retries can't spawn a thread
    // each, and extra requests beyond the queue resolve empty right away.
    private final ThreadPoolExecutor executor = new ThreadPoolExecutor(
            1, 1, 30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(2),
            r -> new Thread(r, "bv-text-ocr"));
    // Created lazily and only touched on the OCR worker thread.
    private TextRecognizer recognizer;

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String image = call.getString("image", "");
        try {
            executor.execute(() -> recognizeBlocking(call, image == null ? "" : image));
        } catch (RejectedExecutionException busy) {
            call.resolve(emptyResult());
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            executor.execute(() -> {
                if (recognizer != null) {
                    recognizer.close();
                    recognizer = null;
                }
            });
        } catch (RejectedExecutionException ignored) {
            // Queue full: the process is going away; ML Kit is released with it.
        }
        executor.shutdown();
        super.handleOnDestroy();
    }

    private static JSObject emptyResult() {
        JSObject ret = new JSObject();
        ret.put("texts", new JSArray());
        ret.put("fullText", "");
        return ret;
    }

    /**
     * Power-of-two sample size so the decoded bitmap's longest side stays at
     * or under maxSide. Returns 0 for invalid or absurd dimensions.
     */
    static int sampleSizeFor(int width, int height, int maxSide) {
        if (width <= 0 || height <= 0) return 0;
        long longSide = Math.max(width, height);
        long shortSide = Math.min(width, height);
        if (longSide / shortSide > 20) return 0; // not a photo of a box
        int sample = 1;
        while (longSide / sample > maxSide) sample *= 2;
        return sample;
    }

    private void recognizeBlocking(PluginCall call, String image) {
        JSObject ret = new JSObject();
        JSArray texts = new JSArray();
        ret.put("texts", texts);
        ret.put("fullText", "");

        if (image.isEmpty() || !image.startsWith("data:image/")) {
            call.resolve(ret);
            return;
        }

        Bitmap bitmap = null;
        try {
            int comma = image.indexOf(',');
            String base64 = comma >= 0 ? image.substring(comma + 1) : image;
            // Bound the encoded payload before decoding so malformed input cannot
            // allocate an arbitrarily large byte array inside the WebView process.
            int maxEncodedChars = ((MAX_IMAGE_BYTES + 2) / 3) * 4 + 8;
            if (base64.length() == 0 || base64.length() > maxEncodedChars) {
                call.resolve(ret);
                return;
            }

            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (bytes.length == 0 || bytes.length > MAX_IMAGE_BYTES) {
                call.resolve(ret);
                return;
            }
            // A small JPEG can still declare huge dimensions; read the bounds
            // first and subsample so decoding can never exhaust the heap.
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int sample = sampleSizeFor(bounds.outWidth, bounds.outHeight, MAX_DECODE_SIDE);
            if (sample == 0) {
                call.resolve(ret);
                return;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            opts.inPreferredConfig = Bitmap.Config.RGB_565;
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
            if (bitmap == null) {
                call.resolve(ret);
                return;
            }

            if (recognizer == null) {
                recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            }
            Text result = Tasks.await(
                    recognizer.process(InputImage.fromBitmap(bitmap, 0)),
                    TIMEOUT_SECONDS,
                    TimeUnit.SECONDS
            );
            String fullText = result.getText() == null ? "" : result.getText().trim();
            for (Text.TextBlock block : result.getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    String lineText = line.getText();
                    if (lineText != null && !lineText.trim().isEmpty()) {
                        texts.put(lineText.trim());
                    }
                }
            }
            ret.put("texts", texts);
            ret.put("fullText", fullText);
            call.resolve(ret);
        } catch (Exception | OutOfMemoryError ignored) {
            call.resolve(ret);
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
        }
    }
}
