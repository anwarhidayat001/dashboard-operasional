package id.ceismon

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.webkit.*
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.URL

// Ganti kalau host server berubah
const val BASE_URL = "https://dashboard-operasional-ceisadashboard.apps.dcprod.customs.go.id"
const val APP_HOST = "appassets.androidplatform.net"

class MainActivity : Activity() {
    private val tabs = listOf("📊\nDashboard" to "index.html", "📈\nGrafik" to "monitoring.html",
        "🖥\nServer" to "server.html", "🎫\nTiket" to "tiket.html")
    private val tabViews = ArrayList<TextView>()
    private val pages = ArrayList<WebView>()   // 4 WebView hidup bersamaan, data selalu diperbarui di belakang
    private var current = 0
    private lateinit var alarmBtn: TextView

    private val mimes = mapOf("html" to "text/html", "js" to "application/javascript", "css" to "text/css",
        "png" to "image/png", "json" to "application/json", "mp3" to "audio/mpeg")

    // Dijalankan sebelum script halaman: halaman dianggap selalu "terlihat" supaya
    // auto-refresh tidak berhenti saat tab sedang tidak ditampilkan
    private val alwaysVisible = "<script>try{Object.defineProperty(document,'hidden',{get:function(){return false}});" +
        "Object.defineProperty(document,'visibilityState',{get:function(){return 'visible'}});" +
        "document.addEventListener('visibilitychange',function(e){e.stopImmediatePropagation()},true)}catch(e){}</script>"

    private fun err(code: Int, msg: String) = WebResourceResponse("application/json", "utf-8", code, "Error",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream("""{"error":"${msg.replace("\"", "'")}"}""".toByteArray()))

    // Halaman dari assets, threshold dari file lokal, sisanya (/DataServlet, /api/...) diteruskan ke server asli
    private fun handle(req: WebResourceRequest): WebResourceResponse? {
        val u = req.url
        if (u.host != APP_HOST) return null
        var p = u.path ?: "/"
        if (p == "/") p = "/index.html"
        if (p == "/ThresholdServlet" && req.method == "GET")
            return WebResourceResponse("application/json", "utf-8", assets.open("threshold.json"))
        try {
            val ext = p.substringAfterLast('.', "")
            if (ext == "html") {
                val html = assets.open("public$p").bufferedReader().readText()
                    .replace("</head>", "$alwaysVisible<link rel=\"stylesheet\" href=\"/mobile.css\"></head>")
                return WebResourceResponse("text/html", "utf-8", ByteArrayInputStream(html.toByteArray()))
            }
            return WebResourceResponse(mimes[ext] ?: "application/octet-stream", "utf-8", assets.open("public$p"))
        } catch (_: Exception) { }
        if (req.method != "GET") return err(501, "Aksi ${req.method} tidak didukung di aplikasi")
        return try {
            val c = URL(BASE_URL + p + (u.query?.let { "?$it" } ?: "")).openConnection() as HttpURLConnection
            c.connectTimeout = 15000; c.readTimeout = 30000
            c.setRequestProperty("Accept", req.requestHeaders["Accept"] ?: "*/*")
            val code = c.responseCode
            val st = if (code < 400) c.inputStream else (c.errorStream ?: ByteArrayInputStream(ByteArray(0)))
            WebResourceResponse((c.contentType ?: "application/json").substringBefore(';'), "utf-8", code,
                c.responseMessage?.ifBlank { "OK" } ?: "OK", mapOf("Cache-Control" to "no-store"), st)
        } catch (e: Exception) { err(502, e.message ?: "gagal terhubung ke server") }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun navItem(text: String, click: () -> Unit) = TextView(this).apply {
        this.text = text; textSize = 11f; gravity = Gravity.CENTER
        setTextColor(Color.parseColor("#8f9ab3")); setPadding(0, dp(8), 0, dp(8))
        layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        setOnClickListener { click() }
    }

    private fun alarmOn() = getSharedPreferences("p", 0).getBoolean("alarm", true)

    private fun applyAlarm() {
        val s = Intent(this, AlertService::class.java)
        if (alarmOn()) { if (Build.VERSION.SDK_INT >= 26) startForegroundService(s) else startService(s) }
        else stopService(s)
        alarmBtn.text = if (alarmOn()) "🔔\nAlarm ON" else "🔕\nAlarm OFF"
        alarmBtn.setTextColor(Color.parseColor(if (alarmOn()) "#4ade80" else "#f87171"))
    }

    // Tampilkan tab i. Yang lain INVISIBLE (bukan GONE) supaya ukuran layout tetap
    // dan grafik tetap tergambar benar di belakang.
    private fun show(i: Int) {
        current = i
        pages.forEachIndexed { k, w -> w.visibility = if (k == i) View.VISIBLE else View.INVISIBLE }
        tabViews.forEachIndexed { k, t ->
            t.setTextColor(Color.parseColor(if (k == i) "#ffffff" else "#8f9ab3"))
            t.setBackgroundColor(Color.parseColor(if (k == i) "#3b4560" else "#2d3548"))
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun newWebView(page: String): WebView = WebView(this).apply {
        setBackgroundColor(Color.parseColor("#1e2433"))
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(v: WebView, r: WebResourceRequest) = handle(r)
        }
        loadUrl("https://$APP_HOST/$page")
    }

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        window.statusBarColor = Color.parseColor("#1e2433")
        window.navigationBarColor = Color.parseColor("#2d3548")

        val stack = FrameLayout(this)
        tabs.forEach { (_, page) ->
            val w = newWebView(page)
            pages.add(w)
            stack.addView(w, FrameLayout.LayoutParams(-1, -1))
        }

        val nav = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setBackgroundColor(Color.parseColor("#2d3548")) }
        tabs.forEachIndexed { i, (label, _) -> val v = navItem(label) { show(i) }; tabViews.add(v); nav.addView(v) }
        alarmBtn = navItem("") {
            getSharedPreferences("p", 0).edit().putBoolean("alarm", !alarmOn()).apply(); applyAlarm()
        }
        nav.addView(alarmBtn)

        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(stack, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(nav, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)
        show(0)

        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        applyAlarm()
        val prefs = getSharedPreferences("p", 0)
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        if (!prefs.getBoolean("askedBatt", false) && !pm.isIgnoringBatteryOptimizations(packageName)) {
            prefs.edit().putBoolean("askedBatt", true).apply()
            try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) } catch (_: Exception) { }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val w = pages[current]
        if (w.canGoBack()) w.goBack() else super.onBackPressed()
    }
}
