package com.ereader.japanesevertical;

import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import android.util.DisplayMetrics;
import android.view.MotionEvent;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    private long lastMoveTraceAt;

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        long eventTime = event.getEventTime();
        if (action != MotionEvent.ACTION_MOVE || eventTime - lastMoveTraceAt >= 100) {
            if (action == MotionEvent.ACTION_MOVE) {
                lastMoveTraceAt = eventTime;
            }
            String actionName;
            switch (action) {
                case MotionEvent.ACTION_DOWN:
                    actionName = "DOWN";
                    break;
                case MotionEvent.ACTION_MOVE:
                    actionName = "MOVE";
                    break;
                case MotionEvent.ACTION_UP:
                    actionName = "UP";
                    break;
                case MotionEvent.ACTION_CANCEL:
                    actionName = "CANCEL";
                    break;
                case MotionEvent.ACTION_POINTER_DOWN:
                    actionName = "POINTER_DOWN";
                    break;
                case MotionEvent.ACTION_POINTER_UP:
                    actionName = "POINTER_UP";
                    break;
                default:
                    actionName = "OTHER_" + action;
                    break;
            }
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView != null) {
                float rawX = event.getRawX();
                float rawY = event.getRawY();
                int[] webViewLocation = new int[2];
                webView.getLocationOnScreen(webViewLocation);
                DisplayMetrics metrics = getResources().getDisplayMetrics();
                float density = metrics.density;
                float cssX = (rawX - webViewLocation[0]) / density;
                float cssY = (rawY - webViewLocation[1]) / density;
                boolean insideWebView = rawX >= webViewLocation[0]
                    && rawX < webViewLocation[0] + webView.getWidth()
                    && rawY >= webViewLocation[1]
                    && rawY < webViewLocation[1] + webView.getHeight();
                final String trace = "window.dispatchEvent(new CustomEvent('ereader-native-touch',{detail:{action:'"
                    + actionName
                    + "',x:" + cssX
                    + ",y:" + cssY
                    + ",pointers:" + event.getPointerCount()
                    + ",inside:" + insideWebView
                    + ",rawX:" + rawX
                    + ",rawY:" + rawY
                    + "}}));";
                webView.post(() -> webView.evaluateJavascript(trace, null));
            }
        }
        return super.dispatchTouchEvent(event);
    }
}
