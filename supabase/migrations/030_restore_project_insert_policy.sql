-- Restore the narrow project-create policy after the project-scoped RLS rollout.
-- The API and this policy both restrict creation to OWNER, ADMIN and PM members.
drop policy if exists "operators create projects" on public.projects;
create policy "operators create projects" on public.projects
for insert to authenticated
with check (public.can_operate_organization(organization_id));

select pg_notify('pgrst', 'reload schema');
