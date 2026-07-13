# Sovranità e non-intercettabilità — audit dipendenze e piano

Obiettivo: nessun dato (contenuto **né** metadati) transita da terze parti, in particolare da
aziende soggette a giurisdizione USA. Tutto self-hosted, in giurisdizione scelta.

## Audit dipendenze (2026-07-13)

| Componente | Dipendenza terza-parte USA | Stato |
|---|---|---|
| mobile | `@react-native-firebase/app`, `@react-native-firebase/messaging` (Google) | **da rimuovere** → push sovrana (S0-A1) |
| backend | `firebase-admin` (Google) | **da rimuovere** → push astratta/sovrana (S0-A1) |
| desktop | — | pulito |
| chiamate WebRTC | `stun:stun.l.google.com:19302` (Google STUN) | **RIMOSSO** ✓ — ora solo coturn self-hosted |
| scan QR (mobile) | `react-native-vision-camera` → `com.google.mlkit:barcode-scanning` / `play-services-mlkit-barcode-scanning` (Google) | **RIMOSSO** ✓ — ora scan JS puro (image-picker + jpeg-js + jsQR) |

Nessun endpoint cloud USA hardcoded oltre a quelli sopra. Backend/relay/coturn sono già
self-hosted (VPS in giurisdizione scelta). STUN/TURN = coturn nostro.

## Fatto (questo commit)

- **Google STUN eliminato** da `mobile/src/services/webrtc.ts` e `desktop/renderer/call.js`.
  L'endpoint `stun:` è ora derivato dal `turns:` del nostro coturn (porta 3478): la scoperta
  dell'IP pubblico per le chiamate non passa più da Google.

## Scan QR sovrano — offline, zero Google (2026-07-13)

I QR si **generano** con `react-native-qrcode-svg` (SVG puro) e si **decodificano** interamente in
JavaScript con **jsQR (Apache-2.0)** dopo che una foto scattata dalla fotocamera di sistema
(`react-native-image-picker`) viene convertita in pixel da **jpeg-js (Apache-2.0)**. Nel percorso di
scansione **non c'è MLKit, non c'è Google Play Services, non c'è `com.google.zxing`, nessun SDK
barcode nativo, nessuna rete/telemetria**: la decodifica gira on-device in Hermes e funziona
offline/air-gapped. `react-native-vision-camera` — che forzava `com.google.mlkit:barcode-scanning`
/ `play-services-mlkit-barcode-scanning` — è stato **rimosso** dal progetto (era usato solo per lo
scan QR; foto/video usano `react-native-image-picker`).

Licenze: jsQR e jpeg-js sono Apache-2.0 (non MIT), di autori USA, ma con **zero dipendenza runtime da
Google**. `buffer` è già polyfillato globalmente all'avvio (`index.js`), così `jpeg-js` decodifica in
RN/Hermes.

**Tradeoff dichiarato (onestà):** la scansione è **uno scatto singolo** "tocca → scatta foto →
decodifica", non un viewfinder live continuo. In bare React Native (no Expo, senza vision-camera) non
esiste una sorgente di frame grezzi sovrana. Va bene per questa app: scansioniamo i **nostri** QR
puliti (ECL-M, alto contrasto) in azioni deliberate una-tantum (verifica identità, ingresso in
gruppo). Se in futuro serve la scansione live in stile WhatsApp, l'upgrade sanzionato è un piccolo
modulo nativo **ZXing (Android) + AVFoundation (iOS)** — anch'esso senza Google Play Services.

Regressione prevenuta: `scripts/verify-sovereign-scan.sh` (girato in CI prima della build) fallisce se
qualcuno reintroduce vision-camera / camera-kit / una barcode-lib Google.

### Impronta Google Play Services nell'APK — riduzione onesta

Verificato sull'APK release (`aapt dump` + albero dipendenze Gradle):

- **RIMOSSO** `com.google.mlkit:barcode-scanning` / `play-services-mlkit-barcode-scanning` (era lo
  scanner QR di vision-camera): via lo scan JS puro sopra. I `BarcodeRegistrar`/`VisionCommonRegistrar`
  spariti dal manifest merato.
- **RIMOSSO** `com.google.android.gms:play-services-iid` + `GoogleApiActivity`: era tirato SOLO da
  `react-native-device-info` per `getInstanceId()`, API che l'app non usa (usa solo getVersion/isEmulator);
  device-info vi accede via reflection con fallback UUID, quindi l'esclusione (`configurations.all { exclude
  … play-services-iid }` in `app/build.gradle` + `bootstrap-android.sh`) compila e non rompe nulla.
- **RESTA** solo `com.google.android.gms:play-services-tasks` → `play-services-basement` (il meta-data
  `com.google.android.gms.version`), tirato da **notifee** (`app.notifee:core`), la libreria che fornisce la
  **push sovrana** (foreground service + notifiche locali). È basement/tasks: **nessun MLKit, nessun
  GoogleApiActivity, nessun barcode, nessuna chiamata di rete o telemetria per sé**. Escluderlo rischia un
  `NoClassDefFoundError` a runtime nel foreground service → si romperebbe la push: non lo tocco senza test
  su device (regola "vero e funzionante"). Rimozione totale = sostituire/aggiornare notifee, passo futuro
  con verifica su telefono.

Netto: dell'impronta Google nell'APK restano ~2 artefatti passivi (tasks+basement) via la lib di notifiche;
MLKit, barcode, iid e GoogleApiActivity sono **eliminati**.

## In corso (programma sovrano Fase 0–3)

- **Fase 0** — S0-A1 push sovrana (rimuovi Firebase: WebSocket keepalive foreground service +
  UnifiedPush; iOS resta su APNs, limite di piattaforma), S0-B2 one-time-prekey reali, S0-D1
  REALITY di default in regioni ostili.
- **Fase 1** — S1-B1 post-quantum ibrido (X25519 + ML-KEM/Kyber, firme ML-DSA) contro
  "harvest now, decrypt later"; S1-C1 sealed sender (il server non sa chi-con-chi).
- **Fase 2** — S2-C2 padding a taglia fissa + cover traffic; S2-E2 chiavi in StrongBox/TEE;
  S2-E3 panic/duress wipe.
- **Fase 3** — S3-F1 reproducible builds (chiunque verifica che il binario = il codice).

## Onestà sui limiti

- **iOS**: il push in background passa obbligatoriamente da Apple (APNs). Su iOS non è
  eliminabile; si mandano solo push *senza contenuto*. Per sovranità totale del push serve
  Android de-googlato + push nostra.
- **"Inintercettabile"**: realistico sul **contenuto** (E2EE + post-quantum). Sui **metadati** è
  mitigabile molto (sealed sender, padding, no-terze-parti) ma mai perfetto. L'**endpoint**
  (il telefono) resta il punto più debole: vale l'hardening (Shield, blocco bio, TEE, wipe).
