package id.ceismon

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private lateinit var wv: WebView

    // Request HTTP lewat native supaya tidak kena CORS
    inner class Bridge {
        @JavascriptInterface
        fun get(id: String, url: String) {
            Thread {
                var code = 0; var body: String
                try {
                    val c = URL(url).openConnection() as HttpURLConnection
                    c.connectTimeout = 15000; c.readTimeout = 25000
                    c.setRequestProperty("Accept", "application/json")
                    code = c.responseCode
                    body = (if (code < 400) c.inputStream else c.errorStream).bufferedReader().readText()
                } catch (e: Exception) { body = e.message ?: "error" }
                val js = "window.__cb('$id',$code,${JSONObject.quote(body)})"
                wv.post { wv.evaluateJavascript(js, null) }
            }.start()
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        wv = WebView(this)
        wv.setBackgroundColor(Color.parseColor("#1e2433"))
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.addJavascriptInterface(Bridge(), "Native")
        wv.loadUrl("file:///android_asset/app.html")
        setContentView(wv)
    }
}
