-- 005_user_code_widen.sql
-- Allarga user_code da 32 a 48 bit: IIM-XXXX-XXXX-XXXX (12 hex maiuscoli da md5(id)).
-- Motivo (review avversariale Fase 1): con 32 bit + indice UNIQUE, a scala le collisioni
-- diventano probabili (~50% attorno a 77k utenti) e farebbero FALLIRE la registrazione.
-- 48 bit spostano la soglia di collisione a milioni di utenti.
--
-- Idempotente: rigenera la colonna SOLO se la sua espressione non contiene già il terzo
-- gruppo (substr ..., 9, 4). user_code è derivata da id in modo deterministico, quindi il
-- drop+add non perde dati (ricalcola valori identici per ogni riga).
DO $$
DECLARE ge text;
BEGIN
  SELECT generation_expression INTO ge
    FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'user_code';

  IF ge IS NULL OR replace(ge, ' ', '') NOT LIKE '%,9,4)%' THEN
    DROP INDEX IF EXISTS idx_users_user_code;
    ALTER TABLE users DROP COLUMN IF EXISTS user_code;
    ALTER TABLE users ADD COLUMN user_code VARCHAR(24)
      GENERATED ALWAYS AS (
        'IIM-' || upper(substr(md5(id::text), 1, 4))
              || '-' || upper(substr(md5(id::text), 5, 4))
              || '-' || upper(substr(md5(id::text), 9, 4))
      ) STORED;
    CREATE UNIQUE INDEX idx_users_user_code ON users (user_code);
  END IF;
END $$;
