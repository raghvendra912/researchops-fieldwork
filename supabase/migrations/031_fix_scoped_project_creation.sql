-- Avoid INSERT ... RETURNING * on projects: after scoped read policies were
-- introduced, RETURNING also requires the new row to pass SELECT RLS during
-- the same statement. Generate the identifiers first and return local values.
create or replace function public.create_project_with_market_v4(
  p_project_name text,p_client_name text,p_client_po text,p_project_type text,p_category text,
  p_client_cpi numeric,p_quota integer,p_country_code text,p_language_code text,
  p_expected_loi_minutes integer,p_expected_ir numeric,p_supplier_assignments jsonb,
  p_survey_url text,p_test_survey_url text,p_survey_parameters jsonb
)
returns table(project_id uuid,project_code text,status text)
language plpgsql security invoker set search_path=public as $$
declare
  v_organization_id uuid;
  v_client_id uuid;
  v_manager_name text;
  v_project_id uuid := gen_random_uuid();
  v_project_code text;
  v_status text := 'PENDING';
begin
  select om.organization_id into v_organization_id
  from public.organization_members om
  where om.user_id=auth.uid()
  order by om.created_at limit 1;
  if v_organization_id is null then raise exception 'The signed-in user does not belong to an organization'; end if;
  if not public.can_operate_organization(v_organization_id) then raise exception 'The workspace role cannot create projects'; end if;
  select id into v_client_id from public.clients where organization_id=v_organization_id and name=trim(p_client_name);
  if v_client_id is null then raise exception 'Select an existing client'; end if;
  if jsonb_typeof(coalesce(p_survey_parameters,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_survey_parameters,'[]'::jsonb))>30 then raise exception 'Invalid survey parameters'; end if;
  if jsonb_typeof(coalesce(p_supplier_assignments,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_supplier_assignments,'[]'::jsonb))>100 then raise exception 'Invalid supplier assignments'; end if;
  select display_name into v_manager_name from public.user_profiles where id=auth.uid();
  v_project_code := 'ROP-'||nextval('public.project_code_sequence')::text;

  insert into public.projects(
    id,organization_id,client_id,project_code,project_name,project_type,category,
    project_manager_id,project_manager_name,client_po,client_cpi,quota,status,
    start_date,survey_url,test_survey_url,survey_parameters
  ) values(
    v_project_id,v_organization_id,v_client_id,v_project_code,trim(p_project_name),
    nullif(trim(p_project_type),''),nullif(trim(p_category),''),auth.uid(),
    coalesce(v_manager_name,'Team member'),nullif(trim(p_client_po),''),p_client_cpi,
    p_quota,v_status,current_date,nullif(trim(p_survey_url),''),
    nullif(trim(p_test_survey_url),''),coalesce(p_survey_parameters,'[]'::jsonb)
  );

  insert into public.project_markets(project_id,country_code,language_code,target_quota,expected_loi_minutes,expected_ir)
  values(v_project_id,upper(trim(p_country_code)),lower(trim(p_language_code)),p_quota,p_expected_loi_minutes,p_expected_ir);
  insert into public.project_suppliers(project_id,supplier_id,supplier_cpi,target_quota,status)
  select v_project_id,s.id,greatest(0,coalesce(a.supplier_cpi,0)),p_quota,'PENDING'
  from jsonb_to_recordset(coalesce(p_supplier_assignments,'[]'::jsonb)) a(name text,supplier_cpi numeric)
  join public.suppliers s on s.organization_id=v_organization_id and s.name=a.name
  on conflict on constraint project_suppliers_project_id_supplier_id_key do nothing;

  return query select v_project_id,v_project_code,v_status;
end $$;

revoke all on function public.create_project_with_market_v4(text,text,text,text,text,numeric,integer,text,text,integer,numeric,jsonb,text,text,jsonb) from public;
grant execute on function public.create_project_with_market_v4(text,text,text,text,text,numeric,integer,text,text,integer,numeric,jsonb,text,text,jsonb) to authenticated;
select pg_notify('pgrst', 'reload schema');
