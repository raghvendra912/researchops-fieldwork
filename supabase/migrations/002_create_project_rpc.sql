create sequence if not exists public.project_code_sequence start with 1049;
grant usage, select on sequence public.project_code_sequence to authenticated;

create or replace function public.create_project_with_market(
  p_project_name text,
  p_client_name text,
  p_client_po text,
  p_project_type text,
  p_category text,
  p_client_cpi numeric,
  p_quota integer,
  p_country_code text,
  p_language_code text,
  p_expected_loi_minutes integer,
  p_expected_ir numeric,
  p_start_date date,
  p_supplier_names text[]
)
returns table (project_id uuid, project_code text, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_client_id uuid;
  v_project public.projects;
begin
  select organization_id
  into v_organization_id
  from public.organization_members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'The signed-in user does not belong to an organization';
  end if;

  insert into public.clients (organization_id, name)
  values (v_organization_id, trim(p_client_name))
  on conflict (organization_id, name) do update set name = excluded.name
  returning id into v_client_id;

  insert into public.projects (
    organization_id,
    client_id,
    project_code,
    project_name,
    project_type,
    category,
    project_manager_id,
    client_po,
    client_cpi,
    quota,
    status,
    start_date
  ) values (
    v_organization_id,
    v_client_id,
    'PRJ-' || nextval('public.project_code_sequence')::text,
    trim(p_project_name),
    nullif(trim(p_project_type), ''),
    nullif(trim(p_category), ''),
    auth.uid(),
    nullif(trim(p_client_po), ''),
    p_client_cpi,
    p_quota,
    'DRAFT',
    p_start_date
  ) returning * into v_project;

  insert into public.project_markets (
    project_id,
    country_code,
    language_code,
    target_quota,
    expected_loi_minutes,
    expected_ir
  ) values (
    v_project.id,
    upper(trim(p_country_code)),
    lower(trim(p_language_code)),
    p_quota,
    p_expected_loi_minutes,
    p_expected_ir
  );

  insert into public.project_suppliers (project_id, supplier_id, target_quota)
  select v_project.id, supplier.id, p_quota
  from public.suppliers as supplier
  where supplier.organization_id = v_organization_id
    and supplier.name = any(coalesce(p_supplier_names, array[]::text[]))
  on conflict (project_id, supplier_id) do nothing;

  return query select v_project.id, v_project.project_code, v_project.status;
end;
$$;

revoke all on function public.create_project_with_market(text, text, text, text, text, numeric, integer, text, text, integer, numeric, date, text[]) from public;
grant execute on function public.create_project_with_market(text, text, text, text, text, numeric, integer, text, text, integer, numeric, date, text[]) to authenticated;

comment on function public.create_project_with_market is 'Creates a project, its first market and known supplier assignments in one RLS-protected transaction.';
