alter table public.projects
  add column complete_url text,
  add column terminate_url text,
  add column quota_full_url text;

alter table public.projects
  add constraint projects_complete_url_valid check (complete_url is null or (length(complete_url) <= 2048 and complete_url ~ '^https?://')),
  add constraint projects_terminate_url_valid check (terminate_url is null or (length(terminate_url) <= 2048 and terminate_url ~ '^https?://')),
  add constraint projects_quota_full_url_valid check (quota_full_url is null or (length(quota_full_url) <= 2048 and quota_full_url ~ '^https?://'));

create function public.create_project_with_market_v2(
  p_project_name text, p_client_name text, p_client_po text, p_project_type text, p_category text,
  p_client_cpi numeric, p_quota integer, p_country_code text, p_language_code text,
  p_expected_loi_minutes integer, p_expected_ir numeric, p_start_date date, p_supplier_names text[],
  p_complete_url text, p_terminate_url text, p_quota_full_url text
)
returns table (project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare v_organization_id uuid; v_client_id uuid; v_project public.projects;
begin
  select om.organization_id into v_organization_id from public.organization_members om where om.user_id=auth.uid() order by om.created_at limit 1;
  if v_organization_id is null then raise exception 'The signed-in user does not belong to an organization'; end if;
  if not public.can_operate_organization(v_organization_id) then raise exception 'The workspace role cannot create projects'; end if;
  insert into public.clients(organization_id,name) values(v_organization_id,trim(p_client_name))
    on conflict(organization_id,name) do update set name=excluded.name returning id into v_client_id;
  insert into public.projects(organization_id,client_id,project_code,project_name,project_type,category,project_manager_id,client_po,client_cpi,quota,status,start_date,complete_url,terminate_url,quota_full_url)
  values(v_organization_id,v_client_id,'PRJ-'||nextval('public.project_code_sequence')::text,trim(p_project_name),nullif(trim(p_project_type),''),nullif(trim(p_category),''),auth.uid(),nullif(trim(p_client_po),''),p_client_cpi,p_quota,'DRAFT',p_start_date,nullif(trim(p_complete_url),''),nullif(trim(p_terminate_url),''),nullif(trim(p_quota_full_url),''))
  returning * into v_project;
  insert into public.project_markets(project_id,country_code,language_code,target_quota,expected_loi_minutes,expected_ir)
  values(v_project.id,upper(trim(p_country_code)),lower(trim(p_language_code)),p_quota,p_expected_loi_minutes,p_expected_ir);
  insert into public.project_suppliers(project_id,supplier_id,target_quota)
  select v_project.id,s.id,p_quota from public.suppliers s where s.organization_id=v_organization_id and s.name=any(coalesce(p_supplier_names,array[]::text[]))
  on conflict on constraint project_suppliers_project_id_supplier_id_key do nothing;
  return query select v_project.id,v_project.project_code,v_project.status;
end $$;

create function public.update_project_core_v2(
  p_project_code text, p_project_name text, p_client_po text, p_project_type text, p_category text,
  p_client_cpi numeric, p_quota integer, p_start_date date, p_end_date date,
  p_complete_url text, p_terminate_url text, p_quota_full_url text
)
returns table (project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare target public.projects%rowtype; previous jsonb;
begin
  if coalesce(trim(p_project_name), '') = '' or p_client_cpi < 0 or p_quota < 1 then raise exception 'Invalid project details'; end if;
  select * into target from public.projects p where p.project_code=p_project_code and public.can_operate_organization(p.organization_id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;
  previous := jsonb_build_object('project_name',target.project_name,'client_po',target.client_po,'project_type',target.project_type,'category',target.category,'client_cpi',target.client_cpi,'quota',target.quota,'start_date',target.start_date,'end_date',target.end_date,'complete_url',target.complete_url,'terminate_url',target.terminate_url,'quota_full_url',target.quota_full_url);
  update public.projects p set project_name=trim(p_project_name),client_po=nullif(trim(p_client_po),''),project_type=nullif(trim(p_project_type),''),category=nullif(trim(p_category),''),client_cpi=p_client_cpi,quota=p_quota,start_date=p_start_date,end_date=p_end_date,complete_url=nullif(trim(p_complete_url),''),terminate_url=nullif(trim(p_terminate_url),''),quota_full_url=nullif(trim(p_quota_full_url),'') where p.id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(target.organization_id,auth.uid(),'PROJECT_UPDATED','PROJECT',target.id,jsonb_build_object('before',previous,'project_code',target.project_code));
  return query select target.id,target.project_code,target.status;
end $$;

revoke all on function public.create_project_with_market_v2(text,text,text,text,text,numeric,integer,text,text,integer,numeric,date,text[],text,text,text) from public;
revoke all on function public.update_project_core_v2(text,text,text,text,text,numeric,integer,date,date,text,text,text) from public;
grant execute on function public.create_project_with_market_v2(text,text,text,text,text,numeric,integer,text,text,integer,numeric,date,text[],text,text,text) to authenticated;
grant execute on function public.update_project_core_v2(text,text,text,text,text,numeric,integer,date,date,text,text,text) to authenticated;
