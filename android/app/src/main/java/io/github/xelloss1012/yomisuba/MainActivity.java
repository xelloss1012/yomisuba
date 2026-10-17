package io.github.xelloss1012.yomisuba;

import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import android.os.Build;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.MotionEvent;
import android.webkit.WebView;
import android.view.textclassifier.SelectionEvent;
import android.view.textclassifier.TextClassifier;
import com.getcapacitor.BridgeActivity;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    private long lastMoveTraceAt;
    private long lastWebViewMoveTraceAt;
    private WebView touchTracedWebView;
    private TextClassifier originalTextClassifier;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(JapaneseTtsPlugin.class);
        registerPlugin(ReaderFullscreenPlugin.class);
        registerPlugin(ReaderOrientationPlugin.class);
        registerPlugin(GoogleDriveTokenPlugin.class);
        super.onCreate(savedInstanceState);
    }

    private String getMotionActionName(int action) {
        switch (action) {
            case MotionEvent.ACTION_DOWN:
                return "DOWN";
            case MotionEvent.ACTION_MOVE:
                return "MOVE";
            case MotionEvent.ACTION_UP:
                return "UP";
            case MotionEvent.ACTION_CANCEL:
                return "CANCEL";
            case MotionEvent.ACTION_POINTER_DOWN:
                return "POINTER_DOWN";
            case MotionEvent.ACTION_POINTER_UP:
                return "POINTER_UP";
            case MotionEvent.ACTION_OUTSIDE:
                return "OUTSIDE";
            case MotionEvent.ACTION_HOVER_MOVE:
                return "HOVER_MOVE";
            case MotionEvent.ACTION_HOVER_ENTER:
                return "HOVER_ENTER";
            case MotionEvent.ACTION_HOVER_EXIT:
                return "HOVER_EXIT";
            case MotionEvent.ACTION_SCROLL:
                return "SCROLL";
            case MotionEvent.ACTION_BUTTON_PRESS:
                return "BUTTON_PRESS";
            case MotionEvent.ACTION_BUTTON_RELEASE:
                return "BUTTON_RELEASE";
            default:
                return "OTHER_" + action;
        }
    }

    private String getMotionEventDetails(MotionEvent event) {
        int pointerIndex = Math.min(event.getActionIndex(), event.getPointerCount() - 1);
        int toolType = event.getPointerCount() > 0
            ? event.getToolType(pointerIndex)
            : MotionEvent.TOOL_TYPE_UNKNOWN;
        return ",actionIndex:" + event.getActionIndex()
            + ",tool:" + toolType
            + ",source:" + event.getSource()
            + ",buttons:" + event.getButtonState()
            + ",device:" + event.getDeviceId()
            + ",eventTime:" + event.getEventTime();
    }

    private String getSelectionEventTypeName(int eventType) {
        switch (eventType) {
            case SelectionEvent.EVENT_SELECTION_STARTED:
                return "SELECTION_STARTED";
            case SelectionEvent.EVENT_SELECTION_MODIFIED:
                return "SELECTION_MODIFIED";
            case SelectionEvent.EVENT_SMART_SELECTION_SINGLE:
                return "SMART_SELECTION_SINGLE";
            case SelectionEvent.EVENT_SMART_SELECTION_MULTI:
                return "SMART_SELECTION_MULTI";
            case SelectionEvent.EVENT_AUTO_SELECTION:
                return "AUTO_SELECTION";
            default:
                return "EVENT_" + eventType;
        }
    }

    private String getSelectionActionName(int action) {
        switch (action) {
            case SelectionEvent.ACTION_OVERTYPE:
                return "OVERTYPE";
            case SelectionEvent.ACTION_COPY:
                return "COPY";
            case SelectionEvent.ACTION_PASTE:
                return "PASTE";
            case SelectionEvent.ACTION_CUT:
                return "CUT";
            case SelectionEvent.ACTION_SHARE:
                return "SHARE";
            case SelectionEvent.ACTION_SMART_SHARE:
                return "SMART_SHARE";
            case SelectionEvent.ACTION_DRAG:
                return "DRAG";
            case SelectionEvent.ACTION_ABANDON:
                return "ABANDON";
            case SelectionEvent.ACTION_OTHER:
                return "OTHER";
            case SelectionEvent.ACTION_SELECT_ALL:
                return "SELECT_ALL";
            case SelectionEvent.ACTION_RESET:
                return "RESET";
            default:
                return "ACTION_" + action;
        }
    }

    private void installTextClassifierTrace(WebView webView) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || webView == null) return;
        TextClassifier current = webView.getTextClassifier();
        if (current == null || Proxy.isProxyClass(current.getClass())) return;
        originalTextClassifier = current;
        TextClassifier tracedClassifier = (TextClassifier) Proxy.newProxyInstance(
            TextClassifier.class.getClassLoader(),
            new Class<?>[] { TextClassifier.class },
            (proxy, method, args) -> {
                if ("onSelectionEvent".equals(method.getName())
                    && args != null
                    && args.length == 1
                    && args[0] instanceof SelectionEvent) {
                    SelectionEvent selectionEvent = (SelectionEvent) args[0];
                    String trace = "window.dispatchEvent(new CustomEvent('yomisuba-native-selection-event',{detail:{"
                        + "eventType:" + selectionEvent.getEventType()
                        + ",eventName:'" + (selectionEvent.getEventType() >= 100
                            ? getSelectionActionName(selectionEvent.getEventType())
                            : getSelectionEventTypeName(selectionEvent.getEventType()))
                        + "',actionName:'" + (selectionEvent.getEventType() >= 100
                            ? getSelectionActionName(selectionEvent.getEventType())
                            : "NONE")
                        + "',invocation:" + selectionEvent.getInvocationMethod()
                        + ",start:" + selectionEvent.getStart()
                        + ",end:" + selectionEvent.getEnd()
                        + ",eventIndex:" + selectionEvent.getEventIndex()
                        + ",eventTime:" + selectionEvent.getEventTime()
                        + "}}));";
                    webView.post(() -> webView.evaluateJavascript(trace, null));
                }
                try {
                    return method.invoke(originalTextClassifier, args);
                } catch (InvocationTargetException exception) {
                    throw exception.getCause();
                }
            }
        );
        webView.setTextClassifier(tracedClassifier);
    }

    private void installWebViewTouchTrace(WebView webView) {
        if (webView == null || touchTracedWebView == webView) return;
        touchTracedWebView = webView;
        installTextClassifierTrace(webView);
        webView.setOnTouchListener((view, event) -> {
            int action = event.getActionMasked();
            long eventTime = event.getEventTime();
            if (action == MotionEvent.ACTION_MOVE && eventTime - lastWebViewMoveTraceAt < 100) {
                return false;
            }
            if (action == MotionEvent.ACTION_MOVE) {
                lastWebViewMoveTraceAt = eventTime;
            }

            float rawX = event.getRawX();
            float rawY = event.getRawY();
            int[] webViewLocation = new int[2];
            webView.getLocationOnScreen(webViewLocation);
            float density = getResources().getDisplayMetrics().density;
            float cssX = (rawX - webViewLocation[0]) / density;
            float cssY = (rawY - webViewLocation[1]) / density;
            String trace = "window.dispatchEvent(new CustomEvent('yomisuba-native-webview-touch',{detail:{action:'"
                + getMotionActionName(action)
                + "',x:" + cssX
                + ",y:" + cssY
                + ",pointers:" + event.getPointerCount()
                + getMotionEventDetails(event)
                + "}}));";
            webView.post(() -> webView.evaluateJavascript(trace, null));
            return false;
        });
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        int action = event.getActionMasked();
        long eventTime = event.getEventTime();
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        installWebViewTouchTrace(webView);
        if (action != MotionEvent.ACTION_MOVE || eventTime - lastMoveTraceAt >= 100) {
            if (action == MotionEvent.ACTION_MOVE) {
                lastMoveTraceAt = eventTime;
            }
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
                final String trace = "window.dispatchEvent(new CustomEvent('yomisuba-native-touch',{detail:{action:'"
                    + getMotionActionName(action)
                    + "',x:" + cssX
                    + ",y:" + cssY
                    + ",pointers:" + event.getPointerCount()
                    + ",inside:" + insideWebView
                    + ",rawX:" + rawX
                    + ",rawY:" + rawY
                    + getMotionEventDetails(event)
                    + "}}));";
                webView.post(() -> webView.evaluateJavascript(trace, null));
            }
        }
        return super.dispatchTouchEvent(event);
    }
}
