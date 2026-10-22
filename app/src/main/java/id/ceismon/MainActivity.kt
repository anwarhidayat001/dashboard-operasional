package id.ceismon

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.*
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

// Ganti kalau host server berubah
const val BASE_URL = "https://dashboard-operasional-ceisadashboard.apps.dcprod.customs.go.id"
const val APP_HOST = "appassets.androidplatform.net"

class MainActivity : Activity() {
    private lateinit var wv: WebView

    private val mimes = mapOf(
        "html" to "text/html", "js" to "application/javascript", "css" to "text/css",
        "png" to "image/png", "json" to "application/json", "mp3" to "audio/mpeg"
    )

    private fun err(code: Int, msg: String) = WebResourceResponse(
        "application/json", "utf-8", code, "Error", mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream("""{"error":"${msg.replace("\"", "'")}"}""".toByteArray())
    )

    // Halaman (html/js/css) dari assets, sisanya (/DataServlet, /api/...) diteruskan ke server asli.
    // Origin sama -> tidak ada masalah CORS dan semua fetch relatif di halaman tetap jalan.
    private fun handle(req: WebResourceRequest): WebResourceResponse? {
        val u = req.url
        if (u.host != APP_HOST) return null
        var p = u.path ?: "/"
        if (p == "/") p = "/index.html"
        try {
            val ext = p.substringAfterLast('.', "")
            val s = assets.open("public$p")
            return WebResourceResponse(mimes[ext] ?: "application/octet-stream", "utf-8", s)
        } catch (_: Exception) { }
        if (req.method != "GET") return err(501, "Aksi ${req.method} tidak didukung di aplikasi")
        return try {
            val c = URL(BASE_URL + p + (u.query?.let { "?$it" } ?: "")).openConnection() as HttpURLConnection
            c.connectTimeout = 15000; c.readTimeout = 30000
            c.setRequestProperty("Accept", req.requestHeaders["Accept"] ?: "*/*")
            val code = c.responseCode
            val st = if (code < 400) c.inputStream else (c.errorStream ?: ByteArrayInputStream(ByteArray(0)))
            val ct = (c.contentType ?: "application/json").substringBefore(';')
            WebResourceResponse(ct, "utf-8", code, c.responseMessage?.ifBlank { "OK" } ?: "OK",
                mapOf("Cache-Control" to "no-store"), st)
        } catch (e: Exception) { err(502, e.message ?: "gagal terhubung ke server") }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        wv = WebView(this)
        wv.setBackgroundColor(Color.parseColor("#1e2433"))
        wv.settings.javaScriptEnabled = true
        wv.settings.domStorageEnabled = true
        wv.settings.mediaPlaybackRequiresUserGesture = false
        wv.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest) = handle(r)
        }
        wv.loadUrl("https://$APP_HOST/index.html")
        setContentView(wv)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { if (wv.canGoBack()) wv.goBack() else super.onBackPressed() }
}
