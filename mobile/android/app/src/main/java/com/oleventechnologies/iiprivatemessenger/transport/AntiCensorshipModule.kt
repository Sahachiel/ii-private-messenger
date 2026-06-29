package com.oleventechnologies.iiprivatemessenger.transport

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Bridge JS ↔ nativo per il transport anti-censura per-app.
 * Esposto a React Native come `NativeModules.AntiCensorship` (vedi mobile/src/services/transport.ts).
 *
 * Metodi:
 *  - prepare(): chiede il consenso VPN di sistema (una tantum) → Promise<boolean>
 *  - start(config): avvia il VpnService per-app col tunnel REALITY → Promise<boolean>
 *  - stop(): ferma il tunnel → Promise<boolean>
 *  - status(): stato corrente ('idle'|'connecting'|'connected'|'error')
 * Emette eventi 'AntiCensorship:state' via RCTDeviceEventEmitter.
 */
class AntiCensorshipModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private var prepPromise: Promise? = null

  init {
    reactContext.addActivityEventListener(this)
    // Il VpnService (processo stesso) notifica i cambi di stato → ri-emette a JS.
    Re4lityVpnService.stateListener = { s -> emitState(reactContext, s) }
  }

  override fun getName(): String = "AntiCensorship"

  @ReactMethod
  fun prepare(promise: Promise) {
    val intent = VpnService.prepare(reactContext)
    if (intent == null) {
      // Consenso già concesso in precedenza.
      promise.resolve(true)
      return
    }
    val activity: Activity? = currentActivity
    if (activity == null) {
      promise.resolve(false)
      return
    }
    prepPromise = promise
    activity.startActivityForResult(intent, VPN_PREPARE_REQUEST)
  }

  @ReactMethod
  fun start(config: ReadableMap, promise: Promise) {
    try {
      val intent = Intent(reactContext, Re4lityVpnService::class.java).apply {
        action = Re4lityVpnService.ACTION_START
        putExtra("server", config.getString("server"))
        putExtra("port", if (config.hasKey("port")) config.getInt("port") else 443)
        putExtra("uuid", config.getString("uuid"))
        putExtra("pbk", config.getString("pbk"))
        putExtra("sid", config.getString("sid"))
        putExtra("sni", config.getString("sni"))
        putExtra("flow", config.getString("flow"))
        putExtra("fp", config.getString("fp"))
      }
      ContextCompat.startForegroundService(reactContext, intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("start_failed", e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    val intent = Intent(reactContext, Re4lityVpnService::class.java).apply {
      action = Re4lityVpnService.ACTION_STOP
    }
    reactContext.startService(intent)
    promise.resolve(true)
  }

  @ReactMethod
  fun status(promise: Promise) {
    promise.resolve(Re4lityVpnService.currentState)
  }

  // Richiesti da RN per NativeEventEmitter (no-op: usiamo DeviceEventEmitter).
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}

  override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == VPN_PREPARE_REQUEST) {
      prepPromise?.resolve(resultCode == Activity.RESULT_OK)
      prepPromise = null
    }
  }

  override fun onNewIntent(intent: Intent?) {}

  companion object {
    const val VPN_PREPARE_REQUEST = 0xA17C

    fun emitState(reactContext: ReactApplicationContext, state: String) {
      if (!reactContext.hasActiveReactInstance()) return
      val params = Arguments.createMap().apply { putString("state", state) }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("AntiCensorship:state", params)
    }
  }
}
