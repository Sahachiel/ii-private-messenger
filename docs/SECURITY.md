# Security Model

## Threat model

**Adversaries considered:**

1. Network observer (ISP, transit provider, nation-state with passive tap)
2. Compromised regional relay (one of ru/ge/fi fully owned by adversary)
3. Device theft — short window before remote wipe
4. Malicious contact attempting to impersonate a peer

**Out of scope:**

- Compromised user OS (rooted / jailbroken device with keylogger)
- Nation-state with ability to push a malicious app update (mitigated by
  reproducible builds — future work)

## Cryptography

- **E2EE**: Signal Protocol (X3DH + Double Ratchet). Keys live in MMKV
  (encrypted) on device, never in plaintext on disk.
- **Transport**: TLS 1.2+ only; HSTS preload; modern ECDHE ciphers.
- **WebRTC**: DTLS-SRTP mandatory. TURN credentials are short-lived (per call)
  derived from Coturn shared secret.

## What the server sees

| Data | Server access |
|------|---------------|
| Username, country | ✅ |
| Public prekey bundles | ✅ (needed for initial session) |
| Message ciphertext + timing + sender/recipient IDs | ✅ (relay routing) |
| Message plaintext | ❌ never |
| Voice/video media | ❌ (peer-to-peer via WebRTC + TURN relay of *encrypted* DTLS) |

Metadata minimization: the relay keeps envelopes in Redis only until delivered
+ 48 h fallback. No long-term message log on server.

## Auth

- Passwords: Argon2id (backend)
- Access token: JWT HS256, 15 min
- Refresh token: opaque, 30 days, rotating; stored hashed
- Rate limiting: per-IP on `/auth/*` (tighter) and per-user on write routes

## Incident response

- All regions have independent encrypted backups → a compromised region can
  be rebuilt without trusting its disks
- Key rotation triggers: detected compromise → force global prekey/signed-prekey
  rotation within 24 h via in-app push

## Disclosure

Report vulnerabilities to `security@oleven-group.com` (PGP key in repo root,
TBD). We respond within 72 h and credit researchers in release notes.
