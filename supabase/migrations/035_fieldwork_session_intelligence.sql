-- Privacy-safe respondent context, controlled response variables, and two-stage review.

alter table public.survey_sessions
  add column country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  add column language_code text check (language_code is null or language_code ~ '^[a-z]{2}$'),
  add column device_type text not null default 'UNKNOWN' check (device_type in ('DESKTOP','MOBILE','TABLET','BOT','UNKNOWN')),
  add column termination_reason_code text,
  add column termination_reason_source text,
  add column internal_approval_status text not null default 'NOT_REVIEWED' check (internal_approval_status in ('NOT_REVIEWED','PENDING','APPROVED','REJECTED')),
  add column internal_reviewed_by uuid references public.user_profiles(id) on delete set null,
  add column internal_reviewed_at timestamptz,
  add column internal_review_note text,
  add column vendor_approval_status text not null default 'NOT_REVIEWED' check (vendor_approval_status in ('NOT_REVIEWED','PENDING','APPROVED','DISPUTED','REJECTED')),
  add column vendor_reviewed_by uuid references public.user_profiles(id) on delete set null,
  add column vendor_reviewed_at timestamptz,
  add column vendor_review_note text;

alter table public.survey_sessions add constraint survey_sessions_reason_code_check check (
  termination_reason_code is null or termination_reason_code in (
    'ELIGIBILITY_SCREEN_OUT','CLIENT_TERMINATE','SUPPLIER_TERMINATE','QUOTA_FULL',
    'QUALITY_REJECT','SECURITY_REJECT','PROJECT_INACTIVE','SUPPLIER_INACTIVE',
    'ROUTING_ERROR','TECHNICAL_ERROR','ABANDONED','UNKNOWN'
  )
);

create table public.project_response_variables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  variable_key text not null check (variable_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  label text not null check (char_length(trim(label)) between 1 and 100),
  data_classification text not null default 'STANDARD' check (data_classification in ('STANDARD','DEMOGRAPHIC','SENSITIVE')),
  retention_days integer not null default 365 check (retention_days between 1 and 3650),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,variable_key)
);

create table public.survey_response_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid not null references public.survey_sessions(id) on delete cascade,
  variable_key text not null,
  value text not null check (char_length(value) between 1 and 500),
  source text not null default 'ROUTING' check (source in ('ROUTING','CLIENT_CALLBACK','PROVIDER_CALLBACK','OPERATOR')),
  captured_at timestamptz not null default now(),
  unique(session_id,variable_key)
);

create index project_response_variables_project_idx on public.project_response_variables(project_id,active);
create index survey_response_values_session_idx on public.survey_response_values(session_id,captured_at);
create index survey_sessions_review_idx on public.survey_sessions(project_id,internal_approval_status,vendor_approval_status,started_at desc);
create trigger project_response_variables_touch_updated_at before update on public.project_response_variables
for each row execute function public.touch_updated_at();

alter table public.project_response_variables enable row level security;
alter table public.survey_response_values enable row level security;
create policy "scoped users read response variable configuration" on public.project_response_variables for select to authenticated using (public.can_access_project(project_id));
create policy "scoped operators manage response variable configuration" on public.project_response_variables for all to authenticated using (public.can_operate_project(project_id)) with check (public.can_operate_project(project_id));
create policy "scoped users read response values" on public.survey_response_values for select to authenticated using (public.can_access_project(project_id));
grant select,insert,update,delete on public.project_response_variables to authenticated;
grant select on public.survey_response_values to authenticated;

