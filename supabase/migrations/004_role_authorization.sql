create or replace function public.organization_role(target_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.organization_members
  where organization_id = target_organization_id and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_operate_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.organization_role(target_organization_id) in ('OWNER', 'ADMIN', 'PM'), false);
$$;

create or replace function public.can_administer_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.organization_role(target_organization_id) in ('OWNER', 'ADMIN'), false);
$$;

revoke all on function public.organization_role(uuid) from public;
revoke all on function public.can_operate_organization(uuid) from public;
revoke all on function public.can_administer_organization(uuid) from public;
grant execute on function public.organization_role(uuid) to authenticated;
grant execute on function public.can_operate_organization(uuid) to authenticated;
grant execute on function public.can_administer_organization(uuid) to authenticated;

drop policy if exists "members manage clients" on public.clients;
create policy "members read clients" on public.clients for select to authenticated using (public.is_organization_member(organization_id));
create policy "operators create clients" on public.clients for insert to authenticated with check (public.can_operate_organization(organization_id));
create policy "operators update clients" on public.clients for update to authenticated using (public.can_operate_organization(organization_id)) with check (public.can_operate_organization(organization_id));
create policy "admins delete clients" on public.clients for delete to authenticated using (public.can_administer_organization(organization_id));

drop policy if exists "members manage suppliers" on public.suppliers;
create policy "members read suppliers" on public.suppliers for select to authenticated using (public.is_organization_member(organization_id));
create policy "operators create suppliers" on public.suppliers for insert to authenticated with check (public.can_operate_organization(organization_id));
create policy "operators update suppliers" on public.suppliers for update to authenticated using (public.can_operate_organization(organization_id)) with check (public.can_operate_organization(organization_id));
create policy "admins delete suppliers" on public.suppliers for delete to authenticated using (public.can_administer_organization(organization_id));

drop policy if exists "members manage projects" on public.projects;
create policy "members read projects" on public.projects for select to authenticated using (public.is_organization_member(organization_id));
create policy "operators create projects" on public.projects for insert to authenticated with check (public.can_operate_organization(organization_id));
create policy "operators update projects" on public.projects for update to authenticated using (public.can_operate_organization(organization_id)) with check (public.can_operate_organization(organization_id));
create policy "admins delete projects" on public.projects for delete to authenticated using (public.can_administer_organization(organization_id));

drop policy if exists "members manage project markets" on public.project_markets;
create policy "members read project markets" on public.project_markets for select to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy "operators create project markets" on public.project_markets for insert to authenticated
with check (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)));
create policy "operators update project markets" on public.project_markets for update to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)));
create policy "admins delete project markets" on public.project_markets for delete to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.can_administer_organization(p.organization_id)));

drop policy if exists "members manage project suppliers" on public.project_suppliers;
create policy "members read project suppliers" on public.project_suppliers for select to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy "operators create project suppliers" on public.project_suppliers for insert to authenticated
with check (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)));
create policy "operators update project suppliers" on public.project_suppliers for update to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.can_operate_organization(p.organization_id)));
create policy "admins delete project suppliers" on public.project_suppliers for delete to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.can_administer_organization(p.organization_id)));

comment on function public.can_operate_organization is 'Server and RLS permission shared by OWNER, ADMIN, and PM roles.';
