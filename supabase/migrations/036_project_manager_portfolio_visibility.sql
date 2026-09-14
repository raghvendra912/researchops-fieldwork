create or replace function public.can_access_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (
      m.role in ('OWNER','ADMIN','PM')
      or exists(
        select 1 from public.project_access_grants g
        where g.project_id=p.id and g.user_id=auth.uid()
      )
    )
  );
$$;

revoke all on function public.can_access_project(uuid) from public;
grant execute on function public.can_access_project(uuid) to authenticated;

comment on function public.can_access_project(uuid) is
'OWNER, ADMIN, and PM roles can see the full organization portfolio. ANALYST and MEMBER roles see only projects explicitly granted to them.';
