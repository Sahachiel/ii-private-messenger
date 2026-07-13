#!/usr/bin/env bash
# GUARD SOVRANITÀ — fallisce se lo scan QR reintroduce Google (MLKit / Play Services / vision-camera).
#
# Lo scan QR deve restare 100% JavaScript (react-native-image-picker → jpeg-js → jsQR): nessun
# SDK barcode nativo, nessun Google Play Services. Questo script va eseguito in CI PRIMA della build
# (vedi .github/workflows/android.yml) e può girare a mano: `bash scripts/verify-sovereign-scan.sh`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/mobile"
fail=0

echo "[guard] scan QR sovrano — nessun Google/MLKit/vision-camera"

# 1) Nessuna dipendenza vision-camera (tira sempre MLKit / play-services-mlkit-barcode-scanning).
if grep -q '"react-native-vision-camera"' "$MOBILE/package.json"; then
  echo "  ✗ react-native-vision-camera è tornato in package.json (tira MLKit/GMS). Rimuovilo."
  fail=1
fi

# 2) Nessun uso residuo delle API di scan native nel sorgente.
if grep -rnE "react-native-vision-camera|useCodeScanner|useCameraDevice|react-native-camera-kit" "$MOBILE/src" 2>/dev/null | grep -vE "//|/\*|\*" ; then
  echo "  ✗ trovato uso di uno scanner nativo (vision-camera/camera-kit) nel sorgente."
  fail=1
fi

# 3) Il path sovrano deve esistere (helper + dipendenze pure-JS).
[ -f "$MOBILE/src/utils/qrscan.ts" ] || { echo "  ✗ manca src/utils/qrscan.ts (path scan sovrano)"; fail=1; }
for dep in jsqr jpeg-js react-native-image-picker; do
  grep -q "\"$dep\"" "$MOBILE/package.json" || { echo "  ✗ manca la dipendenza $dep"; fail=1; }
done

if [ "$fail" -ne 0 ]; then
  echo "[guard] FALLITO: lo scan QR non è più sovrano."
  exit 1
fi
echo "[guard] OK: scan QR sovrano (image-picker + jpeg-js + jsQR, zero Google)."