create or replace function public.capture_fieldwork_session_context()
returns trigger language plpgsql security definer set search_path=public as $$
declare session_row public.survey_sessions%rowtype; reason_code text; answer record;
begin
  select * into session_row from public.survey_sessions where id=new.session_id;
  if new.event_type='START' then
    update public.survey_sessions set
      country_code=case when coalesce(new.metadata->>'countryCode','') ~ '^[A-Z]{2}$' then new.metadata->>'countryCode' else country_code end,
      language_code=case when coalesce(new.metadata->>'languageCode','') ~ '^[a-z]{2}$' then new.metadata->>'languageCode' else language_code end,
      device_type=case when upper(coalesce(new.metadata->>'deviceType','')) in ('DESKTOP','MOBILE','TABLET','BOT','UNKNOWN') then upper(new.metadata->>'deviceType') else device_type end
    where id=new.session_id;

    if jsonb_typeof(new.metadata->'responseVariables')='object' then
      for answer in select key,value from jsonb_each_text(new.metadata->'responseVariables') loop
        if char_length(answer.value) between 1 and 500 and exists (
          select 1 from public.project_response_variables c where c.project_id=session_row.project_id and c.variable_key=answer.key and c.active
        ) then
          insert into public.survey_response_values(organization_id,project_id,session_id,variable_key,value,source,captured_at)
          values(new.organization_id,session_row.project_id,new.session_id,answer.key,answer.value,'ROUTING',new.occurred_at)
          on conflict(session_id,variable_key) do update set value=excluded.value,captured_at=excluded.captured_at;
        end if;
      end loop;
    end if;
  end if;

  if new.event_type in ('TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then
    reason_code=upper(coalesce(new.metadata->>'reasonCode',''));
    if reason_code not in ('ELIGIBILITY_SCREEN_OUT','CLIENT_TERMINATE','SUPPLIER_TERMINATE','QUOTA_FULL','QUALITY_REJECT','SECURITY_REJECT','PROJECT_INACTIVE','SUPPLIER_INACTIVE','ROUTING_ERROR','TECHNICAL_ERROR','ABANDONED','UNKNOWN') then
      reason_code=case new.event_type when 'QUOTA_FULL' then 'QUOTA_FULL' when 'QUALITY_TERMINATE' then 'QUALITY_REJECT' when 'ABANDON' then 'ABANDONED' else 'UNKNOWN' end;
    end if;
    update public.survey_sessions set termination_reason_code=reason_code,termination_reason_source=left(coalesce(new.metadata->>'source','event'),100) where id=new.session_id;
  end if;
  return new;
end $$;

create trigger survey_events_capture_fieldwork_context after insert on public.survey_events
for each row execute function public.capture_fieldwork_session_context();

create or replace function public.replace_project_response_variables(p_project_code text,p_variables jsonb)
returns setof public.project_response_variables language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code));
  if not found or not public.can_operate_project(target.id) then raise exception 'Project editor access is required'; end if;
  if jsonb_typeof(coalesce(p_variables,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_variables,'[]'::jsonb))>30 then raise exception 'Invalid response variables'; end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_variables,'[]'::jsonb)) r(variable_key text,label text,data_classification text,retention_days integer,active boolean)
    where r.variable_key !~ '^[a-z][a-z0-9_]{0,49}$' or char_length(trim(r.label)) not between 1 and 100 or r.data_classification not in ('STANDARD','DEMOGRAPHIC','SENSITIVE') or r.retention_days not between 1 and 3650) then raise exception 'Invalid response variable'; end if;
  delete from public.project_response_variables where project_id=target.id;
  insert into public.project_response_variables(organization_id,project_id,variable_key,label,data_classification,retention_days,active)
  select target.organization_id,target.id,lower(trim(r.variable_key)),trim(r.label),r.data_classification,r.retention_days,coalesce(r.active,true)
  from jsonb_to_recordset(coalesce(p_variables,'[]'::jsonb)) r(variable_key text,label text,data_classification text,retention_days integer,active boolean);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target.organization_id,auth.uid(),'PROJECT_RESPONSE_VARIABLES_UPDATED','PROJECT',target.id,jsonb_build_object('project_code',target.project_code,'variable_count',jsonb_array_length(coalesce(p_variables,'[]'::jsonb))));
  return query select * from public.project_response_variables where project_id=target.id order by variable_key;
end $$;

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
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target.organization_id,auth.uid(),'RESPONDENT_REVIEWED','SURVEY_SESSION',target.id,jsonb_build_object('review_type',p_review_type,'status',p_status));
  return next target;
  return;
end $$;

create or replace function public.purge_expired_survey_response_values()
returns integer language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
  delete from public.survey_response_values v using public.project_response_variables c
  where c.project_id=v.project_id and c.variable_key=v.variable_key and v.captured_at < now() - make_interval(days=>c.retention_days);
  get diagnostics removed=row_count;
  return removed;
end $$;

revoke all on function public.replace_project_response_variables(text,jsonb) from public;
revoke all on function public.review_survey_session(uuid,text,text,text) from public;
grant execute on function public.replace_project_response_variables(text,jsonb) to authenticated;
grant execute on function public.review_survey_session(uuid,text,text,text) to authenticated;
revoke all on function public.purge_expired_survey_response_values() from public,anon,authenticated;
grant execute on function public.purge_expired_survey_response_values() to service_role;
notify pgrst,'reload schema';
