alter table public.survey_sessions
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists terminal_at timestamptz,
  add column if not exists terminal_source text,
  add column if not exists outcome_token uuid not null default gen_random_uuid();

update public.survey_sessions s
set last_activity_at = coalesce((
  select max(e.occurred_at) from public.survey_events e where e.session_id = s.id
), s.started_at),
terminal_at = case
  when s.status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then coalesce(s.completed_at, s.started_at)
  else null
end,
terminal_source = case
  when s.status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then 'migration'
  else null
end;

create unique index if not exists survey_sessions_outcome_token_idx on public.survey_sessions(outcome_token);
create index if not exists survey_sessions_open_activity_idx on public.survey_sessions(last_activity_at)
  where status in ('START','REACHED_CLIENT');

alter table public.survey_sessions drop constraint if exists survey_sessions_status_check;
alter table public.survey_sessions add constraint survey_sessions_status_check check (
  status in ('START','REACHED_CLIENT','COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')
);

create or replace function public.enforce_survey_session_terminal_state()
returns trigger language plpgsql set search_path = public as $$
begin
  new.last_activity_at := greatest(old.last_activity_at, coalesce(new.last_activity_at, old.last_activity_at));
  if old.status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then
    new.status := old.status;
    new.completed_at := old.completed_at;
    new.terminal_at := old.terminal_at;
    new.terminal_source := old.terminal_source;
  elsif new.status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then
    new.completed_at := coalesce(new.completed_at, now());
    new.terminal_at := coalesce(new.terminal_at, new.completed_at, now());
  end if;
  return new;
end $$;

drop trigger if exists survey_sessions_terminal_guard on public.survey_sessions;
create trigger survey_sessions_terminal_guard before update on public.survey_sessions
for each row execute function public.enforce_survey_session_terminal_state();

create or replace function public.guard_survey_event_terminal_state()
returns trigger language plpgsql set search_path = public as $$
declare current_status text;
begin
  select status into current_status from public.survey_sessions where id = new.session_id for update;
  if current_status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')
     and new.event_type <> current_status then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists survey_events_terminal_guard on public.survey_events;
create trigger survey_events_terminal_guard before insert on public.survey_events
for each row execute function public.guard_survey_event_terminal_state();

create or replace function public.apply_survey_event_to_session()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.survey_sessions
  set last_activity_at = greatest(last_activity_at, new.occurred_at),
      status = new.event_type,
      completed_at = case when new.event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then new.occurred_at else completed_at end,
      terminal_at = case when new.event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then new.occurred_at else terminal_at end,
      terminal_source = case when new.event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then coalesce(new.metadata->>'source', new.metadata->>'provider', 'event') else terminal_source end
  where id = new.session_id;
  return new;
end $$;

drop trigger if exists survey_events_apply_session on public.survey_events;
create trigger survey_events_apply_session after insert on public.survey_events
for each row execute function public.apply_survey_event_to_session();

create or replace function public.reconcile_abandoned_sessions(p_timeout_minutes integer default 1440)
returns integer language plpgsql security definer set search_path = public as $$
declare reconciled integer;
begin
  if p_timeout_minutes < 15 or p_timeout_minutes > 10080 then raise exception 'Invalid abandonment timeout'; end if;
  with candidates as (
    select id, organization_id
    from public.survey_sessions
    where status in ('START','REACHED_CLIENT')
      and last_activity_at < now() - make_interval(mins => p_timeout_minutes)
    for update skip locked
  ), inserted as (
    insert into public.survey_events(organization_id, session_id, event_type, provider_transaction_id, occurred_at, metadata)
    select organization_id, id, 'ABANDON', 'timeout:' || id::text, now(), jsonb_build_object('source','timeout','timeoutMinutes',p_timeout_minutes)
    from candidates
    on conflict do nothing
    returning id
  )
  select count(*)::integer into reconciled from inserted;
  return reconciled;
end $$;

revoke all on function public.reconcile_abandoned_sessions(integer) from public;
grant execute on function public.reconcile_abandoned_sessions(integer) to service_role;

drop view if exists public.project_event_metrics;
create view public.project_event_metrics with (security_invoker = true) as
select p.organization_id,p.id project_id,p.project_code,
 count(distinct s.id) filter(where e.event_type='START')::integer starts,
 count(distinct s.id) filter(where e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct s.id) filter(where e.event_type='COMPLETE')::integer completes,
 count(distinct s.id) filter(where e.event_type='TERMINATE')::integer terminates,
 count(distinct s.id) filter(where e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct s.id) filter(where e.event_type='QUALITY_TERMINATE')::integer quality_term,
 count(distinct s.id) filter(where e.event_type='ABANDON')::integer abandons,
 count(distinct s.id) filter(where s.status in ('START','REACHED_CLIENT'))::integer in_progress,
 count(distinct s.id) filter(where e.event_type='COMPLETE' and e.occurred_at>=now()-interval '24 hours')::integer completes_l24,
 round(100*count(distinct s.id) filter(where e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where e.event_type in('COMPLETE','TERMINATE')),0),2) incidence_rate,
 round(100*count(distinct s.id) filter(where e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where e.event_type='START'),0),2) conversion_rate,
 round(100*count(distinct s.id) filter(where e.event_type='ABANDON')/nullif(count(distinct s.id) filter(where e.event_type='START'),0),2) abandon_rate,
 max(e.occurred_at) last_event_at,
 max(e.occurred_at) filter(where e.event_type='COMPLETE') last_complete_at,
 round(avg(extract(epoch from (s.completed_at-s.started_at))) filter(where s.completed_at is not null),0)::integer average_duration_seconds
