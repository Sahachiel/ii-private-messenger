# Backend API

Base URL: `https://<region>.iiprivatemessenger.app`
Auth: `Authorization: Bearer <accessToken>` unless noted.

## Auth

### POST `/auth/register`
```json
{
  "username": "...", "password": "...", "country": "QA",
  "identityKey": "b64", "registrationId": 12345,
  "signedPreKey": { "id": 1, "pub": "b64", "signature": "b64" },
  "preKeys": [{ "id": 1, "pub": "b64" }, ...]
}
```
→ `{ user, accessToken, refreshToken, region, relayUrl }`

### POST `/auth/login`
`{ username, password }` → `{ user, accessToken, refreshToken }`

### POST `/auth/refresh`
`{ refreshToken }` → `{ accessToken, refreshToken }`

### POST `/auth/logout`
Revokes the current refresh token.

## Users

- `GET /users/search?q=<prefix>` → `Contact[]`
- `GET /users/:id/keys` → `{ identityKey, signedPreKey, preKey }` (one-time prekey consumed)
- `PATCH /users/me` — `{ displayName?, avatarUrl? }`
- `POST /users/me/prekeys/replenish` — `{ preKeys: [{id, pub}] }`

## Contacts

- `GET /contacts` → `Contact[]`
- `POST /contacts` — `{ userId }`
- `DELETE /contacts/:id`
- `POST /contacts/:id/block` | `POST /contacts/:id/unblock`

## Region

- `GET /region/my-node` → `{ region, relayUrl }`

## Relay (WebSocket)

Connect to `relayUrl` (e.g. `wss://ge.iiprivatemessenger.app/ws`).

### Client → server
```jsonc
{ "type": "hello",   "userId": "...", "token": "<access>" }
{ "type": "envelope", "to": "<uid>", "from": "<uid>", "ciphertext": "b64", "msgType": 1, "ts": 1713200000 }
{ "type": "typing",  "to": "<uid>", "userId": "<self>" }
{ "type": "call.offer" | "call.answer" | "call.ice" | "call.end", "to": "<uid>", "from": "<uid>", "payload": {...} }
```

### Server → client
```jsonc
{ "type": "envelope", ... }                 // incoming message
{ "type": "ack",      "id": "<msgId>" }     // delivery confirmation
{ "type": "presence", "userId": "...", "online": true }
```

## Errors
```json
{ "error": "<code>", "message": "<human>" }
```
Common codes: `auth.invalid`, `auth.rate_limited`, `user.not_found`,
`contact.blocked`, `prekey.exhausted`.
