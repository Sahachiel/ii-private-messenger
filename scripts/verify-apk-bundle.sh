#!/usr/bin/env bash
# Verifica che il codice JS eseguito da un APK corrisponda a un altro (es. il tuo build vs il
# riferimento). Estrae index.android.bundle da ciascun APK e ne confronta lo SHA-256.
# Uso: verify-apk-bundle.sh <apk-A> <apk-B>
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Uso: $0 <apk-A> <apk-B>" >&2
  exit 2
fi

hash_bundle() {
  local apk="$1"
  local tmp; tmp="$(mktemp -d)"
  # gli APK sono zip: estrai il bundle JS
  unzip -o -q "$apk" 'assets/index.android.bundle' -d "$tmp" 2>/dev/null || {
    echo "  (bundle non trovato in $apk)" >&2; rm -rf "$tmp"; return 1;
  }
  sha256sum "$tmp/assets/index.android.bundle" | awk '{print $1}'
  rm -rf "$tmp"
}

echo "APK A: $1"
HA="$(hash_bundle "$1")"; echo "  bundle SHA-256: $HA"
echo "APK B: $2"
HB="$(hash_bundle "$2")"; echo "  bundle SHA-256: $HB"
echo ""
if [ "$HA" = "$HB" ]; then
  echo "OK: il codice JS dei due APK e' IDENTICO (bundle uguale bit-per-bit)."
  exit 0
else
  echo "DIVERSO: i bundle JS non coincidono. Le build non provengono dallo stesso sorgente/toolchain."
  exit 1
fi
