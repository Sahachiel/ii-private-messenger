-- 004_user_code.sql
-- Codice utente opaco per la DISCOVERY solo-codice (niente ricerca per username).
-- Idempotente. Codice GENERATO deterministicamente dall'id (md5) → auto-popola gli utenti
-- esistenti e futuri senza logica applicativa e senza collisioni (id univoco → md5 univoco).
-- Formato: IIM-XXXX-XXXX (8 hex maiuscoli). Univoco via indice.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS user_code VARCHAR(24)
  GENERATED ALWAYS AS (
    'IIM-' || upper(substr(md5(id::text), 1, 4)) || '-' || upper(substr(md5(id::text), 5, 4))
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_code ON users (user_code);
