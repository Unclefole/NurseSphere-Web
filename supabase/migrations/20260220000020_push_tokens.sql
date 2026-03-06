-- ─────────────────────────────────────────────────────────────────────────────
-- 020_push_tokens.sql
--
-- Push token storage for Expo mobile push notifications.
-- One active token per user per platform (iOS / Android / web).
-- Tokens are user-owned (RLS), rotated on every registration.
--
-- Usage:
--   - Mobile app POSTs ExponentPushToken to /api/push/register
--   - Server reads active tokens and POSTs to Expo push API
--   - 'DeviceNotRegistered' errors from Expo → set active = false
-- ─────────────────────────────────────────────────────────────────────────────

-- Extension required for gen_random_uuid() — usually already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token         text        NOT NULL,
  platform      text        NOT NULL CHECK (platform IN ('ios','android','web')),
  device_id     text,
  active        boolean     NOT NULL DEFAULT true,
  last_used_at  timestamptz DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One active record per user × platform; upserts rotate the token safely
  UNIQUE (user_id, platform)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_push_tokens_user
  ON public.push_tokens (user_id);

CREATE INDEX IF NOT EXISTS idx_push_tokens_active
  ON public.push_tokens (user_id, active)
  WHERE active = true;

-- ─── Row-Level Security ───────────────────────────────────────────────────────

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can read/write their own tokens only
CREATE POLICY "users_own_tokens"
  ON public.push_tokens
  FOR ALL
  USING (auth.uid() = user_id);

-- ─── updated_at trigger ───────────────────────────────────────────────────────

-- Reuse the existing set_updated_at() function if it exists; create it if not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  ) THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS '
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
      ';
    $func$;
  END IF;
END;
$$;

CREATE TRIGGER push_tokens_set_updated_at
  BEFORE UPDATE ON public.push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
