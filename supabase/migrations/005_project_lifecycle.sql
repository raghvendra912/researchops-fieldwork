create policy "operators write audit logs" on public.audit_logs
for insert to authenticated
with check (
  actor_user_id = auth.uid()
  and public.can_operate_organization(organization_id)
);

create or replace function public.update_project_core(
  p_project_code text,
  p_project_name text,
  p_client_po text,
  p_project_type text,
  p_category text,
  p_client_cpi numeric,
  p_quota integer,
  p_start_date date,
  p_end_date date
)
returns table (project_id uuid, project_code text, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  target public.projects%rowtype;
  previous jsonb;
begin
  if coalesce(trim(p_project_name), '') = '' or p_client_cpi < 0 or p_quota < 1 then
    raise exception 'Invalid project details';
  end if;

  select * into target from public.projects p
  where p.project_code = p_project_code
    and public.can_operate_organization(p.organization_id)
  for update;
  if not found then raise exception 'Project not found or access denied'; end if;

  previous := jsonb_build_object(
    'project_name', target.project_name, 'client_po', target.client_po,
    'project_type', target.project_type, 'category', target.category,
    'client_cpi', target.client_cpi, 'quota', target.quota,
    'start_date', target.start_date, 'end_date', target.end_date
  );

  update public.projects p set
    project_name = trim(p_project_name), client_po = nullif(trim(p_client_po), ''),
    project_type = nullif(trim(p_project_type), ''), category = nullif(trim(p_category), ''),
    client_cpi = p_client_cpi, quota = p_quota, start_date = p_start_date, end_date = p_end_date
  where p.id = target.id;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (target.organization_id, auth.uid(), 'PROJECT_UPDATED', 'PROJECT', target.id,
    jsonb_build_object('before', previous, 'project_code', target.project_code));

  return query select target.id, target.project_code, target.status;
end;
$$;

create or replace function public.transition_project_state(p_project_code text, p_next_status text)
returns table (project_id uuid, project_code text, previous_status text, status text)
language plpgsql
security invoker
set search_path = public
as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects p
  where p.project_code = p_project_code
    and public.can_operate_organization(p.organization_id)
  for update;
  if not found then raise exception 'Project not found or access denied'; end if;

  if not (
    (target.status = 'DRAFT' and p_next_status = 'PENDING') or
    (target.status = 'PENDING' and p_next_status in ('DRAFT', 'LIVE')) or
    (target.status = 'LIVE' and p_next_status in ('PAUSED', 'CLOSED')) or
    (target.status = 'PAUSED' and p_next_status in ('LIVE', 'CLOSED'))
  ) then raise exception 'Invalid project status transition'; end if;

  update public.projects p set status = p_next_status where p.id = target.id;
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (target.organization_id, auth.uid(), 'PROJECT_STATUS_CHANGED', 'PROJECT', target.id,
    jsonb_build_object('project_code', target.project_code, 'from', target.status, 'to', p_next_status));
  return query select target.id, target.project_code, target.status, p_next_status;
end;
$$;

revoke all on function public.update_project_core(text,text,text,text,text,numeric,integer,date,date) from public;
revoke all on function public.transition_project_state(text,text) from public;
grant execute on function public.update_project_core(text,text,text,text,text,numeric,integer,date,date) to authenticated;
grant execute on function public.transition_project_state(text,text) to authenticated;
