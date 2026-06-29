#!/usr/bin/env bash
# Genera la cartella mobile/ios mancante da un progetto RN 0.73.9 temporaneo (SOLO su macOS).
# Il nome progetto = "IIPrivateMessenger" (come app.json) → lo scheme/target combaciano.
# Preserva mobile/ios se gia' presente. Imposta il bundle id OLEVEN.
set -euo pipefail

MOBILE_DIR="${1:-mobile}"
NAME="IIPrivateMessenger"
BUNDLE="com.oleventechnologies.iiprivatemessenger"
TMP="$(mktemp -d)"

if [ -d "$MOBILE_DIR/ios" ] && [ -f "$MOBILE_DIR/ios/$NAME.xcodeproj/project.pbxproj" ]; then
  echo "[bootstrap-ios] mobile/ios gia' presente — skip generazione."
else
  echo "[bootstrap-ios] genero progetto iOS temporaneo ($NAME, RN 0.73.9)…"
  npx @react-native-community/cli@13.6.9 init "$NAME" --version 0.73.9 --skip-install --directory "$TMP/$NAME" --pm npm
  mkdir -p "$MOBILE_DIR/ios"
  cp -R "$TMP/$NAME/ios/." "$MOBILE_DIR/ios/"
  echo "[bootstrap-ios] copiato $TMP/$NAME/ios → $MOBILE_DIR/ios"
fi

# Bundle identifier OLEVEN nel pbxproj — il template RN scrive il valore TRA VIRGOLETTE
# con una variabile: PRODUCT_BUNDLE_IDENTIFIER = "org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)";
# Quindi sostituiamo QUALSIASI valore (robusto a virgolette/variabili) per tutti i target.
PBX="$MOBILE_DIR/ios/$NAME.xcodeproj/project.pbxproj"
if [ -f "$PBX" ]; then
  sed -i.bak -E "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE;/g" "$PBX" || true
  rm -f "$PBX.bak"
  echo "[bootstrap-ios] bundle id impostato a $BUNDLE su tutti i target"
  grep -c "PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE;" "$PBX" | sed 's/^/[bootstrap-ios] occorrenze bundle id: /'
fi

# Rende lo scheme CONDIVISO (shared): senza, xcodebuild in CI non trova lo scheme.
SCHEME_SRC="$MOBILE_DIR/ios/$NAME.xcodeproj/xcuserdata"
SHARED_DIR="$MOBILE_DIR/ios/$NAME.xcodeproj/xcshareddata/xcschemes"
if [ ! -f "$SHARED_DIR/$NAME.xcscheme" ]; then
  mkdir -p "$SHARED_DIR"
  FOUND=$(find "$MOBILE_DIR/ios/$NAME.xcodeproj" -name "$NAME.xcscheme" 2>/dev/null | head -1)
  if [ -n "$FOUND" ]; then cp "$FOUND" "$SHARED_DIR/$NAME.xcscheme"; echo "[bootstrap-ios] scheme reso shared"; fi
fi

# Permessi privacy nell'Info.plist (camera, microfono per chiamate/foto/scanner QR)
PLIST="$MOBILE_DIR/ios/$NAME/Info.plist"
if [ -f "$PLIST" ] && ! grep -q "NSCameraUsageDescription" "$PLIST"; then
  /usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string 'Per scansionare i QR di invito e le videochiamate.'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string 'Per i messaggi vocali e le chiamate.'" "$PLIST" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Add :NSPhotoLibraryUsageDescription string 'Per allegare foto e video.'" "$PLIST" 2>/dev/null || true
fi

# Export compliance: senza questa chiave ogni build resta 'Missing Compliance' su TestFlight
# (richiederebbe un click manuale per ogni build). L'app usa solo cifratura standard (NaCl/Curve25519/AES)
# che rientra nell'esenzione. Blocco idempotente e SEPARATO (non sotto la guardia NS* sopra).
if [ -f "$PLIST" ] && ! /usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" "$PLIST" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$PLIST" 2>/dev/null || true
  echo "[bootstrap-ios] ITSAppUsesNonExemptEncryption=false aggiunto (no Missing Compliance)"
