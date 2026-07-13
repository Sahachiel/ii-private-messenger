package com.oleventechnologies.iiprivatemessenger.security

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.net.wifi.WifiManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Controlli di sicurezza dispositivo REALI per il motore MTD (Shield). Esposto come
 * NativeModules.DeviceSecurity. Ogni metodo interroga le API di sistema Android:
 *  - listDeviceAdmins: device admin/MDM attivi (DevicePolicyManager)
 *  - getInstalledPackages: pacchetti installati (PackageManager) per il match blocklist
 *  - getWifiInfo: stato Wi-Fi (WifiManager); SSID può essere mascherato senza permesso posizione
 * Sostituisce gli stub che ritornavano sempre vuoto (verdetti "OK" su controlli mai eseguiti).
 */
class DeviceSecurityModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "DeviceSecurity"

  @ReactMethod
  fun listDeviceAdmins(promise: Promise) {
    try {
      val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
      val admins: List<ComponentName>? = dpm.activeAdmins
      val arr = Arguments.createArray()
      admins?.forEach { arr.pushString(it.packageName) }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("device_admin_error", e)
    }
  }

  @ReactMethod
  fun getInstalledPackages(promise: Promise) {
    try {
      val pm = ctx.packageManager
      val pkgs = pm.getInstalledPackages(0)
      val arr = Arguments.createArray()
      for (p in pkgs) arr.pushString(p.packageName)
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("packages_error", e)
    }
  }

  @ReactMethod
  fun getWifiInfo(promise: Promise) {
    try {
      val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      @Suppress("DEPRECATION")
      val info = wm.connectionInfo
      val map = Arguments.createMap()
      map.putBoolean("connected", info != null && info.networkId != -1)
      // SSID/BSSID richiedono il permesso posizione su Android 8+; se non concesso il sistema
      // ritorna "<unknown ssid>"/"02:00:00:00:00:00" — il detector lo tratta come non identificabile.
      map.putString("ssid", info?.ssid?.replace("\"", "") ?: "")
      map.putString("bssid", info?.bssid ?: "")
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("wifi_error", e)
    }
  }
}
