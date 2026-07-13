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

Nessun endpoint cloud USA hardcoded oltre a quelli sopra. Backend/relay/coturn sono già
self-hosted (VPS in giurisdizione scelta). STUN/TURN = coturn nostro.

## Fatto (questo commit)

- **Google STUN eliminato** da `mobile/src/services/webrtc.ts` e `desktop/renderer/call.js`.
  L'endpoint `stun:` è ora derivato dal `turns:` del nostro coturn (porta 3478): la scoperta
  dell'IP pubblico per le chiamate non passa più da Google.

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
