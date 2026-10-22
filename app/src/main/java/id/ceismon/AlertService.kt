package id.ceismon

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.*

// Cek tiap 30 dtk; alarm diulang tiap 10 mnt selama masalah masih ada
const val POLL_MS = 30_000L
const val REPEAT_MS = 10 * 60_000L
val FIELDS = setOf("impor", "ekspor", "pibk", "ecommerce", "sawit", "mpn", "rksp", "inward", "outward",
    "kek", "tpb", "pib", "peb", "ftz", "kirim_kominfo", "total_imei", "status", "last_status")

class AlertService : Service() {
    @Volatile private var running = false
    private val last = HashMap<String, Long>()
    private lateinit var th: JSONObject

    override fun onBind(i: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        th = JSONObject(assets.open("threshold.json").bufferedReader().readText())
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("status", "Status pemantauan", NotificationManager.IMPORTANCE_LOW))
            val ch = NotificationChannel("alarm_v1", "Alarm threshold & server", NotificationManager.IMPORTANCE_HIGH)
            ch.setSound(Uri.parse("android.resource://$packageName/${R.raw.alarm}"),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            ch.enableVibration(true); ch.vibrationPattern = longArrayOf(0, 600, 300, 600, 300, 600)
            ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(ch)
        }
    }

    private fun builder(ch: String): Notification.Builder {
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, ch) else Notification.Builder(this)
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return b.setSmallIcon(android.R.drawable.ic_dialog_alert).setContentIntent(pi)
    }

    private fun fg(text: String): Notification =
        builder("status").setContentTitle("CeisMon aktif").setContentText(text).setOngoing(true).build()

    override fun onStartCommand(i: Intent?, f: Int, id: Int): Int {
        val n = fg("Memantau threshold dan server")
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(1, n)
        if (!running) { running = true; Thread { loop() }.start() }
        return START_STICKY
    }

    override fun onDestroy() { running = false; super.onDestroy() }

    private fun loop() {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        while (running) {
            val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ceismon:poll")
            wl.acquire(60_000)
            try { poll() } catch (_: Exception) { } finally { if (wl.isHeld) wl.release() }
            try { Thread.sleep(POLL_MS) } catch (_: InterruptedException) { }
        }
    }

    private fun get(path: String): String {
        val c = URL(BASE_URL + path).openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = 25000
        if (c.responseCode >= 400) throw Exception("HTTP ${c.responseCode}")
        return c.inputStream.bufferedReader().readText()
    }

    // Sama dengan web: <=green hijau, <=yellow kuning, <=orange oranye, selebihnya merah
    private fun isRed(v: Double, kat: String, type: String): Boolean {
        val t = th.optJSONObject(kat)?.optJSONObject(type)
        val g = t?.optDouble("green", 50.0) ?: 50.0
        val y = t?.optDouble("yellow", 100.0) ?: 100.0
        val o = t?.optDouble("orange", 200.0) ?: 200.0
        return !(v <= g || v <= y || v <= o)
    }

    private fun poll() {
        val issues = linkedMapOf<String, String>()
        var ok = false
        try {
            val d = JSONObject(get("/DataServlet")); ok = true
            for (name in listOf("oracleData", "postgreData")) {
                val a = d.optJSONArray(name) ?: continue
                for (i in 0 until a.length()) {
                    val o = a.optJSONObject(i) ?: continue
                    val kat = o.optString("KATEGORI", o.optString("kategori", ""))
                    if (kat.isEmpty()) continue
                    for (k in o.keys()) {
                        val kl = k.lowercase()
                        if (kl !in FIELDS) continue
                        val v = o.optDouble(k, Double.NaN)
                        if (!v.isNaN() && isRed(v, kat, kl))
                            issues["$kat|$kl"] = "$kat ${k.uppercase()}: ${v.toLong()} (melewati threshold)"
                    }
                }
            }
        } catch (_: Exception) { }
        try {
            val s = JSONObject(get("/api/server_history?minutes=3")); ok = true
            val all = s.optJSONArray("allSnaps")
            val snap = if (all != null && all.length() > 0) all.optJSONArray(all.length() - 1) else null
            if (snap != null) for (i in 0 until snap.length()) {
                val r = snap.optJSONObject(i) ?: continue
                val st = r.optString("status")
                if (st == "DOWN" || st == "ERROR") issues["srv|${r.optString("name")}"] = "Server ${r.optString("name")}: $st"
            }
        } catch (_: Exception) { }
        if (!ok) return
        val now = System.currentTimeMillis()
        last.keys.retainAll(issues.keys)
        val fresh = issues.keys.filter { now - (last[it] ?: 0L) > REPEAT_MS }
        if (fresh.isNotEmpty()) {
            fresh.forEach { last[it] = now }
            val lines = issues.values.toList()
            val n = builder("alarm_v1").setContentTitle("⚠ ${lines.size} peringatan CeisMon")
                .setContentText(lines.first())
                .setStyle(Notification.BigTextStyle().bigText(lines.take(8).joinToString("\n") +
                    if (lines.size > 8) "\n+${lines.size - 8} lainnya" else ""))
                .setAutoCancel(true).setCategory(Notification.CATEGORY_ALARM).setPriority(Notification.PRIORITY_HIGH)
            if (Build.VERSION.SDK_INT < 26) {
                n.setSound(Uri.parse("android.resource://$packageName/${R.raw.alarm}"), AudioManagerStream.ALARM)
                n.setVibrate(longArrayOf(0, 600, 300, 600))
            }
            getSystemService(NotificationManager::class.java).notify(2, n.build())
        }
        val t = SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date())
        getSystemService(NotificationManager::class.java).notify(1,
            fg("Cek $t • ${if (issues.isEmpty()) "semua normal" else "${issues.size} masalah"}"))
    }
}

object AudioManagerStream { const val ALARM = android.media.AudioManager.STREAM_ALARM }
