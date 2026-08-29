alter table public.projects add column if not exists project_manager_name text;

update public.projects p
set project_manager_name = coalesce(p.project_manager_name, up.display_name)
from public.user_profiles up
where up.id = p.project_manager_id and p.project_manager_name is null;

update public.projects set status = 'PENDING' where status = 'DRAFT';
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects add constraint projects_status_check
check (status in ('PENDING', 'LIVE', 'PAUSED', 'ID_SUBMITTED', 'INVOICED', 'CLOSED'));

create or replace function public.create_project_with_market_v3(
  p_project_name text, p_client_name text, p_client_po text, p_project_type text, p_category text,
  p_client_cpi numeric, p_quota integer, p_country_code text, p_language_code text,
  p_expected_loi_minutes integer, p_expected_ir numeric, p_supplier_names text[],
  p_survey_url text, p_security_terminate_url text
)
returns table (project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare v_organization_id uuid; v_client_id uuid; v_manager_name text; v_project public.projects;
begin
  select om.organization_id into v_organization_id from public.organization_members om where om.user_id=auth.uid() order by om.created_at limit 1;
  if v_organization_id is null then raise exception 'The signed-in user does not belong to an organization'; end if;
  if not public.can_operate_organization(v_organization_id) then raise exception 'The workspace role cannot create projects'; end if;
  select id into v_client_id from public.clients where organization_id=v_organization_id and name=trim(p_client_name);
  if v_client_id is null then raise exception 'Select an existing client'; end if;
  select display_name into v_manager_name from public.user_profiles where id=auth.uid();
  insert into public.projects(organization_id,client_id,project_code,project_name,project_type,category,project_manager_id,project_manager_name,client_po,client_cpi,quota,status,start_date,survey_url,security_terminate_url)
  values(v_organization_id,v_client_id,'ROP-'||nextval('public.project_code_sequence')::text,trim(p_project_name),nullif(trim(p_project_type),''),nullif(trim(p_category),''),auth.uid(),coalesce(v_manager_name,'Team member'),nullif(trim(p_client_po),''),p_client_cpi,p_quota,'PENDING',current_date,nullif(trim(p_survey_url),''),nullif(trim(p_security_terminate_url),''))
  returning * into v_project;
  insert into public.project_markets(project_id,country_code,language_code,target_quota,expected_loi_minutes,expected_ir)
  values(v_project.id,upper(trim(p_country_code)),lower(trim(p_language_code)),p_quota,p_expected_loi_minutes,p_expected_ir);
  insert into public.project_suppliers(project_id,supplier_id,target_quota,status)
  select v_project.id,s.id,p_quota,'PENDING' from public.suppliers s where s.organization_id=v_organization_id and s.name=any(coalesce(p_supplier_names,array[]::text[]))
  on conflict on constraint project_suppliers_project_id_supplier_id_key do nothing;
  return query select v_project.id,v_project.project_code,v_project.status;
end $$;

create or replace function public.transition_project_state(p_project_code text, p_next_status text)
returns table (project_id uuid, project_code text, previous_status text, status text)
language plpgsql security invoker set search_path = public as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects p
  where p.project_code = p_project_code and public.can_operate_organization(p.organization_id)
  for update;
  if not found then raise exception 'Project not found or access denied'; end if;
  if not (
    (target.status = 'PENDING' and p_next_status = 'LIVE') or
    (target.status = 'LIVE' and p_next_status in ('PAUSED', 'ID_SUBMITTED')) or
    (target.status = 'PAUSED' and p_next_status in ('LIVE', 'ID_SUBMITTED')) or
    (target.status = 'ID_SUBMITTED' and p_next_status in ('INVOICED', 'LIVE')) or
    (target.status = 'INVOICED' and p_next_status = 'CLOSED')
  ) then raise exception 'Invalid project status transition'; end if;
  update public.projects p set status = p_next_status where p.id = target.id;
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (target.organization_id, auth.uid(), 'PROJECT_STATUS_CHANGED', 'PROJECT', target.id,
    jsonb_build_object('project_code', target.project_code, 'from', target.status, 'to', p_next_status));
  return query select target.id, target.project_code, target.status, p_next_status;
end $$;

revoke all on function public.create_project_with_market_v3(text,text,text,text,text,numeric,integer,text,text,integer,numeric,text[],text,text) from public;
revoke all on function public.transition_project_state(text,text) from public;
grant execute on function public.create_project_with_market_v3(text,text,text,text,text,numeric,integer,text,text,integer,numeric,text[],text,text) to authenticated;
grant execute on function public.transition_project_state(text,text) to authenticated;
