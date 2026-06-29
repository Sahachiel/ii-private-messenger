# II Private Messenger — Architecture

## Topology

```
                      ┌──────────────────────┐
                      │  Backend Core (HQ)   │
                      │  Postgres + Redis +  │
                      │  Express API (:3000) │
                      └──────────┬───────────┘
                                 │ WireGuard 10.77.0.0/24
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
  ┌─────▼────┐              ┌────▼─────┐            ┌────▼─────┐
  │ Relay RU │              │ Relay GE │            │ Relay FI │
  │  :8080   │              │  :8080   │            │  :8080   │
  │ Coturn   │              │ Coturn   │            │ Coturn   │
  └──────────┘              └──────────┘            └──────────┘
  ru.iiprivat…              ge.iiprivat…            fi.iiprivat…
```

## Components

| Component | Stack | Port | Purpose |
|-----------|-------|------|---------|
| Backend   | Node + Express + TS | 3000 | Auth, key directory, contacts, region routing |
| Relay     | Node + WS + Redis   | 8080 | E2EE envelope delivery, presence, call signaling |
| Postgres  | 16-alpine           | 5432 | Users, contacts, prekey bundles |
| Redis     | 7-alpine            | 6379 | Session cache, relay pub/sub, rate limits |
| Coturn    | system              | 3478/5349/49152-65535 | WebRTC TURN/STUN |
| Mobile    | React Native 0.73   | —    | iOS + Android client |

## E2EE

- Signal Protocol (`@signalapp/libsignal-client`) — X3DH + Double Ratchet
- Identity + prekey generation happens **only on device**
- Server stores only public prekey bundles; plaintext never touches backend
- Ciphertext is forwarded by relay; relay cannot decrypt

## Regional routing

Country → region mapping lives in `mobile/src/utils/countries.ts` AND
`backend/src/utils/region.ts`. Clients query `GET /region/my-node` at login
to discover the WebSocket URL for their region.

- `ru` → Russia only
- `ge` → Qatar, GCC, MENA, Caucasus, CIS, Turkey, default for that cluster
- `fi` → EU, North America, APAC, everything else

## Data at rest

- Mobile: MMKV encrypted with per-install key (Signal session state, tokens)
- Postgres: at-rest via VPS disk encryption (LUKS); sensitive columns (refresh
  tokens) are SHA-256 hashed
- Backups: encrypted with age, stored off-region from the node they came from

## Key rotation

- Signed prekey: rotated every 7 days, client auto-uploads
- One-time prekeys: replenished when pool < 20 (client pushes batch of 100)
- JWT access token: 15 min; refresh token: 30 days, rotating
