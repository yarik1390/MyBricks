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

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        String image = call.getString("image", "");
        new Thread(() -> recognizeBlocking(call, image == null ? "" : image), "bv-text-ocr").start();
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
        TextRecognizer recognizer = null;
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
            bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) {
                call.resolve(ret);
                return;
            }

            recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
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
        } catch (Exception ignored) {
            call.resolve(ret);
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            if (recognizer != null) recognizer.close();
        }
    }
}
