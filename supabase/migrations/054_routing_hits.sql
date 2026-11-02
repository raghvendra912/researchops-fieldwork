-- Every router hit (accepted or rejected), separate from survey_sessions.
-- A session row only exists once START is recorded, so rejected clicks (inactive
-- supplier, rate limit, bad parameters, paused project, ...) were invisible.
-- Raw hits are kept 90 days in monthly partitions; maintain_routing_hits() adds
-- upcoming partitions and drops expired ones.

create table if not exists public.routing_hits (
  id uuid not null default gen_random_uuid(),
  click_id uuid not null,
  hop text not null check (hop in ('SUPPLIER_ENTRY', 'CLIENT_REDIRECT', 'CLIENT_RETURN', 'SUPPLIER_EXIT')),
  decision text not null,
  http_status integer not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  session_id uuid,
  respondent_ref text,
  route_kind text,
  target_host text,
  visitor_id text,
  ip_hash text,
  user_agent_hash text,
  country_code text,
  asn text,
  latency_ms integer,
  created_at timestamptz not null default now(),
  primary key (id, created_at)
) partition by range (created_at);

create index if not exists routing_hits_org_time_idx on public.routing_hits (organization_id, created_at desc);
create index if not exists routing_hits_supplier_time_idx on public.routing_hits (supplier_id, created_at desc);
create index if not exists routing_hits_project_time_idx on public.routing_hits (project_id, created_at desc);
create index if not exists routing_hits_session_idx on public.routing_hits (session_id) where session_id is not null;
create index if not exists routing_hits_visitor_idx on public.routing_hits (visitor_id, created_at desc) where visitor_id is not null;
create index if not exists routing_hits_click_idx on public.routing_hits (click_id);

alter table public.routing_hits enable row level security;
drop policy if exists "operators read routing hits" on public.routing_hits;
create policy "operators read routing hits" on public.routing_hits for select to authenticated
  using (organization_id is not null and public.can_operate_organization(organization_id));
revoke all on public.routing_hits from anon, authenticated;
grant select on public.routing_hits to authenticated;
grant select, insert on public.routing_hits to service_role;

create or replace function public.maintain_routing_hits(p_retention_days integer default 90)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  month_start date;
  partition_name text;
  created integer := 0;
  dropped integer := 0;
  cutoff date := (now() - make_interval(days => greatest(p_retention_days, 30)))::date;
  child record;
begin
  -- Current month plus the next two, so inserts never miss a partition.
  for offset_months in 0..2 loop
    month_start := (date_trunc('month', now()) + make_interval(months => offset_months))::date;
    partition_name := 'routing_hits_' || to_char(month_start, 'YYYYMM');
    if to_regclass('public.' || partition_name) is null then
      execute format('create table public.%I partition of public.routing_hits for values from (%L) to (%L)', partition_name, month_start, (month_start + interval '1 month')::date);
      created := created + 1;
    end if;
  end loop;

  -- Drop partitions whose whole month ends before the retention cutoff.
  for child in
    select c.relname from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'routing_hits' and p.relnamespace = 'public'::regnamespace
  loop
    if child.relname ~ '^routing_hits_[0-9]{6}$'
       and (to_date(substr(child.relname, 14, 6), 'YYYYMM') + interval '1 month')::date <= cutoff then
      execute format('drop table public.%I', child.relname);
      dropped := dropped + 1;
    end if;
  end loop;

  return jsonb_build_object('createdPartitions', created, 'droppedPartitions', dropped);
end $$;

revoke all on function public.maintain_routing_hits(integer) from public;
grant execute on function public.maintain_routing_hits(integer) to service_role;

-- Create the initial partitions now.
select public.maintain_routing_hits(90);

-- Per-supplier funnel: entry hits by decision (accepted vs each rejection reason).
create or replace function public.supplier_click_funnel(p_organization_id uuid, p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns table (supplier_id uuid, decision text, hits bigint)
language sql stable security invoker set search_path = public as $$
  select h.supplier_id, h.decision, count(*)::bigint
  from public.routing_hits h
  where h.organization_id = p_organization_id and h.hop = 'SUPPLIER_ENTRY' and h.created_at >= p_from and h.created_at < p_to
  group by h.supplier_id, h.decision
$$;

revoke all on function public.supplier_click_funnel(uuid, timestamptz, timestamptz) from public;
grant execute on function public.supplier_click_funnel(uuid, timestamptz, timestamptz) to authenticated, service_role;
