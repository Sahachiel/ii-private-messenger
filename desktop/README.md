# II Private Messenger — Desktop (Electron)

Cross-platform desktop client (Windows / macOS / Linux). Shares the E2EE backend + relay with the mobile app: identities interoperate.

## Stack

- Electron 30 (Chromium + Node.js sandboxed renderer, context isolation on)
- `tweetnacl` for E2EE (Curve25519 + XSalsa20-Poly1305, same as mobile v0.2)
- `keytar` for OS keychain (DPAPI / Keychain / libsecret)
- `electron-store` for session metadata (not secrets)
- Vanilla HTML/CSS/JS renderer — zero bundler, minimal attack surface

## Dev

```bash
cd desktop
npm install
npm run dev
```

## Build

```bash
npm run build:win      # NSIS installer → release/II Private Messenger Setup.exe
npm run build:mac      # DMG (requires macOS)
npm run build:linux    # AppImage
```

Signed release builds require a code-signing certificate (Windows: EV cert; macOS: Apple Developer ID).
Unsigned builds work but trigger Windows SmartScreen warning + macOS Gatekeeper.

## Security

- Renderer runs with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- All privileged IPC handlers live in `src/ipc/`. Renderer only calls typed methods via `window.iimsg.*` bridge.
- Identity secret key lives in OS keychain via `keytar`. Never read by renderer directly.
- Network calls pinned to `https://iimsg-api.oleven-group.com` + regional relay WSS.
- CSP header blocks inline scripts and third-party origins.

## Interop with mobile

Identity keys and envelope format match the mobile v0.2 implementation (`tweetnacl.box` + JSON wrapper). A desktop user can message a mobile user and vice-versa.

## Limits v0.2 desktop

- No voice/video call (WebRTC not wired in Electron build; use mobile for calls)
- No push notifications (desktop stays connected while running; daemon mode future)
- No XSEC-MTD module (threat surface different; desktop MTD comes in v0.3)
