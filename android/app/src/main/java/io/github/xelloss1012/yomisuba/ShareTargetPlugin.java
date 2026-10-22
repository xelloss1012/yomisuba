package io.github.xelloss1012.yomisuba;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/** Hands the web layer what another app shared with Yomisuba: text, an address, or a file. */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {
    private static final int MAX_FILE_BYTES = 40 * 1024 * 1024;
    private static ShareTargetPlugin instance;
    private static JSObject pending;

    @Override
    public void load() {
        instance = this;
    }

    /** Reads what the intent carries and tells the web layer there is something to pick up. */
    static void deliver(Activity activity, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        JSObject payload = new JSObject();
        try {
            if (Intent.ACTION_SEND.equals(action)) {
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (stream != null) {
                    readFile(activity, stream, intent.getType(), payload);
                } else if (text != null) {
                    payload.put("text", text.toString());
                    CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
                    if (subject != null) payload.put("title", subject.toString());
                }
            } else if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) {
                readFile(activity, intent.getData(), intent.getType(), payload);
            } else if (Intent.ACTION_PROCESS_TEXT.equals(action)) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
                if (text != null) payload.put("text", text.toString());
            }
        } catch (Exception exception) {
            payload.put("error", String.valueOf(exception.getMessage()));
        }
        if (payload.length() == 0) return;
        // The same intent must not be delivered again when the activity is recreated.
        intent.setAction(Intent.ACTION_MAIN);
        pending = payload;
        if (instance != null) instance.notifyListeners("shared", new JSObject(), true);
    }

    private static void readFile(Activity activity, Uri uri, String type, JSObject payload) throws Exception {
        String name = null;
        try (Cursor cursor = activity.getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) name = cursor.getString(column);
            }
        } catch (Exception ignored) {
            // The name only helps to tell the kind of file; the type may do it.
        }
        if (name == null) name = uri.getLastPathSegment();
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (InputStream input = activity.getContentResolver().openInputStream(uri)) {
            if (input == null) throw new Exception("empty");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) {
                bytes.write(buffer, 0, read);
                if (bytes.size() > MAX_FILE_BYTES) throw new Exception("size");
            }
        }
        payload.put("fileName", name == null ? "" : name);
        payload.put("mimeType", type == null ? "" : type);
        payload.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
    }

    /** What was shared, once: {text?, title?, fileName?, mimeType?, data? (base64), error?}. */
    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject result = pending == null ? new JSObject() : pending;
        pending = null;
        call.resolve(result);
    }
}
