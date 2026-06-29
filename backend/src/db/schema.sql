-- II Private Messenger — Postgres schema
-- Uses pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- USERS
CREATE TABLE IF NOT EXISTS users (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username             VARCHAR(32)  NOT NULL UNIQUE,
    phone                VARCHAR(32)  UNIQUE,
    display_name         VARCHAR(64)  NOT NULL,
    avatar_url           TEXT,
    country_code         CHAR(2)      NOT NULL,
    region               VARCHAR(8)   NOT NULL,
    password_hash        TEXT         NOT NULL,
    identity_public_key  TEXT         NOT NULL,
    signed_prekey        TEXT         NOT NULL,
    registration_id      INT          NOT NULL,
    fcm_token            TEXT,
    last_seen            TIMESTAMPTZ,
    is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_phone    ON users (phone);

-- ONE-TIME PREKEYS
CREATE TABLE IF NOT EXISTS one_time_prekeys (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_id      INT  NOT NULL,
    public_key  TEXT NOT NULL,
    used        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_one_time_prekeys_user_id ON one_time_prekeys (user_id);
CREATE INDEX IF NOT EXISTS idx_one_time_prekeys_user_unused
    ON one_time_prekeys (user_id) WHERE used = FALSE;

-- CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group          BOOLEAN NOT NULL DEFAULT FALSE,
    -- group_name/group_avatar_url restano NULL by design (zero-knowledge): il nome reale
    -- del circle viaggia cifrato E2EE (EnvelopeV2.systemText), mai in chiaro lato server.
    group_name        VARCHAR(128),
    group_avatar_url  TEXT,
    epoch             INT     NOT NULL DEFAULT 0,
    max_members       INT     NOT NULL DEFAULT 50,
    is_locked         BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at        TIMESTAMPTZ,
    created_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CONVERSATION MEMBERS
CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_admin         BOOLEAN NOT NULL DEFAULT FALSE,
    role             VARCHAR(12) NOT NULL DEFAULT 'member',  -- owner|admin|member
    member_epoch     INT         NOT NULL DEFAULT 0,         -- epoch d'ingresso: no storia pre-join
    status           VARCHAR(10) NOT NULL DEFAULT 'active',  -- active|left|removed
    invited_via      UUID,
    PRIMARY KEY (conversation_id, user_id)
);

-- MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_type      VARCHAR(16) NOT NULL,
    ciphertext        TEXT NOT NULL,
    recipient_count   INT  NOT NULL DEFAULT 1,
    sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at      TIMESTAMPTZ,
    read_at           TIMESTAMPTZ,
    expires_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at         ON messages (sent_at);

-- CONTACTS
CREATE TABLE IF NOT EXISTS contacts (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname    VARCHAR(64),
    is_blocked  BOOLEAN NOT NULL DEFAULT FALSE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts (user_id);

-- CALL LOGS
CREATE TABLE IF NOT EXISTS call_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    callee_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    call_type         VARCHAR(16) NOT NULL,
    status            VARCHAR(16) NOT NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at          TIMESTAMPTZ,
    duration_seconds  INT,
    turn_region       VARCHAR(8)
);

-- GROUP INVITES (capability firmata Ed25519; in DB solo l'hash del token)
CREATE TABLE IF NOT EXISTS group_invites (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash        TEXT NOT NULL UNIQUE,
    bound_user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
    max_uses          INT  NOT NULL DEFAULT 1,
    used_count        INT  NOT NULL DEFAULT 0,
    bound_epoch       INT,
    expires_at        TIMESTAMPTZ NOT NULL,
    revoked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_invites_conv ON group_invites (conversation_id);

-- GROUP JOIN REQUESTS (approvazione admin)
CREATE TABLE IF NOT EXISTS group_join_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id         UUID REFERENCES group_invites(id) ON DELETE SET NULL,
    status            VARCHAR(10) NOT NULL DEFAULT 'pending',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at        TIMESTAMPTZ,
    decided_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE (conversation_id, user_id)
);

-- GROUP AUDIT
CREATE TABLE IF NOT EXISTS group_audit (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    actor_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    action            VARCHAR(24) NOT NULL,
    target_id         UUID,
    epoch             INT,
    at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MEDIA BLOBS (grandi, cifrati client-side; il server tiene solo metadati opachi)
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
