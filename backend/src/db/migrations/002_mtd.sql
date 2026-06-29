-- XSEC-MTD: threat intel mirror + encrypted org reports + admin keypair

CREATE TABLE IF NOT EXISTS mtd_blocklists (
  id              SERIAL PRIMARY KEY,
  kind            VARCHAR(32) NOT NULL,            -- 'apps' | 'phishing' | 'rogue_bssid' | 'malicious_ip' | 'cert_pins'
  version         INTEGER NOT NULL,
  payload         BYTEA NOT NULL,                  -- raw JSON payload (indexed by kind)
  signature_b64   TEXT NOT NULL,                   -- Ed25519 over raw payload bytes (Ed25519 hashes internally)
  signer_pub_b64  TEXT NOT NULL,                   -- Oleven blocklist signing pubkey (pinned in app)
  published_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (kind, version)
);
CREATE INDEX IF NOT EXISTS idx_mtd_blocklists_kind_ver ON mtd_blocklists(kind, version DESC);

CREATE TABLE IF NOT EXISTS mtd_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  org_admin_pub_b64 TEXT NOT NULL,                 -- recipient admin pubkey (who can decrypt)
  ciphertext      TEXT NOT NULL,                   -- E2EE blob (ed25519-signed + nacl-box encrypted)
  sender_pub_b64  TEXT NOT NULL,                   -- sender identity pubkey
  signature_b64   TEXT NOT NULL,                   -- Ed25519 sig over ciphertext by sender
  severity        VARCHAR(16),                     -- 'info' | 'warning' | 'compromised'
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mtd_reports_admin ON mtd_reports(org_admin_pub_b64, created_at DESC);

CREATE TABLE IF NOT EXISTS mtd_admin_keys (
  id              SERIAL PRIMARY KEY,
  org_name        VARCHAR(64) NOT NULL UNIQUE,
  public_key_b64  TEXT NOT NULL,                   -- Ed25519 public key (admins decrypt offline)
  fingerprint     VARCHAR(64) NOT NULL,            -- sha256 hex of pubkey
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  rotated_at      TIMESTAMPTZ
);

-- seed: default "oleven-xsec" admin key placeholder (will be overwritten by boot script)
INSERT INTO mtd_admin_keys (org_name, public_key_b64, fingerprint)
VALUES ('oleven-xsec', '__PLACEHOLDER__', '__PLACEHOLDER__')
ON CONFLICT (org_name) DO NOTHING;
