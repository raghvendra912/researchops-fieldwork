alter table public.projects
  add column if not exists test_survey_url text,
  add column if not exists survey_parameters jsonb not null default '[{"name":"PID","value":"{{project_id}}"},{"name":"RID","value":"{{respondent_id}}"}]'::jsonb;

alter table public.projects drop constraint if exists projects_test_survey_url_valid;
alter table public.projects add constraint projects_test_survey_url_valid
  check (test_survey_url is null or (length(test_survey_url)<=2048 and test_survey_url ~ '^https?://'));
alter table public.projects drop constraint if exists projects_survey_parameters_valid;
alter table public.projects add constraint projects_survey_parameters_valid
  check (jsonb_typeof(survey_parameters)='array' and jsonb_array_length(survey_parameters)<=30);

create or replace function public.create_project_with_market_v4(
  p_project_name text,p_client_name text,p_client_po text,p_project_type text,p_category text,
  p_client_cpi numeric,p_quota integer,p_country_code text,p_language_code text,
  p_expected_loi_minutes integer,p_expected_ir numeric,p_supplier_assignments jsonb,
  p_survey_url text,p_test_survey_url text,p_survey_parameters jsonb
)
returns table(project_id uuid,project_code text,status text)
language plpgsql security invoker set search_path=public as $$
declare v_organization_id uuid; v_client_id uuid; v_manager_name text; v_project public.projects;
begin
  select om.organization_id into v_organization_id from public.organization_members om where om.user_id=auth.uid() order by om.created_at limit 1;
  if v_organization_id is null then raise exception 'The signed-in user does not belong to an organization'; end if;
  if not public.can_operate_organization(v_organization_id) then raise exception 'The workspace role cannot create projects'; end if;
  select id into v_client_id from public.clients where organization_id=v_organization_id and name=trim(p_client_name);
  if v_client_id is null then raise exception 'Select an existing client'; end if;
  if jsonb_typeof(coalesce(p_survey_parameters,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_survey_parameters,'[]'::jsonb))>30 then raise exception 'Invalid survey parameters'; end if;
  if jsonb_typeof(coalesce(p_supplier_assignments,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_supplier_assignments,'[]'::jsonb))>100 then raise exception 'Invalid supplier assignments'; end if;
  select display_name into v_manager_name from public.user_profiles where id=auth.uid();
  insert into public.projects(organization_id,client_id,project_code,project_name,project_type,category,project_manager_id,project_manager_name,client_po,client_cpi,quota,status,start_date,survey_url,test_survey_url,survey_parameters)
  values(v_organization_id,v_client_id,'ROP-'||nextval('public.project_code_sequence')::text,trim(p_project_name),nullif(trim(p_project_type),''),nullif(trim(p_category),''),auth.uid(),coalesce(v_manager_name,'Team member'),nullif(trim(p_client_po),''),p_client_cpi,p_quota,'PENDING',current_date,nullif(trim(p_survey_url),''),nullif(trim(p_test_survey_url),''),coalesce(p_survey_parameters,'[]'::jsonb))
  returning * into v_project;
  insert into public.project_markets(project_id,country_code,language_code,target_quota,expected_loi_minutes,expected_ir)
  values(v_project.id,upper(trim(p_country_code)),lower(trim(p_language_code)),p_quota,p_expected_loi_minutes,p_expected_ir);
  insert into public.project_suppliers(project_id,supplier_id,supplier_cpi,target_quota,status)
  select v_project.id,s.id,greatest(0,coalesce(a.supplier_cpi,0)),p_quota,'PENDING'
  from jsonb_to_recordset(coalesce(p_supplier_assignments,'[]'::jsonb)) a(name text,supplier_cpi numeric)
  join public.suppliers s on s.organization_id=v_organization_id and s.name=a.name
  on conflict on constraint project_suppliers_project_id_supplier_id_key do nothing;
  return query select v_project.id,v_project.project_code,v_project.status;
end $$;

create or replace function public.update_project_core_v4(
  p_project_code text,p_project_name text,p_client_po text,p_project_type text,p_category text,
  p_client_cpi numeric,p_quota integer,p_end_date date
)
returns table(project_id uuid,project_code text,status text)
language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype; previous jsonb;
begin
  if coalesce(trim(p_project_name),'')='' or p_client_cpi<0 or p_quota<1 then raise exception 'Invalid project details'; end if;
  select * into target from public.projects p where p.project_code=upper(trim(p_project_code)) and public.can_operate_project(p.id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;
  previous:=to_jsonb(target);
  update public.projects p set project_name=trim(p_project_name),client_po=nullif(trim(p_client_po),''),project_type=nullif(trim(p_project_type),''),category=nullif(trim(p_category),''),client_cpi=p_client_cpi,quota=p_quota,end_date=p_end_date where p.id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(target.organization_id,auth.uid(),'PROJECT_UPDATED','PROJECT',target.id,jsonb_build_object('before',previous,'project_code',target.project_code));
  return query select target.id,target.project_code,target.status;
end $$;

revoke all on function public.create_project_with_market_v4(text,text,text,text,text,numeric,integer,text,text,integer,numeric,jsonb,text,text,jsonb) from public;
revoke all on function public.update_project_core_v4(text,text,text,text,text,numeric,integer,date) from public;
grant execute on function public.create_project_with_market_v4(text,text,text,text,text,numeric,integer,text,text,integer,numeric,jsonb,text,text,jsonb) to authenticated;
grant execute on function public.update_project_core_v4(text,text,text,text,text,numeric,integer,date) to authenticated;

create or replace function public.update_project_survey_setup(p_project_code text,p_survey_url text,p_test_survey_url text,p_survey_parameters jsonb)
returns table(project_id uuid,project_code text)
language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype;
begin
  if jsonb_typeof(coalesce(p_survey_parameters,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_survey_parameters,'[]'::jsonb))>30 then raise exception 'Invalid survey parameters'; end if;
  select * into target from public.projects p where p.project_code=upper(trim(p_project_code)) and public.can_operate_project(p.id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;
  update public.projects set survey_url=nullif(trim(p_survey_url),''),test_survey_url=nullif(trim(p_test_survey_url),''),survey_parameters=coalesce(p_survey_parameters,'[]'::jsonb) where id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(target.organization_id,auth.uid(),'PROJECT_SURVEY_SETUP_UPDATED','PROJECT',target.id,jsonb_build_object('project_code',target.project_code,'parameter_count',jsonb_array_length(coalesce(p_survey_parameters,'[]'::jsonb))));
  return query select target.id,target.project_code;
end $$;

revoke all on function public.update_project_survey_setup(text,text,text,jsonb) from public;
grant execute on function public.update_project_survey_setup(text,text,text,jsonb) to authenticated;

comment on column public.projects.test_survey_url is 'Optional test/UAT survey entry URL; test supplier clicks prefer it and fall back to survey_url.';
comment on column public.projects.survey_parameters is 'Open-ended survey query parameter mappings whose values support system and eligibility placeholders.';
