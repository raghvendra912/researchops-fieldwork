-- 056: shared (cross-instance) rate limiter backed by Postgres.
-- Service-role only. Re-runnable. Does not touch the maintenance function;
-- call public.purge_rate_limit_buckets() from the cron/maintenance job.

create unlogged table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  window_start timestamptz not null,
  hits integer not null
);

alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limit_buckets to service_role;

create or replace function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, resets_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
  v_start timestamptz;
begin
  if p_key is null or length(p_key) = 0 or length(p_key) > 200 then
    raise exception 'check_rate_limit: key must be 1..200 characters' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'check_rate_limit: limit must be 1..100000' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'check_rate_limit: window must be 1..86400 seconds' using errcode = '22023';
  end if;

  insert into public.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (bucket_key) do update
    set window_start = case when b.window_start + make_interval(secs => p_window_seconds) <= now() then now() else b.window_start end,
        hits = case when b.window_start + make_interval(secs => p_window_seconds) <= now() then 1 else least(b.hits + 1, p_limit + 1) end
  returning b.hits, b.window_start into v_hits, v_start;

  allowed := v_hits <= p_limit;
  remaining := greatest(0, p_limit - v_hits);
  resets_at := v_start + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create or replace function public.purge_rate_limit_buckets()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  -- The window length is caller-defined and not stored, so purge on a conservative age:
  -- any bucket untouched for over a day (max window 86400s) plus 1 hour is certainly expired.
  delete from public.rate_limit_buckets where window_start < now() - interval '25 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.purge_rate_limit_buckets() from public, anon, authenticated;
grant execute on function public.purge_rate_limit_buckets() to service_role;
