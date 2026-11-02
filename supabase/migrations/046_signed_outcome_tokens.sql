-- Migration 046: Signed per-outcome tokens for survey sessions (WS-A)
-- Separates the single shared outcome_token into distinct, per-outcome capability tokens
-- so that a respondent possessing a terminate or quota-full URL cannot substitute the
-- path to /complete to self-complete.

alter table public.survey_sessions
  add column if not exists complete_token uuid not null default gen_random_uuid(),
  add column if not exists terminate_token uuid not null default gen_random_uuid(),
  add column if not exists quota_full_token uuid not null default gen_random_uuid(),
  add column if not exists security_terminate_token uuid not null default gen_random_uuid();

-- Ensure all pre-existing rows receive distinct random UUIDs
update public.survey_sessions
set complete_token = gen_random_uuid(),
    terminate_token = gen_random_uuid(),
    quota_full_token = gen_random_uuid(),
    security_terminate_token = gen_random_uuid()
where complete_token = terminate_token;

create unique index if not exists survey_sessions_complete_token_idx on public.survey_sessions(complete_token);
create unique index if not exists survey_sessions_terminate_token_idx on public.survey_sessions(terminate_token);
create unique index if not exists survey_sessions_quota_full_token_idx on public.survey_sessions(quota_full_token);
create unique index if not exists survey_sessions_security_terminate_token_idx on public.survey_sessions(security_terminate_token);

comment on column public.survey_sessions.complete_token is 'Opaque single-purpose capability token for survey completion redirects.';
comment on column public.survey_sessions.terminate_token is 'Opaque single-purpose capability token for survey screenout redirects.';
comment on column public.survey_sessions.quota_full_token is 'Opaque single-purpose capability token for survey quota-full redirects.';
comment on column public.survey_sessions.security_terminate_token is 'Opaque single-purpose capability token for survey quality rejection redirects.';

