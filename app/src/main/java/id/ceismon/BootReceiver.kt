package id.ceismon

import android.content.*
import android.os.Build

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        if (c.getSharedPreferences("p", 0).getBoolean("alarm", true)) {
            val s = Intent(c, AlertService::class.java)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(s) else c.startService(s)
        }
    }
}
