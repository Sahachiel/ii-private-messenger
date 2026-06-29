# Sicurezza & isolamento — stato verifiche

Documento onesto su cosa è **dimostrato**, cosa va verificato in **integrazione** (serve ambiente attivo) e su cosa il sistema garantisce davvero.

## ✅ Invarianti crittografiche — verificate e riproducibili
Eseguibili con: `cd tests && npm install && npm test` → **13/13 pass**.

| Area | Invariante provata |
|---|---|
| Inviti | firma per-tipo (un invito non vale come capability), bind al destinatario, scadenza, anti-tamper |
| Capability relay | il relay ricostruisce la pubkey del backend (SPKI) e verifica; rifiuta firme di altre chiavi |
| Sender Keys | anti-spoof (nessun membro impersona un altro); **ISOLAMENTO: l'ex-membro dopo `epoch++` non decifra i messaggi nuovi** |
| Double Ratchet | bootstrap X3DH, DH-ratchet bidirezionale, recupero out-of-order, anti-tamper (forward secrecy) |

## 🔬 Test d'integrazione — da eseguire con backend + relay + Postgres/Redis attivi
Questi NON sono eseguibili senza ambiente; sono il gate "route-level" da spuntare in CI/staging:

1. `GET /api/groups/:id/members` → **404 uniforme** per un non-membro (no oracolo di esistenza).
2. `GET /api/users/search?q=` → restituisce **solo co-membri** del chiamante (mai utenti di altri gruppi).
3. `GET /api/users/:id/keys` → **404** se il target non condivide un gruppo col chiamante.
4. Relay: `send_message` **senza `gid`** → errore `gid_required`; con `gid` ma `cap` mancante/non valida → drop.
5. Kick → `epoch++`: la `cap` dell'ex-membro diventa stale → il relay risponde `epoch_stale` e **non consegna**; inoltre l'ex-membro non possiede la Sender Key della nuova epoch (vedi test 3 sopra).
6. Un membro del gruppo A **non riceve mai** un messaggio del gruppo B (consegna solo a membri attivi).

## Postura onesta (NIENTE over-claim)
- **Primitive**: X25519 (DH), Ed25519 (firme), SHA-512 (KDF/ratchet), XSalsa20-Poly1305 (AEAD). Moderne e solide.
- **Non si usa la dicitura "crittografia militare"**: non è una proprietà tecnica. Si dichiara con precisione: *E2EE con Double Ratchet (forward secrecy) per il pairwise e Sender Keys per i gruppi*.
- **Cosa il server NON vede**: i contenuti dei messaggi, il nome dei gruppi (resta cifrato, viaggia in `EnvelopeV2.gname`), i media (cifrati lato client).
- **Cosa il server PUÒ ancora vedere (metadati)**: l'appartenenza ai gruppi (UUID dei membri per gid) e quindi il grafo sociale, oltre a IP/orari. La chiusura di questi metadati (sealed-sender) è una fase opzionale **non ancora implementata** → finché non c'è, il sistema **non** è zero-knowledge sui metadati.
- **Residuo noto**: l'X3DH del pairwise è senza one-time-prekey (forward secrecy piena dal 2° messaggio in poi; il 1° ha protezione anti-replay inferiore). Upgrade possibile adottando `@signalapp/libsignal-client`.

## Verifica funzionale su device
Il client React Native va compilato e provato su telefono fisico (qui `mobile/` non ha `node_modules`): creazione gruppo → QR invito → scan → approvazione admin → messaggi (sender key) → chiamata 1:1 HQ → transport anti-censura attivo.
