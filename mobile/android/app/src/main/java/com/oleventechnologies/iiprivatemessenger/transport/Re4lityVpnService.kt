package com.oleventechnologies.iiprivatemessenger.transport

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * VpnService PER-APP: instrada SOLO il traffico di II Private Messenger
 * (addAllowedApplication col proprio package) attraverso un tunnel VLESS + XTLS-Vision +
 * REALITY gestito da sing-box. Il resto del telefono resta diretto.
 *
 * INTEGRAZIONE sing-box (libbox.aar): i punti marcati `TODO(singbox)` vanno completati e
 * verificati su device con la versione del .aar scelta — l'API Libbox è version-specific.
 * Tutta la parte Android (tun builder, per-app routing, foreground, config JSON) è qui.
 * Vedi mobile/android/ANTI_CENSORSHIP_NATIVE.md.
 */
class Re4lityVpnService : VpnService() {

  private var tun: ParcelFileDescriptor? = null
  // private var boxService: io.nekohasekai.libbox.BoxService? = null   // TODO(singbox): tipo reale

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> { stopTunnel(); return START_NOT_STICKY }
      ACTION_START -> startTunnel(intent)
    }
    return START_STICKY
  }

  private fun startTunnel(intent: Intent) {
    setState("connecting")
    startForeground(NOTIF_ID, buildNotification())

    // ONESTÀ CRITICA: se il core sing-box (libbox.aar) NON è linkato in questa build, NON dobbiamo
    // stabilire il tun. Un tun con addRoute(0.0.0.0/0) + addAllowedApplication(self) cattura TUTTO il
    // traffico dell'app; senza un core che lo instrada verso l'outbound REALITY, i pacchetti finiscono
    // nel nulla (black-hole) e l'app perde ogni connettività pur "sembrando" connessa. Meglio fallire
    // onestamente con 'error' e lasciare l'app sulla rete diretta.
    if (!coreAvailable()) {
      setState("error")
      stopTunnel()
      return
    }
    try {
      val builder = Builder()
        .setSession("II Anti-Censorship")
        .setMtu(1500)
        .addAddress("10.10.0.2", 32)
        .addDnsServer("1.1.1.1")
        .addRoute("0.0.0.0", 0)
      // Solo l'app stessa passa nel tunnel; tutto il resto del telefono resta diretto.
      builder.addAllowedApplication(packageName)

      val pfd = builder.establish() ?: throw IllegalStateException("establish() returned null")
      tun = pfd

      val configJson = buildSingBoxConfig(intent, pfd.fd)
      // TODO(singbox): avviare il core col config e il fd del tun, es. (API indicativa):
      //   Libbox.setup(filesDir.absolutePath, filesDir.absolutePath, cacheDir.absolutePath, false)
      //   boxService = Libbox.newService(configJson, platformInterface)
      //   boxService?.start()
      // Riportiamo 'connected' SOLO quando il core è effettivamente avviato (coreAvailable() sopra lo
      // garantisce: senza .aar non arriviamo mai qui). Il codice che aggancia il core va completato in
      // startCore() e verificato su device con la versione del .aar scelta.
      startCore(configJson, pfd.fd)
      setState("connected")
    } catch (e: Exception) {
      setState("error")
      stopTunnel()
    }
  }

  /**
   * true se il core sing-box (libbox.aar) è realmente presente nel classpath di questa build.
   * Finché il .aar non è bundlato, ritorna false → il service non stabilisce il tun (niente
   * black-hole) e riporta 'error'. Chi aggiunge il .aar e implementa startCore() lo abilita.
   */
  private fun coreAvailable(): Boolean {
    return try {
      Class.forName("io.nekohasekai.libbox.Libbox")
      true
    } catch (_: Throwable) {
      false
    }
  }

  /** Avvia il core sing-box col config e il fd del tun. TODO(singbox): implementare con l'API del .aar. */
  private fun startCore(@Suppress("UNUSED_PARAMETER") configJson: String, @Suppress("UNUSED_PARAMETER") tunFd: Int) {
    // TODO(singbox): Libbox.setup(...); boxService = Libbox.newService(configJson, platformInterface); boxService?.start()
    // Non raggiungibile finché coreAvailable()==false. Presente per non lasciare il path "connected" senza core.
    throw IllegalStateException("sing-box core not wired: startCore() not implemented for the bundled .aar")
  }

  private fun stopTunnel() {
    try { /* boxService?.close() */ } catch (_: Exception) {}
    try { tun?.close() } catch (_: Exception) {}
    tun = null
    setState("idle")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION") stopForeground(true)
    }
    stopSelf()
  }

  /** JSON di config sing-box: inbound `tun` (per-app via VpnService) + outbound `vless`/reality. */
  private fun buildSingBoxConfig(intent: Intent, tunFd: Int): String {
    val server = intent.getStringExtra("server")
    val port = intent.getIntExtra("port", 443)
    val uuid = intent.getStringExtra("uuid")
    val pbk = intent.getStringExtra("pbk")
    val sid = intent.getStringExtra("sid")
    val sni = intent.getStringExtra("sni")
    val flow = intent.getStringExtra("flow") ?: "xtls-rprx-vision"
    val fp = intent.getStringExtra("fp") ?: "chrome"

    val inbound = JSONObject()
      .put("type", "tun")
      .put("tag", "tun-in")
      .put("interface_name", "tun0")
      .put("inet4_address", "10.10.0.2/32")
      .put("mtu", 1500)
      .put("auto_route", false) // il routing/per-app lo gestisce VpnService, non sing-box
      .put("stack", "gvisor")
      .put("file_descriptor", tunFd) // TODO(singbox): verificare il nome del campo per la versione del .aar

    val reality = JSONObject()
      .put("enabled", true)
      .put("public_key", pbk)
      .put("short_id", sid)
    val utls = JSONObject().put("enabled", true).put("fingerprint", fp)
    val tls = JSONObject()
      .put("enabled", true)
      .put("server_name", sni)
      .put("utls", utls)
      .put("reality", reality)
    val outbound = JSONObject()
      .put("type", "vless")
      .put("tag", "reality-out")
      .put("server", server)
      .put("server_port", port)
      .put("uuid", uuid)
      .put("flow", flow)
      .put("packet_encoding", "xudp")
      .put("tls", tls)

    return JSONObject()
      .put("log", JSONObject().put("level", "warn"))
      .put("inbounds", JSONArray().put(inbound))
      .put("outbounds", JSONArray().put(outbound))
      .toString()
  }

  private fun buildNotification(): Notification {
    val chId = "anticensorship"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val ch = NotificationChannel(chId, "Anti-Censorship", NotificationManager.IMPORTANCE_LOW)
      getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }
    return NotificationCompat.Builder(this, chId)
      .setContentTitle("II — Secure transport")
      .setContentText("Connessione anti-censura attiva")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()
  }

  override fun onDestroy() { stopTunnel(); super.onDestroy() }
  override fun onRevoke() { stopTunnel(); super.onRevoke() }

  private fun setState(s: String) {
    currentState = s
    stateListener?.invoke(s)
  }

  companion object {
    const val ACTION_START = "com.oleventechnologies.iiprivatemessenger.transport.START"
    const val ACTION_STOP = "com.oleventechnologies.iiprivatemessenger.transport.STOP"
    const val NOTIF_ID = 0xA17C

    @JvmStatic var currentState: String = "idle"

    /** Il Module registra qui un callback per ri-emettere lo stato a JS (stesso processo). */
    @JvmStatic var stateListener: ((String) -> Unit)? = null
  }
}
