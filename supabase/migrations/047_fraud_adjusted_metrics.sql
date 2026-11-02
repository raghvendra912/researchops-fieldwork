-- Migration 047: Fraud and rejection-adjusted metrics, supplier cost, and quota recovery (WS-B)
-- Ensures confirmed fraud flags, internal/vendor rejections, and speeding completes
-- are excluded from valid completes, billable supplier cost, and consumed quota reservations.

-- 1. Updated project_event_metrics view with fraud & rejection exclusion
create or replace view public.project_event_metrics with (security_invoker=true) as
with session_fraud as (
  select session_id,
    bool_or(status = 'CONFIRMED') as has_confirmed_fraud,
    bool_or(rule_code = 'SPEEDING' and status in ('OPEN', 'CONFIRMED')) as has_speeding
  from public.fraud_flags
  group by session_id
),
valid_sessions as (
  select s.id,
    s.project_id,
    s.project_supplier_id,
    s.is_test,
    s.started_at,
    s.completed_at,
    s.status,
    (
      coalesce(s.internal_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
      and coalesce(s.vendor_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
      and not coalesce(f.has_confirmed_fraud, false)
      and not coalesce(f.has_speeding, false)
    ) as is_valid_delivery
  from public.survey_sessions s
  left join session_fraud f on f.session_id = s.id
)
select p.organization_id, p.id project_id, p.project_code,
 count(distinct s.id) filter(where not s.is_test and e.event_type='START')::integer starts,
 count(distinct s.id) filter(where not s.is_test and e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and s.is_valid_delivery)::integer completes,
 count(distinct s.id) filter(where not s.is_test and e.event_type='TERMINATE')::integer terminates,
 count(distinct s.id) filter(where not s.is_test and e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct s.id) filter(where not s.is_test and e.event_type='QUALITY_TERMINATE')::integer quality_term,
 count(distinct s.id) filter(where not s.is_test and e.event_type='ABANDON')::integer abandons,
 count(distinct s.id) filter(where not s.is_test and s.status in ('START','REACHED_CLIENT'))::integer in_progress,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and s.is_valid_delivery and e.occurred_at>=now()-interval '24 hours')::integer completes_l24,
 coalesce(round(100.0*count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and s.is_valid_delivery)/nullif(count(distinct s.id) filter(where not s.is_test and (e.event_type='TERMINATE' or (e.event_type='COMPLETE' and s.is_valid_delivery))),0),2),0) incidence_rate,
 coalesce(round(100.0*count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and s.is_valid_delivery)/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type='REACHED_CLIENT'),0),2),0) conversion_rate,
 coalesce(round(100.0*count(distinct s.id) filter(where not s.is_test and e.event_type='ABANDON')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type='START'),0),2),0) abandon_rate,
 max(e.occurred_at) filter(where not s.is_test) last_event_at,
 max(e.occurred_at) filter(where not s.is_test and e.event_type='COMPLETE' and s.is_valid_delivery) last_complete_at,
 round(avg(extract(epoch from(s.completed_at-s.started_at))) filter(where not s.is_test and s.completed_at is not null and s.is_valid_delivery),0)::integer average_duration_seconds,
 count(distinct s.id) filter(where s.is_test)::integer test_starts,
 count(distinct s.id) filter(where s.is_test and e.event_type='COMPLETE')::integer test_completes,
 count(distinct s.id) filter(where s.is_test and e.event_type='TERMINATE')::integer test_terminates,
 count(distinct s.id) filter(where s.is_test and e.event_type='QUOTA_FULL')::integer test_over_quota,
 count(distinct s.id) filter(where s.is_test and e.event_type='QUALITY_TERMINATE')::integer test_quality_term,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')::integer gross_completes,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and not s.is_valid_delivery)::integer rejected_completes
from public.projects p
left join valid_sessions s on s.project_id=p.id
left join public.survey_events e on e.session_id=s.id
group by p.organization_id,p.id,p.project_code;

