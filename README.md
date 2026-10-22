# CeisMon Android
APK ini membungkus halaman asli (index, monitoring, server, tiket) dari projek Node.js.
Halaman disimpan di app/src/main/assets/public; request /DataServlet dan /api/* diteruskan ke BASE_URL (MainActivity.kt).
Update tampilan: salin ulang file dari folder public projek web ke assets/public, lalu build ulang.
Build: push ke GitHub -> Actions "Build APK" -> artifact CeisMon-apk. Atau Android Studio -> Build APK(s).
Catatan: HP harus bisa mengakses host customs.go.id (VPN/jaringan kantor bila perlu).
