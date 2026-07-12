package com.oleventechnologies.iiprivatemessenger.security

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Bridge JS ↔ nativo per la sicurezza schermo (anti-screenshot / anti-registrazione).
 * Esposto a React Native come `NativeModules.ScreenSecurity` (vedi mobile/src/services/screenSecurity.ts).
 *
 * setSecure(true) applica FLAG_SECURE alla finestra: blocca screenshot e screen-recording e
 * oscura l'anteprima nell'app-switcher. setSecure(false) lo rimuove. Va eseguito sul thread UI.
 */
class ScreenSecurityModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "ScreenSecurity"

  @ReactMethod
  fun setSecure(enabled: Boolean, promise: Promise) {
    val activity = currentActivity
    if (activity == null) { promise.resolve(false); return }
    activity.runOnUiThread {
      try {
        if (enabled) {
          activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
          )
        } else {
          activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("screen_security_error", e)
      }
    }
  }
}
