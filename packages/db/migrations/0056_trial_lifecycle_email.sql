-- ============================================================
-- 0056_trial_lifecycle_email
-- Opt-out + unsubscribe token for the trial lifecycle email drip (activation,
-- expiration, upgrade). These are lifecycle emails to the PROFESSIONAL (the
-- account owner), never to patients — so an honest one-click unsubscribe is
-- required (LGPD/anti-spam). The token lets the public unsubscribe route flip
-- the flag without authentication and without exposing the user id.
-- ============================================================

alter table public.profiles
  add column if not exists lifecycle_email_opt_out boolean not null default false,
  add column if not exists email_unsubscribe_token uuid not null default gen_random_uuid();

-- The token is the lookup key for the unauthenticated unsubscribe route.
create unique index if not exists profiles_email_unsubscribe_token_idx
  on public.profiles (email_unsubscribe_token);
