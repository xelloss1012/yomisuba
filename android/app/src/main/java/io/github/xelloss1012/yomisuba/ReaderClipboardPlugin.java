package io.github.xelloss1012.yomisuba;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReaderClipboard")
public class ReaderClipboardPlugin extends Plugin {
    @PluginMethod
    public void readText(PluginCall call) {
        ClipboardManager clipboard = (ClipboardManager) getContext()
            .getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) {
            call.reject("No se pudo acceder al portapapeles.");
            return;
        }

        ClipData clip = clipboard.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) {
            JSObject result = new JSObject();
            result.put("text", "");
            call.resolve(result);
            return;
        }

        CharSequence text = clip.getItemAt(0).coerceToText(getContext());
        JSObject result = new JSObject();
        result.put("text", text == null ? "" : text.toString());
        call.resolve(result);
    }
}
