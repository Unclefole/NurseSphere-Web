-- Migration 013: Stripe Connect onboarding columns on profiles
-- Add stripe_account_id + onboarding status to profiles

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS stripe_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_onboarding_status text DEFAULT 'not_started'
    CHECK (stripe_onboarding_status IN ('not_started','pending','complete','restricted'));

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account ON public.profiles(stripe_account_id);

-- RLS: nurses can read their own stripe columns; service role can write
-- (existing RLS policies on profiles apply; no new policies needed as
--  the new columns are covered by existing row-level filters)

COMMENT ON COLUMN public.profiles.stripe_account_id IS 'Stripe Connect Express account ID for nurse payouts';
COMMENT ON COLUMN public.profiles.stripe_onboarding_status IS 'Stripe Connect onboarding state: not_started | pending | complete | restricted';
