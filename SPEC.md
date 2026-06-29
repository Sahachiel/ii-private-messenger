
# II Private Messenger — Full Specification

Brand: OLEVEN Technologies XSEC. App "II Private Messenger", bundle `com.oleventechnologies.iiprivatemessenger`.
Colors: #0A0E1A bg, #00E5FF accent, #FF3D57 alert. Dark theme only, sharp corners, military aesthetic.
Icons: `mobile/src/assets/icons/ICONA 1.png` (primary logo), `ICONA 2.png` (secondary). Use these everywhere a logo is needed — do NOT generate placeholder SVGs.

## Architecture
- Backend core (Node.js + Express + TS + Postgres + Redis): auth, user registry, key bundles, FCM push, region assignment. Port 3000.
- Relay microservice (Node.js + WS + Redis) runs per region: `ru` (Moscow/Selectel), `ge` (Tbilisi/Contabo), `fi` (Helsinki/Hetzner). Port 8080.
- Coturn on each regional VPS (ports 3478/5349).
- Mobile: React Native 0.73, iOS + Android.
- WireGuard tunnels backend ↔ each relay for internal lookups.

## Region routing
- `ru`: RU only
- `ge`: QA, AE, SA, KW, BH, OM, YE, IQ, IR, SY, TR, EG, LY, TN, DZ, MA, LB, JO, IL, PK, AF, UZ, TM, KG, TJ, AZ, AM, GE + default for unlisted
- `fi`: DE, FR, GB, IT, ES, NL, BE, SE, NO, DK, FI, PL, CZ, AT, CH, PT, IE, GR, HR, RO, BG, SK, SI, LT, LV, EE, HU, LU, MT, CY, US, CA, AU, NZ, JP, KR, SG, HK, TW, BR, MX, AR, ZA, NG, KE, GH, IN, CN

## DB schema (Postgres) — tables
- users(id UUID PK, username UNIQUE, phone UNIQUE, display_name, avatar_url, country_code CHAR(2), region VARCHAR(8), password_hash, identity_public_key, signed_prekey TEXT, registration_id INT, fcm_token, last_seen, is_active, created_at)
- one_time_prekeys(id SERIAL PK, user_id FK, key_id INT, public_key, used BOOL, created_at)
- conversations(id UUID PK, is_group BOOL, group_name, group_avatar_url, created_by FK, created_at)
- conversation_members(conversation_id FK, user_id FK, joined_at, is_admin, PK(conv,user))
- messages(id UUID PK, conversation_id FK, sender_id FK, message_type, ciphertext, recipient_count, sent_at, delivered_at, read_at, expires_at)
- contacts(user_id FK, contact_id FK, nickname, is_blocked, added_at, PK(user,contact))
- call_logs(id UUID PK, caller_id, callee_id, call_type, status, started_at, ended_at, duration_seconds, turn_region)

## Backend API
- POST /api/auth/register — zod validate, bcrypt 12, compute region, store + one_time_prekeys → `{user_id,username,region,relay_url,turn_url,access_token,refresh_token}`
- POST /api/auth/login — bcrypt verify, update last_seen → tokens + relay/turn config
- POST /api/auth/refresh — Redis refresh 30d, access 15m
- POST /api/auth/verify-token — internal (used by relay)
- GET /api/users/search?q=
- GET /api/users/:id/keys — Signal bundle { identity_public_key, signed_prekey, one_time_prekey } (marks OTP as used)
- GET /api/users/:id/region — internal (for cross-region relay)
- GET /api/region/my-node
- Contacts: GET/POST/DELETE /api/contacts, POST /api/contacts/:id/block
- All responses: `{success, data, error?}`. JWT auth middleware. Rate limit auth 10/min, others 100/min.

## Relay
- WSS connect → client sends `{type:'auth',token}` → relay calls backend verify-token → register userId↔socket in Redis presence (TTL)
- Offline queue per user: Redis list, max 500, 7-day TTL
- Cross-region: if recipient in different region, POST /internal/relay on target relay with shared `INTER_NODE_SECRET` header
- Messages in PART 5 of original spec (send_message, call_offer/answer, ice_candidate, call_end, typing_start/stop, read_receipt, ping) and events (message, delivery_receipt, read_receipt, presence, pong, etc.)

