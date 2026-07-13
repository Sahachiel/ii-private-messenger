#!/usr/bin/env bash
# Genera il boilerplate Android mancante da template ufficiale RN 0.73.9 (dentro
# node_modules/react-native/template), preservando i file custom gia' presenti
# (transport/*.kt, res/mipmap, assets/*.cer). Idempotente: rigenera solo cio' che manca.
#
# Prerequisito: aver gia' fatto `npm ci` in mobile/ (serve node_modules/react-native/template).
set -euo pipefail

MOBILE_DIR="${1:-mobile}"
PKG="com.oleventechnologies.iiprivatemessenger"
PKG_PATH="com/oleventechnologies/iiprivatemessenger"
APP_NAME="II Private Messenger"
TEMPLATE="$MOBILE_DIR/node_modules/react-native/template/android"
ANDROID="$MOBILE_DIR/android"

[ -d "$TEMPLATE" ] || { echo "ERRORE: template RN non trovato ($TEMPLATE). Esegui prima 'npm ci' in $MOBILE_DIR."; exit 1; }

echo "[bootstrap] da template $TEMPLATE"

# 1) File Gradle/wrapper/root (copia se mancanti)
for f in settings.gradle build.gradle gradle.properties gradlew gradlew.bat gradle/wrapper/gradle-wrapper.properties gradle/wrapper/gradle-wrapper.jar; do
  if [ ! -f "$ANDROID/$f" ] && [ -f "$TEMPLATE/$f" ]; then
    mkdir -p "$ANDROID/$(dirname "$f")"; cp "$TEMPLATE/$f" "$ANDROID/$f"; echo "  + $f"
  fi
done
chmod +x "$ANDROID/gradlew" 2>/dev/null || true

# 2) app/build.gradle + proguard + debug.keystore
mkdir -p "$ANDROID/app"
for f in build.gradle proguard-rules.pro; do
  [ -f "$ANDROID/app/$f" ] || cp "$TEMPLATE/app/$f" "$ANDROID/app/$f" 2>/dev/null || true
done
mkdir -p "$ANDROID/app/src/debug"
[ -f "$TEMPLATE/app/debug.keystore" ] && cp "$TEMPLATE/app/debug.keystore" "$ANDROID/app/debug.keystore" 2>/dev/null || true

# 3) res values (strings/styles) + AndroidManifest (template) sotto il nostro package
mkdir -p "$ANDROID/app/src/main/res/values"
cp -n "$TEMPLATE/app/src/main/res/values/"* "$ANDROID/app/src/main/res/values/" 2>/dev/null || true
[ -d "$TEMPLATE/app/src/main/res/drawable" ] && cp -rn "$TEMPLATE/app/src/main/res/drawable" "$ANDROID/app/src/main/res/" 2>/dev/null || true
[ -d "$TEMPLATE/app/src/main/res/values-night" ] && cp -rn "$TEMPLATE/app/src/main/res/values-night" "$ANDROID/app/src/main/res/" 2>/dev/null || true

# 4) MainActivity/MainApplication: copia dal template e riposiziona sotto il nostro package
SRC_JAVA="$TEMPLATE/app/src/main/java/com/helloworld"
DST_JAVA="$ANDROID/app/src/main/java/$PKG_PATH"
mkdir -p "$DST_JAVA"
# Nome del componente RN da app.json: DEVE combaciare con AppRegistry.registerComponent(name) in
# index.js, altrimenti il release crasha subito con: Invariant Violation "HelloWorld" has not been
# registered (il template restituisce "HelloWorld" da getMainComponentName; in debug non si vede
# perche il JS non viene mai caricato senza Metro, in release invece esplode allo startup).
RN_NAME=$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' "$MOBILE_DIR/app.json" | head -1 | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/')
[ -z "$RN_NAME" ] && RN_NAME="IIPrivateMessenger"
for f in MainActivity.kt MainApplication.kt; do
  if [ ! -f "$DST_JAVA/$f" ] && [ -f "$SRC_JAVA/$f" ]; then
    sed "s/com\.helloworld/$PKG/g; s/\"HelloWorld\"/\"$RN_NAME\"/g" "$SRC_JAVA/$f" > "$DST_JAVA/$f"; echo "  + java/$PKG_PATH/$f (componente RN: $RN_NAME)"
  fi
