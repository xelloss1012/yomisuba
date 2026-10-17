package io.github.xelloss1012.yomisuba;

import android.os.Build;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReaderFullscreen")
public class ReaderFullscreenPlugin extends Plugin {
    private int originalSystemUiVisibility;
    private boolean originalVisibilityCaptured;

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = call.getBoolean("enabled", false);
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            View decorView = window.getDecorView();
            if (enabled) {
                if (!originalVisibilityCaptured) {
                    originalSystemUiVisibility = decorView.getSystemUiVisibility();
                    originalVisibilityCaptured = true;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController controller = window.getInsetsController();
                    if (controller == null) {
                        call.reject("Android no permite controlar las barras del sistema.");
                        return;
                    }
                    controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    );
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                } else {
                    decorView.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    );
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                }
            } else if (originalVisibilityCaptured) {
                decorView.setSystemUiVisibility(originalSystemUiVisibility);
            }

            if (!enabled) originalVisibilityCaptured = false;
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        if (originalVisibilityCaptured && getActivity() != null) {
            getActivity().runOnUiThread(() -> {
                WindowInsetsController controller = getActivity().getWindow().getInsetsController();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && controller != null) {
                    controller.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
                    getActivity().getWindow().getDecorView()
                        .setSystemUiVisibility(originalSystemUiVisibility);
                }
            });
        }
        super.handleOnDestroy();
    }
}