## Mobile screens (all dark, sharp corners, cyan accents)
- OnboardingScreen: logo (ICONA 1.png), tagline "Private. Encrypted. Sovereign.", CountryPicker, "Get Started"
- RegisterScreen: username(3-32), display_name, phone optional E.164, password+strength+confirm, country; generate Signal bundle + register; show assigned region
- LoginScreen: username+password, biometric if keychain creds, re-init Signal from keychain
- HomeScreen: logo left, avatar right, status dot, conversation list, FAB new chat, long-press archive/delete/mute
- ChatScreen: avatar+name+online+call icons; MessageBubble (sent right cyan 15%, recv left dark card, ticks for sent/delivered/read); input bar multiline + attach + hold-to-record mic + send; "End-to-end encrypted"; typing dots
- CallScreen (voice): avatar pulse, status, timer HH:MM:SS, region badge "Routed via 🇬🇪 Georgia — Encrypted", mute/speaker/end(red)/add, DTMF via keypad icon
- VideoCallScreen: remote video fullscreen, local floating top-right draggable, fade controls, quality bar
- ContactsScreen, ProfileScreen, SettingsScreen (security code 60 digits, 2FA, auto-lock, screen security, notifications, storage, about with region + pubkey fingerprint + "Powered by OLEVEN Technologies XSEC")

## Components
MessageBubble, ConversationItem, CallControls, Avatar, StatusBadge, CountryPicker

## Services (mobile)
- api.ts (axios + SSL pinning for api.iiprivatemessenger.app)
- socket.ts (WS to regional relay, reconnect, event emitter)
- webrtc.ts (class WebRTCService per spec; HMAC-SHA1 TURN creds RFC 5766)
- signal.ts (class SignalService using @signalapp/libsignal-client — full X3DH)
- keychain.ts (react-native-keychain AFTER_FIRST_UNLOCK + biometric)
- notifications.ts (@notifee + firebase messaging)

## Redux (toolkit)
- authSlice, chatSlice, callSlice, contactsSlice — actions per PART 9 of original spec

## Infra
- setup-vps.sh: Ubuntu 24, install docker/compose/wireguard/nginx/certbot/ufw, UFW allow 22,80,443,3478/udp+tcp,5349,8080; generate WG keypair; unattended-upgrades; /opt/ii-private-messenger; docker compose up; systemd service
- Docker compose: backend stack (postgres:16-alpine, redis:7-alpine, backend), relay stacks (relay + coturn host-network)
- turnserver.conf.template (PART 6)
- nginx template: LE certbot, wss proxy to relay:8080, https proxy to backend:3000, HSTS, X-Frame-Options DENY, CSP, rate limit
- WireGuard templates backend + 3 relays
- Scripts: generate-wireguard-keys.sh, deploy-backend.sh, deploy-relay.sh

## Security
- SSL pinning (react-native-ssl-pinning) for api.iiprivatemessenger.app
- Jailbreak/root detect on startup (warn only)
- Screen capture protect on by default
- Self-destruct messages via expires_at + client timer + DELETE endpoint
- Signed prekey rotate every 90d, OTP replenish 50 when <10
- TLS 1.2+, account lockout 10 fails 15min Redis

## Env
backend/.env.example and relay/.env.example per PART 11.

## Deps versions — backend
express^4.18, pg^8.11, redis^4.6, bcryptjs^2.4, jsonwebtoken^9, zod^3.22, express-rate-limit^7.1, firebase-admin^12, ws^8.14, cors, helmet, morgan, uuid; dev: typescript^5.3, @types/*, ts-node, nodemon

## Deps — mobile
react 18.2 / RN 0.73, @react-navigation/{native,stack,bottom-tabs}, @reduxjs/toolkit, react-redux, axios, react-native-webrtc^118, @signalapp/libsignal-client^0.46, react-native-keychain^8.1, react-native-device-info, react-native-screen-capture-protect, react-native-ssl-pinning, react-native-image-picker, react-native-document-picker, react-native-audio-recorder-player, @notifee/react-native, @react-native-firebase/{app,messaging}^18.7, react-native-fast-image, react-native-gesture-handler, react-native-reanimated, react-native-safe-area-context, react-native-screens, react-native-vector-icons, dayjs, crypto-js, react-native-crypto, react-native-randombytes

## Rules
- TS strict, no `any`
- Full implementations, no TODOs
- Use ICONA 1.png as primary logo (require it in RN via assets/icons)
- Dark #0A0E1A everywhere, accent #00E5FF, alert #FF3D57, sharp corners