done

# 5) strings.xml: app name corretto
STR="$ANDROID/app/src/main/res/values/strings.xml"
if [ -f "$STR" ]; then
  sed -i "s|<string name=\"app_name\">[^<]*</string>|<string name=\"app_name\">$APP_NAME</string>|" "$STR" || true
fi

# 6) applicationId + namespace nel app/build.gradle
APPGRADLE="$ANDROID/app/build.gradle"
if [ -f "$APPGRADLE" ]; then
  sed -i "s/applicationId \"com.helloworld\"/applicationId \"$PKG\"/" "$APPGRADLE" || true
  sed -i "s/namespace \"com.helloworld\"/namespace \"$PKG\"/" "$APPGRADLE" || true
  # vision-camera richiede minSdk 26
  sed -i "s/minSdkVersion rootProject.ext.minSdkVersion/minSdkVersion 26/" "$APPGRADLE" || true
fi
# minSdk anche nel root build.gradle ext
ROOTGRADLE="$ANDROID/build.gradle"
[ -f "$ROOTGRADLE" ] && sed -i "s/minSdkVersion = 2[0-9]/minSdkVersion = 26/" "$ROOTGRADLE" || true

# Fix "android:attr/lStar not found" nella verifica risorse del RELEASE: alcune lib RN vecchie
# (es. react-native-ssl-pinning) hanno compileSdkVersion < 31 hardcoded → il release (che fa
# verifyReleaseResources, il debug no) fallisce. Bumpo a 34 le lib con compileSdk 20-30.
NM="$MOBILE_DIR/node_modules"
if [ -d "$NM" ]; then
  find "$NM" -path '*/android/build.gradle' -exec sed -i -E 's/compileSdkVersion (2[0-9]|30)([^0-9]|$)/compileSdkVersion 34\2/g' {} + 2>/dev/null || true
  echo "  ~ node_modules: compileSdkVersion delle lib vecchie forzato a 34 (fix lStar release)"
fi

# Rimuove il repo Sonatype OSS DISMESSO (oss.sonatype.org -> HTTP 504) che il plugin gradle di RN
# aggiunge per le nightly. react-android/infer-annotation sono su Maven Central: senza questa rimozione
# il 504 di Sonatype fa fallire la dependency resolution (regressione infra, non del codice).
if [ -f "$ROOTGRADLE" ] && ! grep -q "oss.sonatype.org" "$ROOTGRADLE"; then
  cat >> "$ROOTGRADLE" <<'GRADLE'

allprojects {
    repositories {
        all { repo ->
            if ((repo instanceof org.gradle.api.artifacts.repositories.MavenArtifactRepository)
                && repo.url.toString().contains('oss.sonatype.org')) {
                remove repo
            }
        }
    }
}
GRADLE
  echo "  ~ build.gradle: rimosso repo Sonatype OSS dismesso (fix 504)"
fi

# 7) Inietta AntiCensorshipPackage nel MainApplication (registrazione del modulo nativo)
MAINAPP="$DST_JAVA/MainApplication.kt"
if [ -f "$MAINAPP" ] && ! grep -q "AntiCensorshipPackage" "$MAINAPP"; then
  # aggiungi l'import
  sed -i "s|^package $PKG|package $PKG\n\nimport $PKG.transport.AntiCensorshipPackage|" "$MAINAPP" || true
  # aggiungi add(AntiCensorshipPackage()) dopo PackageList(this).packages
  sed -i "s|PackageList(this).packages|PackageList(this).packages.apply { add(AntiCensorshipPackage()) }|" "$MAINAPP" || true
  echo "  ~ MainApplication: registrato AntiCensorshipPackage"
fi

