-- 003_groups_isolation.sql
-- Gruppi isolati ("circle") con inviti blindati e isolamento dell'appartenenza.
-- Idempotente: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- Design zero-knowledge sul CONTENUTO: group_name/group_avatar_url restano NULL —
-- il nome reale del circle viaggia cifrato (EnvelopeV2.systemText). Il server applica
-- l'isolamento solo su UUID opachi + membership, non legge i contenuti.

-- conversations: epoch (per rotazione Sender Keys su join/leave), tetto membri, lock, soft-delete
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS epoch        INT         NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS max_members  INT         NOT NULL DEFAULT 50;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_locked    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

-- conversation_members: ruolo, epoch d'ingresso (no storia pre-join), stato, provenienza invito
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS role         VARCHAR(12) NOT NULL DEFAULT 'member';
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS member_epoch INT         NOT NULL DEFAULT 0;
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS status       VARCHAR(10) NOT NULL DEFAULT 'active';
ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS invited_via  UUID;

CREATE INDEX IF NOT EXISTS idx_conv_members_user_active
    ON conversation_members (user_id) WHERE status = 'active';

-- INVITI: capability firmata Ed25519 (la firma vive nel token; in DB solo l'hash).
-- Blindatura scelta: bound_user_id (legato a un destinatario) e/o requires_approval (ok admin).
CREATE TABLE IF NOT EXISTS group_invites (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        TEXT NOT NULL UNIQUE,           -- SHA-256 hex del token (mai il token in chiaro)
    bound_user_id     UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = non legato
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    max_uses          INT  NOT NULL DEFAULT 1,
    used_count        INT  NOT NULL DEFAULT 0,
    bound_epoch       INT,
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_invites_conv ON group_invites (conversation_id);

-- RICHIESTE DI INGRESSO (flusso approvazione admin)
CREATE TABLE IF NOT EXISTS group_join_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id         UUID REFERENCES group_invites(id) ON DELETE SET NULL,
    status            VARCHAR(10) NOT NULL DEFAULT 'pending',  -- pending|approved|denied
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at        TIMESTAMPTZ,
    decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_join_requests_conv_pending
    ON group_join_requests (conversation_id) WHERE status = 'pending';

-- AUDIT eventi di gruppo (join/leave/kick/rename/rotate)
CREATE TABLE IF NOT EXISTS group_audit (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    actor_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    action            VARCHAR(24) NOT NULL,
    target_id         UUID,
    epoch             INT,
    at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_audit_conv ON group_audit (conversation_id);

-- MEDIA BLOB grandi (>1.5MB): cifrati lato client con content-key; il server tiene solo metadati opachi.
CREATE TABLE IF NOT EXISTS media_blobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_iv        TEXT,
    content_size      BIGINT,
    mime_hint         VARCHAR(64),
    storage_ref       TEXT,
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_media_blobs_conv ON media_blobs (conversation_id);
