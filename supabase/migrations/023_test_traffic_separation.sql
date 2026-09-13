alter table public.survey_sessions
  add column if not exists is_test boolean not null default false;

create index if not exists survey_sessions_test_scope_idx
  on public.survey_sessions(project_id, project_supplier_id, is_test, started_at);

create or replace function public.ingest_survey_event(
  p_organization_id uuid, p_project_code text, p_supplier_id uuid,
  p_respondent_ref text, p_event_type text, p_provider_transaction_id text,
  p_occurred_at timestamptz, p_metadata jsonb, p_is_test boolean
)
returns table (session_id uuid, event_id uuid, created boolean)
language plpgsql security definer set search_path = public as $$
declare
  target_project public.projects%rowtype;
  target_assignment_id uuid;
  target_session_id uuid;
  target_event_id uuid;
  was_created boolean := false;
begin
  if p_event_type not in ('START','REACHED_CLIENT','COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')
    or coalesce(trim(p_respondent_ref), '') = '' then raise exception 'Invalid event'; end if;
  select * into target_project from public.projects p where p.organization_id=p_organization_id and p.project_code=p_project_code;
  if not found then raise exception 'Project not found'; end if;
  if p_supplier_id is not null then
    select ps.id into target_assignment_id from public.project_suppliers ps where ps.project_id=target_project.id and ps.supplier_id=p_supplier_id;
    if not found then raise exception 'Supplier is not assigned to project'; end if;
  end if;
  insert into public.survey_sessions(organization_id,project_id,project_supplier_id,respondent_ref,status,is_test)
  values(p_organization_id,target_project.id,target_assignment_id,trim(p_respondent_ref),p_event_type,coalesce(p_is_test,false))
  on conflict(project_id,respondent_ref) do update set
    project_supplier_id=coalesce(survey_sessions.project_supplier_id,excluded.project_supplier_id),
    status=excluded.status,
    is_test=survey_sessions.is_test or excluded.is_test,
    completed_at=case when p_event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE') then coalesce(p_occurred_at,now()) else survey_sessions.completed_at end
  returning id into target_session_id;
  insert into public.survey_events(organization_id,session_id,event_type,provider_transaction_id,occurred_at,metadata)
  values(p_organization_id,target_session_id,p_event_type,nullif(trim(p_provider_transaction_id),''),coalesce(p_occurred_at,now()),coalesce(p_metadata,'{}'::jsonb))
  on conflict do nothing returning id into target_event_id;
  was_created := found;
  if not was_created then
    select e.id into target_event_id from public.survey_events e where e.session_id=target_session_id and e.event_type=p_event_type and coalesce(e.provider_transaction_id,'')=coalesce(nullif(trim(p_provider_transaction_id),''),'');
  end if;
  return query select target_session_id,target_event_id,was_created;
end $$;

revoke all on function public.ingest_survey_event(uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean) from public;
grant execute on function public.ingest_survey_event(uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean) to service_role;

create or replace view public.project_event_metrics with (security_invoker=true) as
select p.organization_id,p.id project_id,p.project_code,
 count(distinct s.id) filter(where not s.is_test and e.event_type='START')::integer starts,
 count(distinct s.id) filter(where not s.is_test and e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')::integer completes,
 count(distinct s.id) filter(where not s.is_test and e.event_type='TERMINATE')::integer terminates,
 count(distinct s.id) filter(where not s.is_test and e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct s.id) filter(where not s.is_test and e.event_type='QUALITY_TERMINATE')::integer quality_term,
 count(distinct s.id) filter(where not s.is_test and e.event_type='ABANDON')::integer abandons,
 count(distinct s.id) filter(where not s.is_test and s.status in ('START','REACHED_CLIENT'))::integer in_progress,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and e.occurred_at>=now()-interval '24 hours')::integer completes_l24,
 round(100*count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type in('COMPLETE','TERMINATE')),0),2) incidence_rate,
 round(100*count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type='START'),0),2) conversion_rate,
 round(100*count(distinct s.id) filter(where not s.is_test and e.event_type='ABANDON')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type='START'),0),2) abandon_rate,
 max(e.occurred_at) filter(where not s.is_test) last_event_at,
 max(e.occurred_at) filter(where not s.is_test and e.event_type='COMPLETE') last_complete_at,
 round(avg(extract(epoch from(s.completed_at-s.started_at))) filter(where not s.is_test and s.completed_at is not null),0)::integer average_duration_seconds,
 count(distinct s.id) filter(where s.is_test)::integer test_starts
from public.projects p left join public.survey_sessions s on s.project_id=p.id left join public.survey_events e on e.session_id=s.id
group by p.organization_id,p.id,p.project_code;

create or replace view public.project_supplier_event_metrics with (security_invoker=true) as
select p.organization_id,p.id project_id,p.project_code,ps.id project_supplier_id,ps.supplier_id,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='START')::integer starts,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')::integer completes,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='TERMINATE')::integer terminates,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='QUALITY_TERMINATE')::integer quality_term,
 round(100*count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')/nullif(count(distinct ss.id) filter(where not ss.is_test and e.event_type in('COMPLETE','TERMINATE')),0),2) incidence_rate,
 round(count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')*coalesce(ps.supplier_cpi,0),2) cost,
 count(distinct ss.id) filter(where ss.is_test)::integer test_starts
from public.projects p join public.project_suppliers ps on ps.project_id=p.id left join public.survey_sessions ss on ss.project_supplier_id=ps.id left join public.survey_events e on e.session_id=ss.id
group by p.organization_id,p.id,p.project_code,ps.id,ps.supplier_id,ps.supplier_cpi;

grant select on public.project_event_metrics,public.project_supplier_event_metrics to authenticated;
comment on column public.survey_sessions.is_test is 'True for UAT/test respondents excluded from production delivery, incidence, conversion, quota, and cost metrics.';
