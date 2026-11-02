-- Advisory HOSTING_ASN fraud rule. The Worker tags LIVE START events from known hosting/cloud ASNs
-- with metadata.networkRisk = 'HOSTING_ASN'. The flag is MEDIUM and advisory only: it is NOT added
-- to the metric views' exclusion list (rule codes SPEEDING/UNVERIFIED_RETURN/NO_CLIENT_REACH), so it
-- never removes completes from billing, and apply_quota_reservation_outcome is untouched.
-- Re-runnable: constraint is dropped and re-added; the function is create-or-replace and keeps
-- every rule from 055.

alter table public.fraud_flags drop constraint if exists fraud_flags_rule_code_check;
alter table public.fraud_flags add constraint fraud_flags_rule_code_check check (rule_code in ('DUPLICATE_IP','DUPLICATE_DEVICE','SPEEDING','QUALITY_VIOLATION','UNVERIFIED_RETURN','NO_CLIENT_REACH','HOSTING_ASN'));

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
  if new.event_type = 'START' and not coalesce(target_session.is_test,false) and coalesce(new.metadata->>'networkRisk','') = 'HOSTING_ASN' then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'HOSTING_ASN','MEDIUM',jsonb_build_object('asn',new.metadata->>'asn','advisory',true)) on conflict do nothing; end if;
  if coalesce(new.metadata->>'qualityViolation','false') = 'true' then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'QUALITY_VIOLATION','HIGH',jsonb_build_object('reported',true)) on conflict do nothing; end if;
  return new;
end; $$;
