# II Private Messenger

**OLEVEN Technologies XSEC** — end-to-end encrypted messaging with multi-region routing.

> *Private. Encrypted. Sovereign.*

## Download v0.2.0 (ultimo rebuild 2026-04-16)

| Piattaforma | Link | Dimensione |
|---|---|---|
| **Android APK** | [iimsg-v0.2.0.apk](https://oleven-group.com/iimsg/iimsg-v0.2.0.apk) | 326 MB |
| **Windows Setup** | [iimsg-desktop-v0.2.0.exe](https://oleven-group.com/iimsg/iimsg-desktop-v0.2.0.exe) | 78 MB |
| Landing page | https://oleven-group.com/iimsg/ | — |

> Android: prima di installare, **disinstalla** qualsiasi versione precedente (signature mismatch blocca l'update in-place).
> Windows: SmartScreen → "Esegui comunque" (installer unsigned).

**Build corrente:** React Native 0.73.9 · React 18.2 · Android debug-signed · SSL pinning con 6 cert (3 leaf + 2 LE intermediate + ISRG root) caricati da `assets/*.cer`.

## Monorepo

```
backend/   Node.js API (Postgres + Redis, JWT, Signal key directory)
relay/     Node.js WebSocket relay (per-region, + Coturn co-located)
mobile/    React Native 0.73 client (iOS + Android, Signal Protocol + WebRTC)
infra/     docker-compose (4 stacks), nginx template, Coturn template, WireGuard templates, bootstrap scripts
docs/      ARCHITECTURE.md · DEPLOYMENT.md · SECURITY.md · API.md
```

## Quickstart — local dev

```bash
# backend
cd backend && cp .env.example .env && npm install && npm run dev
# relay (separate terminal)
cd relay && cp .env.example .env && npm install && npm run dev
# mobile
cd mobile && npm install
npx react-native run-android   # or run-ios
```

Requires: Node ≥ 18, Docker, Android Studio / Xcode.

## One-command VPS deploy (production)

Per regional VPS (Ubuntu 24.04):

```bash
git clone <repo> /opt/ii-private-messenger/current
cd /opt/ii-private-messenger/current/infra/scripts
sudo ./setup-vps.sh
sudo ./deploy-relay.sh ge relay-ge.iiprivatemessenger.app turn-ge.iiprivatemessenger.app
```

Backend core:

```bash
sudo ./deploy-backend.sh api.iiprivatemessenger.app
```

WireGuard keypairs for the 4-node mesh:

```bash
./generate-wireguard-keys.sh
```

## Security

- **E2EE:** Signal Protocol (X3DH + Double Ratchet) via `@signalapp/libsignal-client`
- **Keys:** identity in OS keychain (biometric-gated), sessions in encrypted MMKV
- **Transport:** TLS 1.2+ enforced, certificate pinning on the mobile client (`react-native-ssl-pinning`)
- **Screen protection:** screenshots blocked by default (`react-native-screen-capture-protect`)
- **Account lockout:** 10 failed logins → 15-minute lockout (Redis-backed)
- **Message expiry:** self-destruct timer + `DELETE /api/messages/:id`
- **Key rotation:** signed prekey every 90 d; one-time prekeys replenished when pool < 10

See `docs/SECURITY.md` for the full threat model.

## Regional routing

| Region | Scope | Typical VPS |
|--------|-------|-------------|
| `ru` | Russia only | Selectel / Njalla |
| `ge` | Qatar + GCC + MENA + Caucasus + CIS + default | Contabo / UFO |
| `fi` | EU + Americas + APAC | Hetzner |

Country → region mapping lives in `mobile/src/utils/countries.ts` and
`backend/src/utils/region.ts` (they are kept in sync).

## Branding

- Primary `#0A0E1A`, accent `#00E5FF`, alert `#FF3D57`
- Bundle: `com.oleventechnologies.iiprivatemessenger`
- Icons: copied from `C:\II Private Messenger\icons\` into `mobile/src/assets/icons/`

---

© OLEVEN Technologies XSEC