fi

# Icona app: il template RN genera un AppIcon VUOTO -> l'upload fallisce ('Missing required icon 120x120'
# + 'CFBundleIconName missing'). Copio il set completo committato (generato da ICONA 2, 1024px).
ICONSRC="$MOBILE_DIR/ios-assets/AppIcon.appiconset"
ICONDST="$MOBILE_DIR/ios/$NAME/Images.xcassets/AppIcon.appiconset"
if [ -d "$ICONSRC" ]; then
  mkdir -p "$ICONDST"
  rm -f "$ICONDST"/* 2>/dev/null || true
  cp "$ICONSRC"/* "$ICONDST"/
  echo "[bootstrap-ios] AppIcon popolato ($(ls "$ICONDST" | wc -l) file)"
else
  echo "[bootstrap-ios] ATTENZIONE: $ICONSRC mancante, AppIcon resta vuoto"
fi

# SSL pinning iOS: react-native-ssl-pinning su iOS pinna contro i .cer NEL BUNDLE
# (AFSecurityPolicy certificatesInBundle), IGNORANDO gli hash sha256 passati da JS (che valgono
# solo su Android). Senza .cer nel bundle il set pinnato e' VUOTO -> ogni HTTPS fallisce su iPhone.
# Copio i .cer della catena iimsg-api e li aggiungo alle risorse del target via xcodeproj.
CERTSRC="$MOBILE_DIR/ios-certs"
if [ -d "$CERTSRC" ] && ls "$CERTSRC"/*.cer >/dev/null 2>&1; then
  cp "$CERTSRC"/*.cer "$MOBILE_DIR/ios/" 2>/dev/null || true
  gem list -i xcodeproj >/dev/null 2>&1 || gem install xcodeproj --no-document >/dev/null 2>&1 || sudo gem install xcodeproj --no-document >/dev/null 2>&1 || true
  PROJDIR="$MOBILE_DIR/ios" PNAME="$NAME" ruby -e '
    require "xcodeproj"
    proj = Xcodeproj::Project.open(File.join(ENV["PROJDIR"], "#{ENV["PNAME"]}.xcodeproj"))
    target = proj.targets.find { |t| t.name == ENV["PNAME"] }
    group  = proj.main_group.find_subpath(ENV["PNAME"], true)
    existing = target.resources_build_phase.files.map { |f| f.file_ref && f.file_ref.path ? File.basename(f.file_ref.path.to_s) : nil }.compact
    Dir.glob(File.join(ENV["PROJDIR"], "*.cer")).sort.each do |cer|
      base = File.basename(cer)
      next if existing.include?(base)
      ref = group.new_file(base)   # solo basename relativo al gruppo IIPrivateMessenger
      target.add_resources([ref])
      puts "[bootstrap-ios] cert nel bundle iOS: #{base}"
    end
    proj.save
  ' || echo "[bootstrap-ios] ATTENZIONE: bundling .cer via xcodeproj fallito"
else
  echo "[bootstrap-ios] ATTENZIONE: nessun .cer in $CERTSRC -> pinning iOS non funzionera'"
fi

# Fix Firebase + librerie statiche: GoogleUtilities (e i pod Firebase) devono generare
# i module map per essere importati da Swift (FirebaseCoreInternal). Senza, pod install fallisce.
POD="$MOBILE_DIR/ios/Podfile"
if [ -f "$POD" ] && ! grep -q "modular_headers" "$POD"; then
  sed -i.bak "s/config = use_native_modules!/config = use_native_modules!\n  pod 'GoogleUtilities', :modular_headers => true\n  pod 'FirebaseCoreInternal', :modular_headers => true\n  pod 'FirebaseCore', :modular_headers => true\n  pod 'FirebaseInstallations', :modular_headers => true\n  pod 'FirebaseMessaging', :modular_headers => true\n  pod 'FirebaseCoreExtension', :modular_headers => true/" "$POD" || true
  rm -f "$POD.bak"
  echo "[bootstrap-ios] Podfile: aggiunti modular_headers per Firebase/GoogleUtilities"
fi

# Deployment target a iOS 16: Xcode 26 ha RIMOSSO le librerie di compatibilita' Swift
# (swiftCompatibility56 / swiftCompatibilityConcurrency). Il compilatore le richiede solo se il
# target e' < iOS 15/16. Alzandolo a 16.0 quei FORCE_LOAD non vengono emessi -> niente
# 'Undefined symbols ... swiftCompatibility56'. Va fatto su TUTTI i pod e sull'app.
if [ -f "$POD" ]; then
  sed -i.bak "s/platform :ios, min_ios_version_supported/platform :ios, '16.0'/" "$POD" || true
  if ! grep -q "IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'" "$POD"; then
    sed -i.bak "s/post_install do |installer|/post_install do |installer|\n    installer.pods_project.targets.each do |tt|\n      tt.build_configurations.each do |cc|\n        cc.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.0'\n      end\n    end/" "$POD" || true
  fi
  rm -f "$POD.bak"
  echo "[bootstrap-ios] Podfile: deployment target iOS 16.0 (fix swiftCompatibility su Xcode 26)"
fi
# App target nel pbxproj a 16.0
if [ -f "$PBX" ]; then
  sed -i.bak -E "s/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/IPHONEOS_DEPLOYMENT_TARGET = 16.0;/g" "$PBX" || true
  rm -f "$PBX.bak"
fi

# Tunnel anti-censura iOS: estensione NEPacketTunnelProvider + sing-box (Libbox).
# Copio sorgenti Swift + bridge ObjC + entitlements + Libbox.xcframework in ios/ e
# aggiungo il target app-extension via xcodeproj (scripts/add-tunnel-target.rb).
TUNSRC="$MOBILE_DIR/ios-tunnel"
APPSRC="$MOBILE_DIR/ios-app"
LIBBOX="$MOBILE_DIR/ios-libbox/Libbox.xcframework"
if [ -d "$TUNSRC" ] && [ -d "$LIBBOX" ]; then
  mkdir -p "$MOBILE_DIR/ios/PacketTunnel" "$MOBILE_DIR/ios/Libbox"
  cp "$TUNSRC/PacketTunnelProvider.swift" "$MOBILE_DIR/ios/PacketTunnel/"
  cp "$TUNSRC/PlatformInterface.swift"    "$MOBILE_DIR/ios/PacketTunnel/"
  cp "$TUNSRC/PacketTunnel-Info.plist"    "$MOBILE_DIR/ios/PacketTunnel/Info.plist"
  cp "$TUNSRC/PacketTunnel.entitlements"  "$MOBILE_DIR/ios/PacketTunnel/PacketTunnel.entitlements"
  cp "$APPSRC/AntiCensorship.m"           "$MOBILE_DIR/ios/AntiCensorship.m"
  cp "$APPSRC/IIPrivateMessenger.entitlements" "$MOBILE_DIR/ios/IIPrivateMessenger.entitlements"
  rm -rf "$MOBILE_DIR/ios/Libbox/Libbox.xcframework"
  cp -R "$LIBBOX" "$MOBILE_DIR/ios/Libbox/Libbox.xcframework"
  gem list -i xcodeproj >/dev/null 2>&1 || gem install xcodeproj --no-document >/dev/null 2>&1 || sudo gem install xcodeproj --no-document >/dev/null 2>&1 || true
  if ruby scripts/add-tunnel-target.rb "$MOBILE_DIR/ios" "$NAME"; then
    echo "[bootstrap-ios] target tunnel iOS aggiunto"
  else
    echo "[bootstrap-ios] ATTENZIONE: add-tunnel-target.rb fallito"
  fi
else
  echo "[bootstrap-ios] tunnel iOS saltato (manca $TUNSRC o $LIBBOX)"
fi

echo "[bootstrap-ios] completato. Ora: cd $MOBILE_DIR/ios && pod install"
