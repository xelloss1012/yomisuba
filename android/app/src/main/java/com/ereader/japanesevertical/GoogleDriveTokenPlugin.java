package com.ereader.japanesevertical;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * Renews the Drive access token without any UI.
 *
 * The social login plugin refreshes a session by first asking Credential
 * Manager for a new ID token, which shows the "Signing in as…" sheet every time
 * the hourly ID token has expired (in practice, on most returns to the app).
 * Drive only needs the access token, and the Authorization API hands out a new
 * one silently once the user has granted the scopes. When it would need the
 * user (consent missing, several accounts), this rejects instead of showing
 * anything, and the app falls back to the regular sign-in.
 */
@CapacitorPlugin(name = "GoogleDriveToken")
public class GoogleDriveTokenPlugin extends Plugin {
    @PluginMethod
    public void authorize(PluginCall call) {
        JSArray requested = call.getArray("scopes");
        List<Scope> scopes = new ArrayList<>();
        try {
            if (requested != null) {
                for (Object scope : requested.toList()) scopes.add(new Scope(String.valueOf(scope)));
            }
        } catch (JSONException exception) {
            call.reject("Ámbitos de Google no válidos.", exception);
            return;
        }
        if (scopes.isEmpty()) {
            call.reject("Falta indicar los ámbitos de Google.");
            return;
        }

        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(getContext())
            .authorize(request)
            .addOnSuccessListener((result) -> {
                if (result.hasResolution() || result.getAccessToken() == null || result.getAccessToken().isEmpty()) {
                    call.reject("Google necesita confirmar la cuenta.", "NEEDS_USER");
                    return;
                }
                JSObject response = new JSObject();
                response.put("accessToken", result.getAccessToken());
                call.resolve(response);
            })
            .addOnFailureListener((exception) -> call.reject(exception.getMessage(), "FAILED", exception));
    }
}
