package com.ereader.japanesevertical;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@CapacitorPlugin(name = "JapaneseTts")
public class JapaneseTtsPlugin extends Plugin {
    private TextToSpeech textToSpeech;
    private boolean initialized;
    private final ConcurrentHashMap<String, PluginCall> pendingCalls = new ConcurrentHashMap<>();

    @Override
    public void load() {
        textToSpeech = new TextToSpeech(getContext(), status -> {
            initialized = status == TextToSpeech.SUCCESS;
            if (initialized) {
                textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        resolveSpeech(utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        rejectSpeech(utteranceId, "El motor de voz no pudo reproducir el texto.");
                    }

                    @Override
                    public void onError(String utteranceId, int errorCode) {
                        rejectSpeech(utteranceId, "El motor de voz no pudo reproducir el texto (código " + errorCode + ").");
                    }
                });
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty()) {
            call.reject("No hay texto para pronunciar.");
            return;
        }
        if (!initialized || textToSpeech == null) {
            call.reject("El motor de voz de Android todavía no está disponible.");
            return;
        }

        int languageStatus = textToSpeech.setLanguage(Locale.JAPAN);
        if (languageStatus == TextToSpeech.LANG_MISSING_DATA
            || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED) {
            call.reject("Instala o habilita una voz japonesa en los ajustes de texto a voz de Android.");
            return;
        }

        double requestedRate = call.getDouble("rate", 0.9);
        textToSpeech.setSpeechRate((float) Math.max(0.5, Math.min(2.0, requestedRate)));
        String utteranceId = UUID.randomUUID().toString();
        pendingCalls.put(utteranceId, call);
        int result = textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
        if (result == TextToSpeech.ERROR) {
            pendingCalls.remove(utteranceId);
            call.reject("Android rechazó la solicitud de síntesis de voz.");
        }
    }

    private void resolveSpeech(String utteranceId) {
        PluginCall call = pendingCalls.remove(utteranceId);
        if (call != null) {
            call.resolve(new JSObject());
        }
    }

    private void rejectSpeech(String utteranceId, String message) {
        PluginCall call = pendingCalls.remove(utteranceId);
        if (call != null) {
            call.reject(message);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        pendingCalls.forEach((utteranceId, call) ->
            call.reject("La actividad se cerró antes de terminar la pronunciación.")
        );
        pendingCalls.clear();
        super.handleOnDestroy();
    }
}
