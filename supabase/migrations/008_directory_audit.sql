create or replace function public.audit_directory_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  organization uuid := coalesce(new.organization_id, old.organization_id);
  entity uuid := coalesce(new.id, old.id);
begin
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    organization, auth.uid(), upper(tg_table_name) || '_' || tg_op, upper(tg_table_name), entity,
    jsonb_build_object('before', case when tg_op = 'INSERT' then null else to_jsonb(old) end,
                       'after', case when tg_op = 'DELETE' then null else to_jsonb(new) end)
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_project_created()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (new.organization_id, auth.uid(), 'PROJECT_CREATED', 'PROJECT', new.id,
    jsonb_build_object('project_code', new.project_code, 'status', new.status));
  return new;
end;
$$;

create trigger clients_audit_change after insert or update or delete on public.clients
for each row execute function public.audit_directory_change();
create trigger suppliers_audit_change after insert or update or delete on public.suppliers
for each row execute function public.audit_directory_change();
create trigger projects_audit_created after insert on public.projects
for each row execute function public.audit_project_created();