-- 2. Updated project_supplier_event_metrics view
create or replace view public.project_supplier_event_metrics with (security_invoker=true) as
with session_fraud as (
  select session_id,
    bool_or(status = 'CONFIRMED') as has_confirmed_fraud,
    bool_or(rule_code = 'SPEEDING' and status in ('OPEN', 'CONFIRMED')) as has_speeding
  from public.fraud_flags
  group by session_id
),
valid_sessions as (
  select s.id,
    s.project_supplier_id,
    s.is_test,
    (
      coalesce(s.internal_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
      and coalesce(s.vendor_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
      and not coalesce(f.has_confirmed_fraud, false)
      and not coalesce(f.has_speeding, false)
    ) as is_valid_delivery
  from public.survey_sessions s
  left join session_fraud f on f.session_id = s.id
)
select p.organization_id,p.id project_id,p.project_code,ps.id project_supplier_id,ps.supplier_id,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='START')::integer starts,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE' and ss.is_valid_delivery)::integer completes,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='TERMINATE')::integer terminates,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='QUALITY_TERMINATE')::integer quality_term,
 coalesce(round(100.0*count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE' and ss.is_valid_delivery)/nullif(count(distinct ss.id) filter(where not ss.is_test and (e.event_type='TERMINATE' or (e.event_type='COMPLETE' and ss.is_valid_delivery))),0),2),0) incidence_rate,
 round(count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE' and ss.is_valid_delivery)*coalesce(ps.supplier_cpi,0),2) cost,
 count(distinct ss.id) filter(where ss.is_test)::integer test_starts,
 coalesce(round(100.0*count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE' and ss.is_valid_delivery)/nullif(count(distinct ss.id) filter(where not ss.is_test and e.event_type='REACHED_CLIENT'),0),2),0) conversion_rate,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='COMPLETE')::integer test_completes,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='TERMINATE')::integer test_terminates,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='QUOTA_FULL')::integer test_over_quota,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='QUALITY_TERMINATE')::integer test_quality_term,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')::integer gross_completes,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE' and not ss.is_valid_delivery)::integer rejected_completes
from public.projects p
join public.project_suppliers ps on ps.project_id=p.id
left join valid_sessions ss on ss.project_supplier_id=ps.id
left join public.survey_events e on e.session_id=ss.id
group by p.organization_id,p.id,p.project_code,ps.id,ps.supplier_id,ps.supplier_cpi;

-- 3. Release quota reservation on survey session rejection
create or replace function public.review_survey_session(p_session_id uuid,p_review_type text,p_status text,p_note text default null)
returns setof public.survey_sessions language plpgsql security invoker set search_path=public as $$
declare target public.survey_sessions%rowtype; allowed boolean;
begin
  select * into target from public.survey_sessions where id=p_session_id for update;
  if not found or not public.can_review_project(target.project_id) then raise exception 'Respondent review access is required'; end if;
  if p_review_type='INTERNAL' then
    allowed=p_status in ('PENDING','APPROVED','REJECTED'); if not allowed then raise exception 'Invalid internal review status'; end if;
    update public.survey_sessions set internal_approval_status=p_status,internal_reviewed_by=auth.uid(),internal_reviewed_at=now(),internal_review_note=nullif(left(trim(p_note),500),'') where id=p_session_id returning * into target;
  elsif p_review_type='VENDOR' then
    allowed=p_status in ('PENDING','APPROVED','DISPUTED','REJECTED'); if not allowed then raise exception 'Invalid vendor review status'; end if;
    update public.survey_sessions set vendor_approval_status=p_status,vendor_reviewed_by=auth.uid(),vendor_reviewed_at=now(),vendor_review_note=nullif(left(trim(p_note),500),'') where id=p_session_id returning * into target;
  else raise exception 'Invalid review type'; end if;

  -- If session was rejected, release any consumed/reserved quota so the capacity is restored
  if p_status = 'REJECTED' then
    update public.survey_quota_reservations
    set status = 'RELEASED', expires_at = now()
    where project_id = target.project_id
      and project_supplier_id = target.project_supplier_id
      and respondent_ref = target.respondent_ref
      and status in ('RESERVED', 'CONSUMED');
  end if;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target.organization_id,auth.uid(),'RESPONDENT_REVIEWED','SURVEY_SESSION',target.id,jsonb_build_object('review_type',p_review_type,'status',p_status));
  return next target;
  return;
end $$;

-- 4. Release quota reservation when fraud flag is confirmed
create or replace function public.resolve_fraud_flag(p_flag_id uuid,p_status text)
returns table(id uuid,status text,reviewed_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare target public.fraud_flags%rowtype; target_project_id uuid; target_session public.survey_sessions%rowtype;
begin
  if p_status not in ('CONFIRMED','DISMISSED') then raise exception 'Invalid resolution'; end if;
  select f.* into target from public.fraud_flags f join public.survey_sessions s on s.id=f.session_id
  where f.id=p_flag_id and public.can_review_project(s.project_id) for update of f;
  if not found then raise exception 'Flag not found or review access denied'; end if;

  select s.* into target_session from public.survey_sessions s where s.id=target.session_id;
  target_project_id := target_session.project_id;

  update public.fraud_flags f set status=p_status,reviewed_by=auth.uid(),reviewed_at=now()
  where f.id=target.id returning f.id,f.status,f.reviewed_at into id,status,reviewed_at;

  -- If fraud is confirmed, release the quota reservation so fraudulent complete does not consume quota
  if p_status = 'CONFIRMED' and target_session.id is not null then
    update public.survey_quota_reservations
    set status = 'RELEASED', expires_at = now()
    where project_id = target_session.project_id
      and project_supplier_id = target_session.project_supplier_id
      and respondent_ref = target_session.respondent_ref
      and status in ('RESERVED', 'CONSUMED');
  end if;

  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target.organization_id,auth.uid(),'FRAUD_FLAG_RESOLVED','FRAUD_FLAG',target.id,jsonb_build_object('from',target.status,'to',p_status,'project_id',target_project_id));
  return next;
end $$;

-- 5. Updated apply_quota_reservation_outcome: speeding and security violations release quota
create or replace function public.apply_quota_reservation_outcome()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_session public.survey_sessions%rowtype; has_immediate_fraud boolean;
begin
  if new.event_type not in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then return new; end if;
  select * into target_session from public.survey_sessions where id=new.session_id;
  if target_session.is_test or target_session.project_supplier_id is null then return new; end if;

  -- Check if session already has high-severity fraud (e.g. speeding flag generated on complete)
  select exists(
    select 1 from public.fraud_flags
    where session_id = target_session.id
      and (status = 'CONFIRMED' or (rule_code in ('SPEEDING', 'SECURITY_VIOLATION') and severity in ('MEDIUM', 'HIGH')))
  ) into has_immediate_fraud;

  update public.survey_quota_reservations set
    status = case
      when new.event_type = 'COMPLETE' and not has_immediate_fraud then 'CONSUMED'
      else 'RELEASED'
    end,
    expires_at = greatest(expires_at, new.occurred_at)
  where project_id = target_session.project_id
    and project_supplier_id = target_session.project_supplier_id
    and respondent_ref = target_session.respondent_ref
    and status = 'RESERVED';

  return new;
end $$;

grant select on public.project_event_metrics, public.project_supplier_event_metrics to authenticated;
notify pgrst,'reload schema';

