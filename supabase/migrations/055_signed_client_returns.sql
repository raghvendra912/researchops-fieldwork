-- Migration 055: signed client returns and held completes.
--
-- A respondent can read every signed outcome URL in the survey link, so a per-URL signature
-- cannot stop a screened-out respondent from opening the complete link. Real protection is a
-- secret only the client platform knows. Each client may now name a Worker env var holding
-- that secret (the value is never stored here) and choose a policy:
--   OFF    - accept any valid outcome link (previous behaviour)
--   HOLD   - accept an unsigned return but hold the complete for review (UNVERIFIED_RETURN)
--   REJECT - refuse any return that is not signed with h=HMAC(secret, session|outcome)
-- Independently, a complete with no REACHED_CLIENT event is held (NO_CLIENT_REACH). A held
-- complete stays OPEN in fraud_flags, is excluded from valid completes, billable cost and
-- consumed quota (same treatment as SPEEDING) until an operator dismisses or confirms it.

alter table public.clients add column if not exists signing_secret_env text;
alter table public.clients add column if not exists signed_return_policy text not null default 'OFF';
alter table public.clients drop constraint if exists clients_signed_return_policy_check;
alter table public.clients add constraint clients_signed_return_policy_check check (signed_return_policy in ('OFF','HOLD','REJECT'));
alter table public.clients drop constraint if exists clients_signing_secret_env_check;
alter table public.clients add constraint clients_signing_secret_env_check check (signing_secret_env is null or signing_secret_env ~ '^CLIENT_[A-Z0-9_]{1,40}_SECRET$');
alter table public.clients drop constraint if exists clients_signed_policy_needs_secret_check;
alter table public.clients add constraint clients_signed_policy_needs_secret_check check (signed_return_policy = 'OFF' or signing_secret_env is not null);

alter table public.fraud_flags drop constraint if exists fraud_flags_rule_code_check;
alter table public.fraud_flags add constraint fraud_flags_rule_code_check check (rule_code in ('DUPLICATE_IP','DUPLICATE_DEVICE','SPEEDING','QUALITY_VIOLATION','UNVERIFIED_RETURN','NO_CLIENT_REACH'));

create or replace function public.evaluate_survey_event_risk()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_session public.survey_sessions%rowtype; policy public.project_quality_policies%rowtype; duration_seconds integer;
begin
  select * into target_session from public.survey_sessions where id = new.session_id;
  select * into policy from public.project_quality_policies where project_id = target_session.project_id;
  if not found then policy.block_duplicate_ip := true; policy.block_duplicate_device := true; policy.minimum_duration_seconds := 60; end if;
  if new.event_type = 'START' and policy.block_duplicate_ip and coalesce(new.metadata->>'ipHash','') <> '' and exists (select 1 from public.survey_events e join public.survey_sessions s on s.id=e.session_id where s.project_id=target_session.project_id and s.id<>target_session.id and e.event_type='START' and e.metadata->>'ipHash'=new.metadata->>'ipHash') then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'DUPLICATE_IP','HIGH',jsonb_build_object('matched',true)) on conflict do nothing; end if;
  if new.event_type = 'START' and policy.block_duplicate_device and coalesce(new.metadata->>'deviceHash','') <> '' and exists (select 1 from public.survey_events e join public.survey_sessions s on s.id=e.session_id where s.project_id=target_session.project_id and s.id<>target_session.id and e.event_type='START' and e.metadata->>'deviceHash'=new.metadata->>'deviceHash') then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'DUPLICATE_DEVICE','HIGH',jsonb_build_object('matched',true)) on conflict do nothing; end if;
  if new.event_type = 'COMPLETE' then
    duration_seconds := extract(epoch from (new.occurred_at-target_session.started_at));
    if duration_seconds < policy.minimum_duration_seconds then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'SPEEDING','MEDIUM',jsonb_build_object('durationSeconds',duration_seconds,'minimumSeconds',policy.minimum_duration_seconds)) on conflict do nothing; end if;
    if not coalesce(target_session.is_test,false) and not exists (select 1 from public.survey_events r where r.session_id = new.session_id and r.event_type = 'REACHED_CLIENT') then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'NO_CLIENT_REACH','MEDIUM',jsonb_build_object('reason','complete without a recorded client hand-off')) on conflict do nothing; end if;
    if not coalesce(target_session.is_test,false) and coalesce(new.metadata->>'returnVerification','') = 'UNSIGNED' then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'UNVERIFIED_RETURN','MEDIUM',jsonb_build_object('reason','client requires signed returns; this complete arrived unsigned')) on conflict do nothing; end if;
  end if;
  if coalesce(new.metadata->>'qualityViolation','false') = 'true' then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'QUALITY_VIOLATION','HIGH',jsonb_build_object('reported',true)) on conflict do nothing; end if;
  return new;
end; $$;

-- Held completes are excluded from valid completes, cost and consumed quota (same as SPEEDING).
create or replace view public.project_event_metrics with (security_invoker=true) as
with session_fraud as (
  select session_id,
    bool_or(status = 'CONFIRMED') as has_confirmed_fraud,
    bool_or(rule_code in ('SPEEDING', 'UNVERIFIED_RETURN', 'NO_CLIENT_REACH') and status in ('OPEN', 'CONFIRMED')) as has_speeding
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
    bool_or(rule_code in ('SPEEDING', 'UNVERIFIED_RETURN', 'NO_CLIENT_REACH') and status in ('OPEN', 'CONFIRMED')) as has_speeding
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
      and (status = 'CONFIRMED' or (rule_code in ('SPEEDING', 'UNVERIFIED_RETURN', 'NO_CLIENT_REACH', 'SECURITY_VIOLATION') and severity in ('MEDIUM', 'HIGH')))
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
