import { InteractionManager } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';
import jsQR from 'jsqr';

/**
 * Scansione QR SOVRANA — 100% JavaScript, ZERO Google.
 *
 * Pipeline: la fotocamera di SISTEMA scatta una foto (react-native-image-picker `launchCamera`,
 * intent nativo, nessun Google Play Services/MLKit) → `jpeg-js` decodifica il JPEG in pixel RGBA in
 * JS → `jsQR` (Apache-2.0) trova e decodifica il QR in JS. Tutto on-device, offline/air-gapped,
 * nessuna dipendenza runtime da Google, nessun SDK barcode nativo, nessuna rete/telemetria.
 *
 * TRADEOFF ONESTO: è uno scatto singolo "tocca → scatta → decodifica", NON un viewfinder live
 * continuo. In bare React Native (no Expo, senza vision-camera) non esiste una sorgente di frame
 * grezzi sovrana. Per questa app va bene: scansioniamo i NOSTRI QR puliti (ECL-M, alto contrasto) in
 * azioni deliberate una-tantum. Se in futuro serve la scansione live in stile WhatsApp, l'upgrade
 * sanzionato è un piccolo modulo nativo ZXing (Android) + AVFoundation (iOS) — sovrano anch'esso.
 */

// Cap prudente: una foto 1024×1024 → ~4 MB RGBA da decodificare in JS (evita jank/OOM su device deboli),
// più che sufficiente per risolvere un QR.
const MAX_DIM = 1024;

/** Ritorna la stringa decodificata dal QR, oppure null (annullato o nessun codice trovato). */
export async function scanQrViaPhoto(): Promise<string | null> {
  const r = await launchCamera({
    mediaType: 'photo',
    includeBase64: true,
    cameraType: 'back',
    maxWidth: MAX_DIM,
    maxHeight: MAX_DIM,
    quality: 0.9,
    saveToPhotos: false,
  });
  if (r.didCancel) return null;
  const b64 = r.assets?.[0]?.base64;
  if (!b64) return null;

  // La decodifica JPEG + jsQR è CPU-bound e sincrona: la eseguo dopo le interazioni per non bloccare
  // le animazioni/UI, e catturo qualunque errore (foto non-JPEG, corrotta, ecc.) → null.
  return new Promise<string | null>((resolve) => {
    InteractionManager.runAfterInteractions(() => {
      try {
        const buf = Buffer.from(b64, 'base64');
        const img = jpeg.decode(buf, { useTArray: true, maxResolutionInMP: 5 });
        const rgba = new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length);
        const res = jsQR(rgba, img.width, img.height);
        resolve(res?.data ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}
