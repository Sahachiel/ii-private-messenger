# XSEC-MTD — Sovereign Mobile Threat Defense

Oleven Technologies XSEC module shipped inside II Private Messenger v0.2+. Provides
Zimperium-class capabilities fully on-device, zero-cloud, sovereign.

## Threat model

**Adversaries covered**
- Malware installed on the user's phone (root/jailbreak toolkits, Frida, Cydia tweaks)
- Network-level MITM (rogue hotspots, trust-anchor injection, proxy interception)
- Social-engineering phishing via chat links
- Rogue enrollment (MDM profile, device admin receiver)
- Unauthorized analysis tooling (debuggers, memory tampering)

**Adversaries out of scope for v0.2**
- Supply-chain compromise of the APK itself (mitigated by reproducible builds + signing — future)
- Nation-state kernel-level rootkits that hide from file-system probes
- Physical extraction of keystore hardware (TEE/SE out of reach for RN-only)

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  React Native app (II Private Messenger)               │
│                                                        │
│  UI ──▶ ShieldScreen / Log / Settings / Troubleshoot   │
│                │                                       │
│  hooks ──▶ useDeviceHealth / useMtdEvents              │
│                │                                       │
│  engine ──▶ MTDEngine (orchestrator + policy + timers) │
│                │                                       │
│  detectors ──▶ root/jailbreak · debugger · ssl_pinning │
│                · mitm · wifi · app_blocklist · mdm     │
│                · phishing · memory_tamper              │
│                │                                       │
│  ml runtime ──▶ onnxruntime-react-native (phishing.onnx) │
│                │                                       │
│  storage ──▶ MMKV encrypted (eventLog, blocklist, policy) │
│                │                                       │
│  sync ──▶ mirrorClient ── HTTPS ──▶ iimsg-{ru,ge,fi}   │
│                │                     /api/mtd/blocklist │
│  attestation ──▶ Ed25519 proof-of-health per message   │
└────────────────────────────────────────────────────────┘
```

## Detectors

| Category | Mechanism | Severity | Limitations |
|---|---|---|---|
| root_jailbreak | DeviceInfo + file-system probe | compromised | Anti-detect tools can hide |
| debugger | Time-based heuristic + env check | warning | Native port probe in v0.3 |
| ssl_pinning | Deliberate mismatched pin request | compromised | Requires API reachability |
| mitm | Proxy env + cert-chain heuristics | warning | Deep chain inspection needs native |
| wifi | Current SSID/BSSID + blocklist | warning–compromised | Needs `wifi-reborn` lib + permissions |
| app_blocklist | Installed-pkg hash vs signed list | compromised | Android only (iOS sandboxed) |
| mdm_profile | Configuration profile enumeration | warning | Needs native module (v0.3) |
| phishing | Regex + ML (ONNX) on URLs | warning–compromised | Model size ~2MB |
| memory_tamper | Not implemented v0.2 | — | Planned v0.3 |

## Blocklist pipeline (sovereign)

1. Oleven security team publishes signed blocklists via `POST /api/mtd/blocklist`
   (bearer = INTER_NODE_SECRET). Each payload: raw JSON → SHA-256 → Ed25519-sign
   with Oleven signing key.
2. Backend stores payload + signature in `mtd_blocklists`. No rewriting.
3. Clients poll `GET /api/mtd/blocklist?kind=X&since=N` every app open + every
   hour. Each entry's signature is verified **on device** against a **pinned**
   Oleven public key. Rejects on mismatch.
4. Blocklists stored in encrypted MMKV. Detectors consult local cache only.
5. Mirror is regional (ru/ge/fi subdomain) — no US cloud.

Supported kinds: `apps`, `phishing`, `rogue_bssid`, `malicious_ip`, `cert_pins`.

## Attestation (proof-of-health)

Every outgoing chat message carries an `attestation` field:

```
{
  ts: <unix ms>,
  state: secure | warning | compromised,
  healthScore: 0..100,
  detectorDigest: <16-byte hash of enabled detector names>,
  sig: <Ed25519(`${ts}|${state}|${healthScore}|${detectorDigest}`) by sender identity>
}
```

Receiver verifies the signature against `senderSignPub` (also in envelope) and
prefixes the decrypted body with `⚠ Peer device compromised — …` if state != secure.

## Compromise response

Configurable in Settings → Shield → Response:

- `blockSendOnCompromise` (default ON): when `mtd.getState() === 'compromised'`
  the `sendMessage` thunk rejects with `device_compromised`. User sees an alert.
- `autoWipeOnCompromise` (default OFF, opt-in): on first transition to
  compromised, clears identity key, tokens, credentials, and secure MMKV.
  User must re-register.
- `orgReporting` (default OFF, opt-in): Troubleshoot → "Send encrypted report"
  posts the event log + device state, encrypted to the Oleven admin Ed25519 key,
  signed with the user's identity. Server cannot decrypt.

## Privacy guarantees

- **Zero telemetry by default.** No outbound MTD traffic unless user taps
  "Send encrypted report" or policy explicitly enables `orgReporting`.
- **Regional residency.** Blocklist mirror lives on Oleven's own regional VPS,
  served through the same nginx stack as messaging — never US cloud.
- **Blocklist signature pinning.** The Oleven signing pubkey is baked into the
  APK. A compromised backend cannot push arbitrary blocklists without valid sig.
- **Event log encrypted at rest.** MMKV encryption key derived from the user's
  identity key material. Uninstall = data irrecoverable.

## Backend endpoints

- `GET  /api/mtd/admin-pubkey` — returns Ed25519 pubkey + fingerprint (public)
- `GET  /api/mtd/blocklist?kind&since` — paged signed blocklist entries
- `POST /api/mtd/blocklist` — operator-only push (bearer INTER_NODE_SECRET)
- `POST /api/mtd/org-report` — authenticated user uploads E2EE report

## v0.3 roadmap

- Native module for deep root/jailbreak checks (Play Integrity + DeviceCheck)
- Frida native port-probe detector
- MDM enumeration (iOS ConfigurationProfiles, Android DevicePolicyManager)
- SQLCipher storage backend
- Real X25519 DH for org-report encryption (currently uses hash-derived key)
- Identity-key rotation on detection (signal.rotateIdentity())
- Model updates via signed `.onnx` fetch from same mirror
