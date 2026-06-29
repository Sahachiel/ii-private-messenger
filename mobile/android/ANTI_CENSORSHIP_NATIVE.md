# Transport anti-censura per-app — integrazione nativa Android

Tunnel **VLESS + XTLS-Vision + REALITY** instradato **solo per l'app II** (per-app VpnService),
così in Russia la messaggistica funziona senza attivare una VPN di sistema separata.

Il layer JS (`mobile/src/services/transport.ts`, aggancio in `authSlice`, toggle in Settings) e
il backend (`proxy_config` distribuito al login per la region `ru`) sono **già pronti** e degradano
a no-op finché il modulo nativo non è presente. Questo documento copre **solo** il pezzo nativo
Android, che richiede toolchain + un device fisico per il test (VpnService non è verificabile su
emulatore headless).

## File già creati
- `app/src/main/java/com/oleventechnologies/iiprivatemessenger/transport/Re4lityVpnService.kt`
- `app/src/main/java/com/oleventechnologies/iiprivatemessenger/transport/AntiCensorshipModule.kt`
- `app/src/main/java/com/oleventechnologies/iiprivatemessenger/transport/AntiCensorshipPackage.kt`

## Passi rimanenti (sul tuo toolchain)

### 1. Generare il boilerplate Android (se non esiste già)
La cartella `android/` è ancora template: `MainApplication`/`MainActivity`/`AndroidManifest.xml`
vengono creati al primo:
```bash
cd mobile && npm install && npx react-native run-android
```

### 2. Ottenere il core sing-box (`libbox.aar`)
Sing-box ha **tun inbound + vless/reality outbound** in un unico binario Go.
- **Download** (consigliato, no Go necessario): prendi `libbox.aar` da una release ufficiale
  sing-box per Android e mettilo in `app/libs/libbox.aar`.
- **Self-build**: con Go + `gomobile` + Android NDK:
  ```bash
  go install golang.org/x/mobile/cmd/gomobile@latest
  gomobile init
  gomobile bind -target=android -androidapi 24 -o libbox.aar ./experimental/libbox
  ```

### 3. `app/build.gradle`
```gradle
android {
    defaultConfig {
        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }   // limita la dimensione dell'.aar
    }
}
dependencies {
    implementation files('libs/libbox.aar')
    implementation 'androidx.core:core-ktx:1.13.1'
}
```

### 4. `AndroidManifest.xml` (dentro `<manifest>` / `<application>`)
```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<!-- targetSdk 34: tipo esplicito del foreground service -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />

<application ...>
  <service
      android:name=".transport.Re4lityVpnService"
      android:permission="android.permission.BIND_VPN_SERVICE"
      android:foregroundServiceType="specialUse"
      android:exported="false">
    <intent-filter>
      <action android:name="android.net.VpnService" />
    </intent-filter>
  </service>
</application>
```

### 5. `MainApplication` — registrare il package
Nel `getPackages()` (Kotlin generato da RN 0.73):
```kotlin
override fun getPackages(): List<ReactPackage> =
    PackageList(this).packages.apply {
        add(AntiCensorshipPackage())
        // ...gli altri NativeModule custom referenziati dal codice (InstalledApps, MDMInspector,
        //    WifiManager) vanno registrati allo stesso modo se non già autolinked.
    }
```

### 6. Completare l'aggancio sing-box (`TODO(singbox)` in Re4lityVpnService.kt)
Punti da finalizzare con la versione esatta del `.aar`:
- `Libbox.setup(...)` con i path di base/lavoro/cache.
- Creazione del servizio dal `configJson` e dal **file descriptor** del tun (`pfd.fd`).
  Verificare il nome del campo per passare il fd (`file_descriptor` nell'inbound `tun`, oppure
  via PlatformInterface a seconda della build libbox).
- `start()` / `close()` sul servizio in `startTunnel`/`stopTunnel`.
- Impostare `setState("connected")` solo dopo che il core è effettivamente up.

## Verifica su device fisico
1. `npx react-native run-android` su telefono reale (USB).
2. App → Settings → Routing → **Anti-Censorship ON** → compare la **dialog di consenso VPN**
   (una tantum) e l'icona "chiave" in status bar.
3. Sul VPS, osservare l'handshake: `ssh root@<VPS_IP>` →
   `tcpdump -ni any port 443 and host <ip-telefono>` → deve mostrare TLS con SNI `www.apple.com`.
4. **Per-app**: aprire un browser sul telefono → il suo traffico resta **diretto** (non nel tunnel).
   Confermare che solo II passa per il proxy.
5. Login + messaggio RU→IT con tunnel attivo → consegnato; l'SSL pinning di `api.ts` **non si rompe**
   (REALITY non termina il TLS pinnato); relay WSS connesso nel tunnel.
6. MTD: dopo l'attivazione, lo stato resta `secure`/`warning` (mai `compromised` per via del transport);
   l'invio non viene bloccato. (Esenzione già in `mobile/src/xsec-mtd/detectors/mitm.ts`.)

## Note
- iOS: stessa interfaccia JS (`NativeModules.AntiCensorship`), implementazione via
  `NEPacketTunnelProvider` in App Extension + sing-box `.xcframework`. Fase successiva.
- Rotazione credenziali: oggi la `proxy_config` arriva col login (backend). In futuro si può
  ruotare in modo firmato via il canale MTD esistente senza nuova build.
