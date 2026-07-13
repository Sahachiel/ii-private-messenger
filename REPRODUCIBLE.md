# Build riproducibili e verificabilità

Per un messenger sovrano, "fidati" non basta: chiunque deve poter verificare che il binario che
esegue corrisponda al codice sorgente pubblico — nessuna backdoor nascosta nella build.

## Toolchain esatta (Android)

Ricostruisci sempre con QUESTE versioni; cambiarle cambia il binario.

| Componente | Versione |
|---|---|
| JDK | Temurin (Eclipse) **17.0.19+10** (`buglab-tools/jdk17`) |
| Gradle | **8.3** (wrapper `gradle-8.3-all`) |
| Android compileSdk / targetSdk | **34** |
| buildToolsVersion | **34.0.0** |
| ndkVersion | **25.1.8937393** |
| JS engine | **Hermes** (bytecode deterministico dal bundle) |
| ABI | armeabi-v7a, arm64-v8a, x86, x86_64 |

## Passi build

```bash
cd mobile
npm ci                                   # dipendenze bloccate da package-lock.json
bash ../scripts/bootstrap-android.sh     # genera il progetto android (idempotente)
cd android
JAVA_HOME=<Temurin-17> ./gradlew assembleRelease --no-daemon
# output: app/build/outputs/apk/release/app-release.apk
```

## Verifica "il binario = il codice" (parte JS, la più verificabile)

Il **90%+ della logica** (E2EE, post-quantum, protocollo, UI) è JavaScript, impacchettato in
`index.android.bundle` dentro l'APK. È la parte che conta di più e la più facile da verificare:
chi ricostruisce dallo stesso sorgente deve ottenere lo **stesso hash del bundle**.

```bash
bash scripts/verify-apk-bundle.sh <apk-di-riferimento> <apk-che-hai-costruito>
# confronta lo SHA-256 di index.android.bundle nei due APK
```

Se gli hash coincidono, il codice JS eseguito è ESATTAMENTE quello del sorgente.

## Onestà sui limiti

- **Firma**: la release usa la firma di debug (sideload), che varia per macchina → l'APK firmato
  NON è bit-per-bit identico. La verifica va fatta sull'APK **non firmato** o sui suoi contenuti
  (bundle JS, `classes*.dex`, `lib/*/*.so`), non sull'archivio firmato.
- **Parte nativa (NDK)**: la piena riproducibilità bit-per-bit del codice C/C++ (Hermes, tweetnacl,
  librerie native) dipende dal determinismo di NDK/toolchain e da timestamp negli archivi: è
  ottenibile ma richiede un ambiente pinnato (stesso NDK, `SOURCE_DATE_EPOCH`, zip senza timestamp).
  Traguardo dichiarato, non ancora garantito bit-per-bit qui.
- **Meta**: la strada completa è open-source del repo + build pubblica riproducibile + firma
  trasparente (binary transparency). Questo file è il primo passo: toolchain pinnata + verifica del
  bundle JS.

## Desktop (Electron)

`cd desktop && npm ci && npm run build:win` — l'installer NSIS non è deterministico (timestamp),
ma il codice caricato (`dist/**`, `renderer/**`) è ispezionabile e confrontabile col sorgente.
