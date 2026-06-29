#!/usr/bin/env bash
# Builda Libbox.xcframework da sing-box a versione pinnata usando il builder UFFICIALE
# di sing-box (cmd/internal/build_libbox) + il fork sagernet/gomobile.
# Gira sul runner macOS in CI. Output: <repo>/mobile/ios-libbox/Libbox.xcframework
set -euo pipefail

SINGBOX_VERSION="${SINGBOX_VERSION:-v1.11.1}"
WORK="$(mktemp -d)"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/mobile/ios-libbox"
mkdir -p "$OUT_DIR"

echo "==> Building Libbox $SINGBOX_VERSION (official build_libbox)"
git clone --depth 1 --branch "$SINGBOX_VERSION" https://github.com/SagerNet/sing-box.git "$WORK/sing-box"
cd "$WORK/sing-box"

# sing-box usa il suo fork di gomobile; installo la toolchain che si aspetta.
go install -v github.com/sagernet/gomobile/cmd/gomobile@v0.1.6 \
  || go install -v github.com/sagernet/gomobile/cmd/gomobile@latest
go install -v github.com/sagernet/gomobile/cmd/gobind@v0.1.6 \
  || go install -v github.com/sagernet/gomobile/cmd/gobind@latest
export PATH="$PATH:$(go env GOPATH)/bin"
gomobile init || true

# Il builder ufficiale produce l'xcframework Apple multi-slice (ios + simulator).
go run ./cmd/internal/build_libbox -target apple

XC="$(find . -maxdepth 3 -name 'Libbox.xcframework' -type d | head -1)"
if [ -z "$XC" ]; then
  echo "ERROR: Libbox.xcframework non prodotto" >&2
  exit 1
fi

rm -rf "$OUT_DIR/Libbox.xcframework"
cp -R "$XC" "$OUT_DIR/Libbox.xcframework"
echo "==> Libbox.xcframework copiato in $OUT_DIR"

# --- Rendi App-Store compliant la slice iOS -----------------------------------
# gomobile emette un framework "deep" stile macOS (Versions/A, Resources/) anche per
# la slice iOS; i framework iOS device devono essere FLAT con un Info.plist valido.
PB=/usr/libexec/PlistBuddy
flatten_ios_framework() {
  local fw="$1"
  [ -d "$fw/Versions" ] || { echo "   (già flat: $fw)"; return 0; }
  echo "   flattening $fw"
  local tmp; tmp="$(mktemp -d)"
  cp -aL "$fw/Versions/A/." "$tmp/"
  rm -rf "$fw"; mkdir -p "$fw"
  cp -a "$tmp/Libbox" "$fw/Libbox"
  [ -d "$tmp/Headers" ] && cp -a "$tmp/Headers" "$fw/Headers"
  [ -d "$tmp/Modules" ] && cp -a "$tmp/Modules" "$fw/Modules"
  cp -a "$tmp/Resources/Info.plist" "$fw/Info.plist"
  rm -rf "$tmp"
}
patch_ios_plist() {
  local plist="$1"
  set_kv() { $PB -c "Set :$1 $2" "$plist" 2>/dev/null || $PB -c "Add :$1 $3 $2" "$plist"; }
  set_kv CFBundleIdentifier        com.oleventechnologies.iiprivatemessenger.Libbox   string
  set_kv CFBundleExecutable        Libbox                     string
  set_kv CFBundleName              Libbox                     string
  set_kv CFBundleShortVersionString 1.0                       string
  set_kv CFBundleVersion           1                          string
  set_kv MinimumOSVersion          16.0                       string
  set_kv CFBundlePackageType       FMWK                       string
  $PB -c "Delete :CFBundleSupportedPlatforms" "$plist" 2>/dev/null || true
  $PB -c "Add :CFBundleSupportedPlatforms array" "$plist" 2>/dev/null || true
  $PB -c "Add :CFBundleSupportedPlatforms:0 string iPhoneOS" "$plist" 2>/dev/null || true
}

IOS_FW="$OUT_DIR/Libbox.xcframework/ios-arm64/Libbox.framework"
flatten_ios_framework "$IOS_FW"
patch_ios_plist "$IOS_FW/Info.plist"

echo "==> Slice iOS finale:"
find "$IOS_FW" -maxdepth 2 | sort
