package com.iptvplayer.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

public class MainActivity extends Activity {
    private static final int PICK_FILE = 1;

    private WebView webView;
    private final ExecutorService io = Executors.newCachedThreadPool();
    // Large results (playlists can be tens of MB) are parked here and pulled
    // by JS through takeResult(), instead of being escaped into a JS string.
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private String pendingPickId;
    private long lastBackPress;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0f0f0f"));
        setContentView(webView);
        hideSystemUi();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        // The page is served from file://, so this lifts CORS for hls.js requests
        // (the Android equivalent of webSecurity:false in the Electron build).
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    // Remote buttons that WebView doesn't reliably deliver to JS are forwarded by name.
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String name = remoteKeyName(event.getKeyCode());
        if (name != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                js("window.__onRemoteKey && window.__onRemoteKey(" + JSONObject.quote(name) + ")");
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private static String remoteKeyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "playpause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "play";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "pause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "stop";
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_PAGE_UP: return "chup";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
            case KeyEvent.KEYCODE_PAGE_DOWN: return "chdown";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "ff";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "rew";
            case KeyEvent.KEYCODE_MENU: return "menu";
            case KeyEvent.KEYCODE_GUIDE: return "guide";
            default: return null;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("!!(window.__onBack && window.__onBack())", value -> {
            if ("true".equals(value)) return;
            long now = System.currentTimeMillis();
            if (now - lastBackPress < 2000) {
                finish();
            } else {
                lastBackPress = now;
                Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE || pendingPickId == null) return;
        String id = pendingPickId;
        pendingPickId = null;
        Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
        if (uri != null) results.put(id, uri.toString());
        done(id, null);
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        webView.destroy();
        super.onDestroy();
    }

    private void js(String script) {
        runOnUiThread(() -> webView.evaluateJavascript(script, null));
    }

    private void done(String id, String error) {
        js("window.__nativeDone(" + JSONObject.quote(id) + "," + (error == null ? "null" : JSONObject.quote(error)) + ")");
    }

    private File dataFile(String key) {
        String safe = key.replaceAll("[^A-Za-z0-9_-]", "_");
        return new File(getFilesDir(), "playlist-cache".equals(key) ? safe + ".gz" : safe + ".json");
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream is = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static String fetch(String target, int redirectsLeft) throws IOException {
        if (redirectsLeft < 0) throw new IOException("Too many redirects");
        HttpURLConnection conn = (HttpURLConnection) new URL(target).openConnection();
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(20000);
        // Handled manually so http <-> https redirects are followed too.
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) IPTVPlayer/1.0");
        try {
            int code = conn.getResponseCode();
            String location = conn.getHeaderField("Location");
            if (code >= 300 && code < 400 && location != null) {
                return fetch(new URL(new URL(target), location).toString(), redirectsLeft - 1);
            }
            if (code != 200) throw new IOException("HTTP " + code);
            return readAll(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    private class Bridge {
        @JavascriptInterface
        public String takeResult(String id) {
            return results.remove(id);
        }

        @JavascriptInterface
        public void fetchUrl(String id, String url) {
            io.execute(() -> {
                try {
                    results.put(id, fetch(url, 5));
                    done(id, null);
                } catch (Exception e) {
                    done(id, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        @JavascriptInterface
        public void readFile(String id, String path) {
            io.execute(() -> {
                try {
                    InputStream in = path.startsWith("content://")
                            ? getContentResolver().openInputStream(Uri.parse(path))
                            : new FileInputStream(path);
                    if (in == null) throw new IOException("Could not open file");
                    results.put(id, readAll(in));
                    done(id, null);
                } catch (Exception e) {
                    done(id, e.getMessage() != null ? e.getMessage() : e.toString());
                }
            });
        }

        @JavascriptInterface
        public void pickFile(String id) {
            runOnUiThread(() -> {
                pendingPickId = id;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.setType("*/*");
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                try {
                    startActivityForResult(intent, PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    pendingPickId = null;
                    done(id, "No file browser is installed on this device");
                }
            });
        }

        @JavascriptInterface
        public void saveData(String key, String json) {
            File f = dataFile(key);
            try (OutputStream out = "playlist-cache".equals(key)
                    ? new GZIPOutputStream(new FileOutputStream(f))
                    : new FileOutputStream(f)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            } catch (IOException ignored) {
            }
        }

        @JavascriptInterface
        public String loadData(String key) {
            File f = dataFile(key);
            if (!f.exists()) return null;
            try {
                InputStream in = new FileInputStream(f);
                return readAll("playlist-cache".equals(key) ? new GZIPInputStream(in) : in);
            } catch (IOException e) {
                return null;
            }
        }
    }
}
