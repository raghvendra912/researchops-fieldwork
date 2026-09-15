-- Secondary project management and sales ownership are assignments to existing
-- workspace members. Sales ownership does not grant financial permissions.
alter table public.projects
  add column secondary_project_manager_id uuid references public.user_profiles(id) on delete set null,
  add column sales_person_id uuid references public.user_profiles(id) on delete set null;

create index projects_secondary_manager_idx on public.projects(organization_id, secondary_project_manager_id)
  where secondary_project_manager_id is not null;
create index projects_sales_person_idx on public.projects(organization_id, sales_person_id)
  where sales_person_id is not null;

create or replace function public.validate_project_ownership()
returns trigger language plpgsql security definer set search_path=public as $$
declare secondary_role text; sales_role text; ownership_changed boolean;
begin
  ownership_changed := new.secondary_project_manager_id is distinct from old.secondary_project_manager_id
    or new.sales_person_id is distinct from old.sales_person_id;
  if not ownership_changed and new.project_manager_id is not distinct from old.project_manager_id
     and new.organization_id is not distinct from old.organization_id then return new; end if;
  if ownership_changed and coalesce(auth.role(),'') <> 'service_role'
     and not public.can_manage_project_access(old.id) then
    raise exception 'Project ownership administration denied';
  end if;
  if new.secondary_project_manager_id is not null then
    select role into secondary_role from public.organization_members
      where organization_id=new.organization_id and user_id=new.secondary_project_manager_id;
    if secondary_role <> 'PM' or secondary_role is null
       or new.secondary_project_manager_id=new.project_manager_id then
      raise exception 'Secondary manager must be a different workspace PM';
    end if;
  end if;
  if new.sales_person_id is not null then
    select role into sales_role from public.organization_members
      where organization_id=new.organization_id and user_id=new.sales_person_id;
    if sales_role is null then raise exception 'Sales person must belong to the workspace'; end if;
  end if;
  return new;
end $$;

create trigger projects_validate_ownership before update of secondary_project_manager_id,sales_person_id,project_manager_id,organization_id
on public.projects for each row execute function public.validate_project_ownership();

create or replace function public.audit_project_ownership()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.secondary_project_manager_id is distinct from new.secondary_project_manager_id
     or old.sales_person_id is distinct from new.sales_person_id then
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(new.organization_id,auth.uid(),'PROJECT_OWNERSHIP_UPDATED','PROJECT',new.id,
      jsonb_build_object('project_code',new.project_code,
        'previous_secondary_pm',old.secondary_project_manager_id,
        'secondary_pm',new.secondary_project_manager_id,
        'previous_sales_person',old.sales_person_id,
        'sales_person',new.sales_person_id));
  end if;
  return new;
end $$;

create trigger projects_audit_ownership after update of secondary_project_manager_id,sales_person_id
on public.projects for each row execute function public.audit_project_ownership();

create or replace function public.set_project_ownership(
  p_project_code text, p_secondary_manager_id uuid, p_sales_person_id uuid)
returns public.projects language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code)) for update;
  if not found or not public.can_manage_project_access(target.id) then
    raise exception 'Project ownership administration denied';
  end if;
  update public.projects set secondary_project_manager_id=p_secondary_manager_id,
    sales_person_id=p_sales_person_id where id=target.id returning * into target;
  return target;
end $$;

revoke all on function public.set_project_ownership(text,uuid,uuid) from public;
grant execute on function public.set_project_ownership(text,uuid,uuid) to authenticated;

create or replace function public.can_operate_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (
      m.role in ('OWNER','ADMIN')
      or (m.role='PM' and (p.project_manager_id=auth.uid()
        or p.secondary_project_manager_id=auth.uid()
        or exists(select 1 from public.project_access_grants g where g.project_id=p.id
          and g.user_id=auth.uid() and g.access_role='EDITOR')))
    )
  );
$$;

create or replace function public.can_review_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (
      m.role in ('OWNER','ADMIN')
      or (m.role='PM' and (p.project_manager_id=auth.uid()
        or p.secondary_project_manager_id=auth.uid()
        or exists(select 1 from public.project_access_grants g where g.project_id=p.id and g.user_id=auth.uid())))
      or (m.role='ANALYST' and exists(select 1 from public.project_access_grants g
        where g.project_id=p.id and g.user_id=auth.uid() and g.access_role='REVIEWER'))
    )
  );
$$;

revoke all on function public.can_operate_project(uuid), public.can_review_project(uuid) from public;
grant execute on function public.can_operate_project(uuid), public.can_review_project(uuid) to authenticated;