# 7b) Inietta ScreenSecurityPackage nel MainApplication (anti-screenshot FLAG_SECURE runtime)
if [ -f "$MAINAPP" ] && ! grep -q "ScreenSecurityPackage" "$MAINAPP"; then
  sed -i "s|^package $PKG|package $PKG\n\nimport $PKG.security.ScreenSecurityPackage|" "$MAINAPP" || true
  # accoda al blocco .apply { ... } se già presente, altrimenti crealo
  if grep -q "add(AntiCensorshipPackage())" "$MAINAPP"; then
    sed -i "s|add(AntiCensorshipPackage())|add(AntiCensorshipPackage()); add(ScreenSecurityPackage())|" "$MAINAPP" || true
  else
    sed -i "s|PackageList(this).packages|PackageList(this).packages.apply { add(ScreenSecurityPackage()) }|" "$MAINAPP" || true
  fi
  echo "  ~ MainApplication: registrato ScreenSecurityPackage"
fi

# 8) AndroidManifest: usa il template e aggiungi permessi + VpnService
MAN="$ANDROID/app/src/main/AndroidManifest.xml"
[ -f "$MAN" ] || cp "$TEMPLATE/app/src/main/AndroidManifest.xml" "$MAN"
if ! grep -q "BIND_VPN_SERVICE" "$MAN"; then
  # permessi prima di <application>
  sed -i 's|<application|<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.CAMERA"/>\n    <uses-permission android:name="android.permission.RECORD_AUDIO"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>\n    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE"/>\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>\n    <application|' "$MAN" || true
  # servizio VpnService prima di </application>
  sed -i 's|</application>|  <service android:name=".transport.Re4lityVpnService" android:permission="android.permission.BIND_VPN_SERVICE" android:foregroundServiceType="specialUse" android:exported="false"><intent-filter><action android:name="android.net.VpnService"/></intent-filter></service>\n  </application>|' "$MAN" || true
  echo "  ~ AndroidManifest: permessi + Re4lityVpnService"
fi

# 8a) Permesso per l'enumerazione pacchetti (detector app-blocklist reale, Android 11+)
if ! grep -q "QUERY_ALL_PACKAGES" "$MAN"; then
  sed -i 's|<uses-permission android:name="android.permission.INTERNET"/>|<uses-permission android:name="android.permission.INTERNET"/>\n    <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES"/>|' "$MAN" || true
  echo "  ~ AndroidManifest: QUERY_ALL_PACKAGES"
fi

# 8a-bis) SOVRANITÀ: rimuove i permessi Google iniettati da manifest transitivi (FCM/C2DM +
# Play install-referrer) via manifest-merger. Serve il namespace tools.
if ! grep -q 'xmlns:tools' "$MAN"; then
  sed -i 's|<manifest xmlns:android="http://schemas.android.com/apk/res/android"|<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools"|' "$MAN" || true
fi
if ! grep -q 'c2dm.permission.RECEIVE' "$MAN"; then
  sed -i 's|<application|<uses-permission android:name="com.google.android.c2dm.permission.RECEIVE" tools:node="remove"/>\n    <uses-permission android:name="com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE" tools:node="remove"/>\n    <application|' "$MAN" || true
  echo "  ~ AndroidManifest: rimossi permessi Google (sovranità)"
fi

# 8b) Deep link iimsg://join?t=<token> — intent-filter VIEW sul MainActivity (link invito reale)
if ! grep -q 'android:scheme="iimsg"' "$MAN"; then
  sed -i 's|<category android:name="android.intent.category.LAUNCHER" />|<category android:name="android.intent.category.LAUNCHER" />\n        </intent-filter>\n        <intent-filter>\n            <action android:name="android.intent.action.VIEW" />\n            <category android:name="android.intent.category.DEFAULT" />\n            <category android:name="android.intent.category.BROWSABLE" />\n            <data android:scheme="iimsg" />|' "$MAN" || true
  echo "  ~ AndroidManifest: deep link iimsg://"
fi

# 9) Firebase google-services: applica il plugin SOLO se il file esiste (build non bloccata senza)
if [ -f "$ANDROID/app/google-services.json" ] && ! grep -q "google-services" "$APPGRADLE"; then
  echo 'apply plugin: "com.google.gms.google-services"' >> "$APPGRADLE"
  echo "  ~ Firebase google-services plugin applicato"
else
  echo "  i google-services.json assente: push Firebase disattivato (build comunque OK)"
fi

echo "[bootstrap] completato. Ora: cd $MOBILE_DIR/android && ./gradlew assembleDebug"
