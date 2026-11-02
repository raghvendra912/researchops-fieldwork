-- Migration 048: Security monitoring, rate limiting telemetry, and audit health (WS-C)
-- Adds distributed rate limiting telemetry and security incident tracking.

create table if not exists public.rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  window_seconds integer not null default 60,
  hits integer not null default 1,
  blocked boolean not null default false,
  ip_address text,
  occurred_at timestamptz not null default now()
);

create index if not exists rate_limit_events_key_idx on public.rate_limit_events(key, occurred_at desc);

alter table public.rate_limit_events enable row level security;
drop policy if exists "operators read rate limit events" on public.rate_limit_events;
create policy "operators read rate limit events" on public.rate_limit_events
  for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.user_id = auth.uid() and m.role in ('OWNER', 'ADMIN')
  ));

create or replace function public.log_rate_limit_incident(
  p_key text,
  p_window_seconds integer,
  p_hits integer,
  p_blocked boolean,
  p_ip_address text default null
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.rate_limit_events (key, window_seconds, hits, blocked, ip_address)
  values (p_key, p_window_seconds, p_hits, p_blocked, p_ip_address);
end $$;

revoke all on function public.log_rate_limit_incident(text, integer, integer, boolean, text) from public;
grant execute on function public.log_rate_limit_incident(text, integer, integer, boolean, text) to service_role;

