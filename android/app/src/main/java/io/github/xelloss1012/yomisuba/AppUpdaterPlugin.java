package io.github.xelloss1012.yomisuba;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads a release of the app from GitHub and hands it to Android's installer, which asks the reader
 * to confirm and only accepts it when it is signed with the same key as the installed app. Installing
 * needs the reader to allow Yomisuba to install apps, once, in the system settings.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    /** Only releases of this repository are downloaded, whatever the page asks for. */
    private static final String RELEASES_PREFIX = "https://github.com/xelloss1012/yomisuba/releases/";
    private static final String APK_TYPE = "application/vnd.android.package-archive";
    private static final int TIMEOUT_MS = 30_000;

    private boolean installAllowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O
            || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private JSObject allowed() {
        JSObject result = new JSObject();
        result.put("allowed", installAllowed());
        return result;
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        call.resolve(allowed());
    }

    /** Opens the setting that lets Yomisuba install apps, and answers whether it was allowed on coming back. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve(allowed());
            return;
        }
        if (installAllowed()) {
            call.resolve(allowed());
            return;
        }
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        startActivityForResult(call, intent, "installSettingsResult");
    }

    @ActivityCallback
    private void installSettingsResult(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(allowed());
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith(RELEASES_PREFIX) || !url.endsWith(".apk")) {
            call.reject("Solo se descargan versiones de Yomisuba publicadas en GitHub.");
            return;
        }
        if (!installAllowed()) {
            call.reject("Yomisuba no tiene permiso para instalar aplicaciones.", "NOT_ALLOWED");
            return;
        }
        new Thread(() -> {
            try {
                File apk = download(url);
                checkPackage(apk);
                install(apk);
                call.resolve();
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? error.toString() : error.getMessage());
            }
        }, "yomisuba-update").start();
    }

    private File download(String url) throws Exception {
        File folder = new File(getContext().getCacheDir(), "updates");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new Exception("No se pudo preparar la descarga.");
        File[] old = folder.listFiles();
        if (old != null) for (File file : old) file.delete();
        File apk = new File(folder, "yomisuba.apk");

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new Exception("GitHub respondió " + status + ".");
            long total = connection.getContentLengthLong();
            long received = 0;
            long lastReport = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream input = connection.getInputStream(); OutputStream output = new FileOutputStream(apk)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    received += read;
                    long now = System.currentTimeMillis();
                    if (now - lastReport > 200) {
                        lastReport = now;
                        progress(received, total);
                    }
                }
            }
            progress(received, total);
            if (total > 0 && received != total) throw new Exception("La descarga se interrumpió.");
        } finally {
            connection.disconnect();
        }
        return apk;
    }

    private void progress(long received, long total) {
        JSObject event = new JSObject();
        event.put("received", received);
        event.put("total", total);
        notifyListeners("downloadProgress", event);
    }

    /** The file has to be this app; Android checks the signature when installing it. */
    private void checkPackage(File apk) throws Exception {
        PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), 0);
        if (info == null || !getContext().getPackageName().equals(info.packageName)) {
            apk.delete();
            throw new Exception("El archivo descargado no es una versión de Yomisuba.");
        }
    }

    private void install(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, APK_TYPE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }
}
