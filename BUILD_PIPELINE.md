# Pipeline build — APK Android + IPA iOS (via CI, artefatti VERI)

Su Windows **non** si compila iOS e l'Android non era buildabile. Questa pipeline produce
artefatti **reali** tramite GitHub Actions: Android su runner Ubuntu, iOS su runner **macOS**
(firma con Apple Developer **App Store Connect API**, senza Mac fisico).

## Cosa è già pronto nel repo
- `scripts/bootstrap-android.sh` — genera il boilerplate Android mancante dal template RN 0.73.9 + applica i nostri moduli nativi (VpnService, permessi, registrazione package).
- `scripts/bootstrap-ios.sh` — genera `mobile/ios/` da template (solo su macOS).
- `.github/workflows/android.yml` — build **APK debug installabile** (+ release se c'è il keystore).
- `.github/workflows/ios.yml` + `mobile/fastlane/` — build **IPA** firmato via ASC API.

## Secrets da impostare su GitHub (Settings → Secrets → Actions)
Prendili dal **vault** (`cd C:\vault && ./vault.sh open`, passphrase tua) e incollali come
secret — **non passano da me, restano tuoi**.

### iOS (obbligatori per l'IPA)
| Secret | Cos'è |
|---|---|
| `ASC_KEY_ID` | Key ID della chiave App Store Connect API |
| `ASC_ISSUER_ID` | Issuer ID (App Store Connect → Users and Access → Integrations) |
| `ASC_KEY_P8_BASE64` | il file `.p8` codificato base64 (`base64 -w0 AuthKey_XXX.p8`) |
| `APPLE_TEAM_ID` | Team ID dell'Apple Developer Program |

Prerequisito una tantum lato Apple: l'App ID `com.oleventechnologies.iiprivatemessenger` deve
esistere su App Store Connect (la firma "development" con `-allowProvisioningUpdates` crea il
profilo automaticamente).

### Android (opzionali)
| Secret | Cos'è |
|---|---|
| `GOOGLE_SERVICES_JSON` | `google-services.json` Firebase in base64 (serve solo per le push) |
| `ANDROID_KEYSTORE_BASE64` | keystore di firma in base64 (solo per l'APK *release*) |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | password/alias keystore |

> L'APK **debug** non richiede alcun secret ed è già installabile (self-signed) — è il primo deliverable.

## Come ottenere gli artefatti
1. Imposta i secret sopra (almeno quelli iOS per l'IPA).
2. Actions → **Android APK** / **iOS IPA** → *Run workflow*.
3. A fine run scarica l'artefatto (`*.apk` / `*.ipa`) dalla pagina della run, oppure:
   `gh run download <run-id> -n ii-private-messenger-android-debug`

## Aspettativa ONESTA
- **Android debug**: è il path più probabile a verde. Possibili intoppi: vision-camera (minSdk 26, già impostato), Firebase (disattivato se manca il json), qualche dep nativa.
- **iOS**: il progetto `ios/` non esiste e viene generato in CI — le **prime run falliranno** (signing, provisioning, codice nativo NEPacketTunnelProvider non ancora scritto). Va **iterato** leggendo i log della CI. L'Anti-Censorship (sing-box) su iOS non è ancora implementato: l'app builda ma quel tunnel resta inattivo finché non si aggiunge il PacketTunnelProvider.
- L'**Anti-Censorship Android** richiede `libbox.aar` (sing-box) in `mobile/android/app/libs/`: senza, l'app builda e funziona (messaggi/gruppi/chiamate) ma il tunnel resta no-op.
