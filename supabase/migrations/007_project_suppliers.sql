create or replace function public.replace_project_suppliers(p_project_code text, p_assignments jsonb)
returns table (id uuid, supplier_id uuid, supplier_name text, supplier_project_id text, supplier_cpi numeric, target_quota integer, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare target public.projects%rowtype;
begin
  if jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) > 100 then raise exception 'Invalid assignments'; end if;
  select * into target from public.projects p where p.project_code = p_project_code
    and public.can_operate_organization(p.organization_id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_assignments) as a(supplier_id uuid, supplier_project_id text, supplier_cpi numeric, target_quota integer, status text)
    left join public.suppliers s on s.id = a.supplier_id and s.organization_id = target.organization_id
    where s.id is null or a.supplier_cpi < 0 or a.target_quota < 1 or a.status not in ('PENDING','ACTIVE','PAUSED','CLOSED')
  ) then raise exception 'Invalid supplier assignment'; end if;
  if (select count(*) from jsonb_to_recordset(p_assignments) as a(supplier_id uuid)) <>
     (select count(distinct a.supplier_id) from jsonb_to_recordset(p_assignments) as a(supplier_id uuid))
  then raise exception 'Duplicate supplier assignment'; end if;

  delete from public.project_suppliers ps where ps.project_id = target.id;
  insert into public.project_suppliers (project_id, supplier_id, supplier_project_id, supplier_cpi, target_quota, status)
  select target.id, a.supplier_id, nullif(trim(a.supplier_project_id), ''), a.supplier_cpi, a.target_quota, a.status
  from jsonb_to_recordset(p_assignments) as a(supplier_id uuid, supplier_project_id text, supplier_cpi numeric, target_quota integer, status text);

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (target.organization_id, auth.uid(), 'PROJECT_SUPPLIERS_REPLACED', 'PROJECT', target.id,
    jsonb_build_object('project_code', target.project_code, 'assignments', p_assignments));

  return query select ps.id, ps.supplier_id, s.name, ps.supplier_project_id, ps.supplier_cpi, ps.target_quota, ps.status
  from public.project_suppliers ps join public.suppliers s on s.id = ps.supplier_id
  where ps.project_id = target.id order by s.name;
end;
$$;

revoke all on function public.replace_project_suppliers(text,jsonb) from public;
grant execute on function public.replace_project_suppliers(text,jsonb) to authenticated;
