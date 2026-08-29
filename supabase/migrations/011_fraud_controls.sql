create table public.project_quality_policies (
  project_id uuid primary key references public.projects(id) on delete cascade,
  block_duplicate_ip boolean not null default true,
  block_duplicate_device boolean not null default true,
  minimum_duration_seconds integer not null default 60 check (minimum_duration_seconds >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.fraud_flags (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.survey_sessions(id) on delete cascade,
  event_id uuid references public.survey_events(id) on delete cascade,
  rule_code text not null check (rule_code in ('DUPLICATE_IP','DUPLICATE_DEVICE','SPEEDING','QUALITY_VIOLATION')),
  severity text not null default 'MEDIUM' check (severity in ('LOW','MEDIUM','HIGH')),
  status text not null default 'OPEN' check (status in ('OPEN','CONFIRMED','DISMISSED')),
  evidence jsonb not null default '{}'::jsonb, reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
  created_at timestamptz not null default now(), unique (event_id, rule_code)
);
create index fraud_flags_org_status_idx on public.fraud_flags (organization_id, status, created_at desc);
alter table public.project_quality_policies enable row level security;
alter table public.fraud_flags enable row level security;
create policy "members read quality policies" on public.project_quality_policies for select to authenticated using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy "operators manage quality policies" on public.project_quality_policies for all to authenticated using (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id))) with check (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)));
create policy "members read fraud flags" on public.fraud_flags for select to authenticated using (public.is_organization_member(organization_id));
create policy "operators update fraud flags" on public.fraud_flags for update to authenticated using (public.can_operate_organization(organization_id)) with check (public.can_operate_organization(organization_id));

create or replace function public.evaluate_survey_event_risk()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_session public.survey_sessions%rowtype; policy public.project_quality_policies%rowtype; duration_seconds integer;
begin
  select * into target_session from public.survey_sessions where id = new.session_id;
  select * into policy from public.project_quality_policies where project_id = target_session.project_id;
  if not found then policy.block_duplicate_ip := true; policy.block_duplicate_device := true; policy.minimum_duration_seconds := 60; end if;
  if new.event_type = 'START' and policy.block_duplicate_ip and coalesce(new.metadata->>'ipHash','') <> '' and exists (select 1 from public.survey_events e join public.survey_sessions s on s.id=e.session_id where s.project_id=target_session.project_id and s.id<>target_session.id and e.event_type='START' and e.metadata->>'ipHash'=new.metadata->>'ipHash') then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'DUPLICATE_IP','HIGH',jsonb_build_object('matched',true)) on conflict do nothing; end if;
  if new.event_type = 'START' and policy.block_duplicate_device and coalesce(new.metadata->>'deviceHash','') <> '' and exists (select 1 from public.survey_events e join public.survey_sessions s on s.id=e.session_id where s.project_id=target_session.project_id and s.id<>target_session.id and e.event_type='START' and e.metadata->>'deviceHash'=new.metadata->>'deviceHash') then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'DUPLICATE_DEVICE','HIGH',jsonb_build_object('matched',true)) on conflict do nothing; end if;
  if new.event_type = 'COMPLETE' then duration_seconds := extract(epoch from (new.occurred_at-target_session.started_at)); if duration_seconds < policy.minimum_duration_seconds then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'SPEEDING','MEDIUM',jsonb_build_object('durationSeconds',duration_seconds,'minimumSeconds',policy.minimum_duration_seconds)) on conflict do nothing; end if; end if;
  if coalesce(new.metadata->>'qualityViolation','false') = 'true' then insert into public.fraud_flags(organization_id,session_id,event_id,rule_code,severity,evidence) values(new.organization_id,new.session_id,new.id,'QUALITY_VIOLATION','HIGH',jsonb_build_object('reported',true)) on conflict do nothing; end if;
  return new;
end; $$;
create trigger survey_events_evaluate_risk after insert on public.survey_events for each row execute function public.evaluate_survey_event_risk();

create or replace function public.resolve_fraud_flag(p_flag_id uuid, p_status text)
returns table (id uuid, status text, reviewed_at timestamptz)
language plpgsql security invoker set search_path = public as $$
declare target public.fraud_flags%rowtype;
begin
  if p_status not in ('CONFIRMED','DISMISSED') then raise exception 'Invalid resolution'; end if;
  select * into target from public.fraud_flags f where f.id=p_flag_id and public.can_operate_organization(f.organization_id) for update;
  if not found then raise exception 'Flag not found or access denied'; end if;
  update public.fraud_flags f set status=p_status, reviewed_by=auth.uid(), reviewed_at=now() where f.id=target.id returning f.id,f.status,f.reviewed_at into id,status,reviewed_at;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(target.organization_id,auth.uid(),'FRAUD_FLAG_RESOLVED','FRAUD_FLAG',target.id,jsonb_build_object('from',target.status,'to',p_status));
  return next;
end; $$;
revoke all on function public.resolve_fraud_flag(uuid,text) from public;
grant execute on function public.resolve_fraud_flag(uuid,text) to authenticated;
