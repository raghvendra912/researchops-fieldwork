-- Migration 052: Record-level visibility, client team assignment, and scoped RLS (WS-G)
-- Enforces record-level visibility in Row Level Security: each user sees only
-- the clients, projects, and respondent data their profile and explicit grants permit.

-- 1. Client team assignments table
create table if not exists public.client_team_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('LEAD', 'MEMBER')),
  created_at timestamptz not null default now(),
  unique(client_id, user_id)
);

create index if not exists client_team_user_idx on public.client_team_assignments(user_id, client_id);
create index if not exists client_team_client_idx on public.client_team_assignments(client_id, user_id);

alter table public.client_team_assignments enable row level security;
drop policy if exists "members read client team assignments" on public.client_team_assignments;
create policy "members read client team assignments" on public.client_team_assignments
  for select to authenticated using (public.is_organization_member(organization_id));

drop policy if exists "admins manage client team assignments" on public.client_team_assignments;
create policy "admins manage client team assignments" on public.client_team_assignments
  for all to authenticated
  using (public.can_administer_organization(organization_id))
  with check (public.can_administer_organization(organization_id));

-- 2. Sharing rules table (organization-wide defaults and rule-based shares)
create table if not exists public.sharing_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type in ('PROJECT', 'CLIENT')),
  source_role text not null check (source_role in ('OWNER', 'ADMIN', 'PM', 'ANALYST', 'MEMBER')),
  target_role text not null check (target_role in ('OWNER', 'ADMIN', 'PM', 'ANALYST', 'MEMBER')),
  access_level text not null check (access_level in ('READ', 'EDIT')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sharing_rules_lookup_idx on public.sharing_rules(organization_id, entity_type, active);

alter table public.sharing_rules enable row level security;
drop policy if exists "members read sharing rules" on public.sharing_rules;
create policy "members read sharing rules" on public.sharing_rules
  for select to authenticated using (public.is_organization_member(organization_id));

drop policy if exists "admins manage sharing rules" on public.sharing_rules;
create policy "admins manage sharing rules" on public.sharing_rules
  for all to authenticated
  using (public.can_administer_organization(organization_id))
  with check (public.can_administer_organization(organization_id));

-- 3. Enhanced can_access_client function
create or replace function public.can_access_client(target_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.clients c
    join public.organization_members m on m.organization_id = c.organization_id and m.user_id = auth.uid()
    where c.id = target_client_id and (
      -- Owners and Admins see all clients in the workspace
      m.role in ('OWNER', 'ADMIN')
      -- Client-assigned team members
      or exists (
        select 1 from public.client_team_assignments cta
        where cta.client_id = c.id and cta.user_id = auth.uid()
      )
      -- Users with access to at least one project for this client
      or exists (
        select 1 from public.projects p
        where p.client_id = c.id and public.can_access_project(p.id)
      )
    )
  );
$$;

-- 4. Enhanced can_access_project function respecting secondary PM and sales assignments
create or replace function public.can_access_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id = p.organization_id and m.user_id = auth.uid()
    where p.id = target_project_id and (
      -- Owners and Admins have workspace-wide access
      m.role in ('OWNER', 'ADMIN')
      -- Primary PM
      or p.project_manager_id = auth.uid()
      -- Secondary PM (if column exists)
      or (p.secondary_project_manager_id is not null and p.secondary_project_manager_id = auth.uid())
      -- Sales owner
      or (p.sales_person_id is not null and p.sales_person_id = auth.uid())
      -- Explicit project access grant
      or exists (
        select 1 from public.project_access_grants g
        where g.project_id = p.id and g.user_id = auth.uid()
      )
      -- Client team lead has implicit project access
      or exists (
        select 1 from public.client_team_assignments cta
        where cta.client_id = p.client_id and cta.user_id = auth.uid() and cta.role = 'LEAD'
      )
    )
  );
$$;

-- 5. Scope RLS on projects table
drop policy if exists "members read projects" on public.projects;
drop policy if exists "scoped read projects" on public.projects;
create policy "scoped read projects" on public.projects
  for select to authenticated
  using (public.can_access_project(id));

-- 6. Scope RLS on survey_sessions table
drop policy if exists "members read survey sessions" on public.survey_sessions;
drop policy if exists "scoped read survey sessions" on public.survey_sessions;
create policy "scoped read survey sessions" on public.survey_sessions
  for select to authenticated
  using (public.can_access_project(project_id));

-- 7. Scope RLS on survey_events table
drop policy if exists "members read survey events" on public.survey_events;
drop policy if exists "scoped read survey events" on public.survey_events;
create policy "scoped read survey events" on public.survey_events
  for select to authenticated
  using (exists (
    select 1 from public.survey_sessions s
    where s.id = session_id and public.can_access_project(s.project_id)
  ));

-- 8. Scope RLS on clients table
drop policy if exists "members read clients" on public.clients;
drop policy if exists "scoped read clients" on public.clients;
create policy "scoped read clients" on public.clients
  for select to authenticated
  using (public.can_access_client(id));

notify pgrst, 'reload schema';