from public.projects p left join public.survey_sessions s on s.project_id=p.id left join public.survey_events e on e.session_id=s.id
group by p.organization_id,p.id,p.project_code;

grant select on public.project_event_metrics to authenticated;

create or replace function public.analytics_snapshot(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare organization uuid; result jsonb;
begin
 select organization_id into organization from public.organization_members where user_id=auth.uid() order by created_at limit 1;
 if organization is null then raise exception 'Workspace membership required'; end if;
 with scoped as (
   select e.*,s.project_id,s.project_supplier_id from public.survey_events e join public.survey_sessions s on s.id=e.session_id
   where e.organization_id=organization and e.occurred_at>=p_from and e.occurred_at<p_to
 ), session_scope as (
   select s.* from public.survey_sessions s where s.organization_id=organization and s.started_at>=p_from and s.started_at<p_to
 ), portfolio as (
   select
     count(distinct session_id) filter(where event_type='START') starts,
     count(distinct session_id) filter(where event_type='REACHED_CLIENT') reached,
     count(distinct session_id) filter(where event_type='COMPLETE') completes,
     count(distinct session_id) filter(where event_type='TERMINATE') terminates,
     count(distinct session_id) filter(where event_type='QUOTA_FULL') over_quota,
     count(distinct session_id) filter(where event_type='QUALITY_TERMINATE') quality_terminates,
     count(distinct session_id) filter(where event_type='ABANDON') abandons,
     max(occurred_at) last_event_at
   from scoped
 ), open_sessions as (
   select count(*)::integer in_progress from session_scope where status in ('START','REACHED_CLIENT')
 ), suppliers as (
   select sup.name, count(distinct sc.session_id) filter(where sc.event_type='START') starts,count(distinct sc.session_id) filter(where sc.event_type='COMPLETE') completes,round(100*count(distinct sc.session_id) filter(where sc.event_type='COMPLETE')/nullif(count(distinct sc.session_id) filter(where sc.event_type in('COMPLETE','TERMINATE')),0),2) ir,round(count(distinct sc.session_id) filter(where sc.event_type='COMPLETE')*coalesce(ps.supplier_cpi,0),2) cost from public.project_suppliers ps join public.suppliers sup on sup.id=ps.supplier_id left join scoped sc on sc.project_supplier_id=ps.id where sup.organization_id=organization group by sup.name,ps.supplier_cpi
 ), clients as (
   select c.name,count(distinct sc.session_id) filter(where sc.event_type='COMPLETE') completes from public.clients c join public.projects p on p.client_id=c.id left join scoped sc on sc.project_id=p.id where c.organization_id=organization group by c.name
 ), markets as (
   select pm.country_code,count(distinct sc.session_id) filter(where sc.event_type='COMPLETE') completes from public.project_markets pm join public.projects p on p.id=pm.project_id left join scoped sc on sc.project_id=p.id where p.organization_id=organization group by pm.country_code
 )
 select jsonb_build_object(
   'portfolio',(select jsonb_build_object(
     'starts',starts,'reached',reached,'completes',completes,'terminates',terminates,'overQuota',over_quota,
     'qualityTerminates',quality_terminates,'abandons',abandons,'inProgress',(select in_progress from open_sessions),
     'conversionRate',coalesce(round(100*completes/nullif(starts,0),2),0),'dropOffRate',coalesce(round(100*abandons/nullif(starts,0),2),0),
     'lastEventAt',last_event_at
   ) from portfolio),
   'suppliers',coalesce((select jsonb_agg(jsonb_build_object('name',name,'starts',starts,'completes',completes,'incidenceRate',ir,'cost',cost) order by completes desc) from suppliers),'[]'::jsonb),
   'clients',coalesce((select jsonb_agg(jsonb_build_object('name',name,'completes',completes) order by completes desc) from clients),'[]'::jsonb),
   'markets',coalesce((select jsonb_agg(jsonb_build_object('countryCode',country_code,'completes',completes) order by completes desc) from markets),'[]'::jsonb)
 ) into result;
 return result;
end $$;

revoke all on function public.analytics_snapshot(timestamptz,timestamptz) from public;
grant execute on function public.analytics_snapshot(timestamptz,timestamptz) to authenticated;

comment on column public.survey_sessions.outcome_token is 'Opaque per-session capability used by hosted survey outcome redirects.';
comment on column public.survey_sessions.last_activity_at is 'Most recent trusted event time used for in-progress and abandonment reconciliation.';
