package io.github.xelloss1012.yomisuba;

import android.content.pm.ActivityInfo;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReaderOrientation")
public class ReaderOrientationPlugin extends Plugin {
    @PluginMethod
    public void setAutoRotate(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("Falta indicar si se permite el giro automático.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            getActivity().setRequestedOrientation(
                enabled
                    ? ActivityInfo.SCREEN_ORIENTATION_SENSOR
                    : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            );
            call.resolve();
        });
    }
}
