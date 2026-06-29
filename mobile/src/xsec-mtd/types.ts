export type ThreatCategory =
  | 'root_jailbreak'
  | 'debugger'
  | 'ssl_pinning'
  | 'mitm'
  | 'wifi'
  | 'app_blocklist'
  | 'mdm_profile'
  | 'phishing'
  | 'memory_tamper';

export type Severity = 'info' | 'warning' | 'compromised';

export type DeviceState = 'secure' | 'warning' | 'compromised';

export interface MtdEvent {
  id: string;
  ts: number;
  category: ThreatCategory;
  severity: Severity;
  title: string;
  detail?: Record<string, unknown>;
  ack?: boolean;
}

export interface MtdPolicy {
  enabled: Record<ThreatCategory, boolean>;
  scanIntervalMs: number;
  autoWipeOnCompromise: boolean;     // opt-in
  blockSendOnCompromise: boolean;    // default on
  orgReporting: boolean;             // opt-in
  phishingLinkScan: boolean;
}

export const DEFAULT_POLICY: MtdPolicy = {
  enabled: {
    root_jailbreak: true,
    debugger: true,
    ssl_pinning: true,
    mitm: true,
    wifi: true,
    app_blocklist: true,
    mdm_profile: true,
    phishing: true,
    memory_tamper: true,
  },
  scanIntervalMs: 5 * 60 * 1000,
  autoWipeOnCompromise: false,
  blockSendOnCompromise: true,
  orgReporting: false,
  phishingLinkScan: true,
};

export interface BlocklistEntry {
  version: number;
  payload_b64: string;
  signature_b64: string;
  signer_pub_b64: string;
}

export interface AttestationToken {
  ts: number;
  state: DeviceState;
  healthScore: number; // 0..100
  detectorDigest: string; // sha256 hex of policy.enabled keys that passed
  sig: string; // Ed25519 over the above, by sender identity
}
