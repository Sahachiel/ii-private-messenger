package com.oleventechnologies.iiprivatemessenger.security

import android.content.Context
import android.media.AudioManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Instradamento audio per le chiamate WebRTC. Esposto come NativeModules.AudioRoute.
 * setSpeaker(true) mette la modalità comunicazione e attiva l'altoparlante; false torna
 * all'auricolare. È ciò che fa un vivavoce reale (AudioManager, senza dipendenze extra).
 */
class AudioRouteModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "AudioRoute"

  @ReactMethod
  fun setSpeaker(on: Boolean, promise: Promise) {
    try {
      val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = on
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("audio_route_error", e)
    }
  }
}
