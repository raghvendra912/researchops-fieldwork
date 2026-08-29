create extension if not exists "pgcrypto";

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('OWNER', 'ADMIN', 'PM', 'ANALYST', 'MEMBER')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_organization_id and user_id = auth.uid()
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, code)
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  supplier_type text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, code)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  project_code text not null,
  project_name text not null,
  project_type text,
  category text,
  project_manager_id uuid references auth.users(id) on delete set null,
  client_po text,
  client_cpi numeric(12,2) check (client_cpi >= 0),
  quota integer check (quota > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING', 'LIVE', 'PAUSED', 'CLOSED')),
  start_date date,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, project_code),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.project_markets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  country_code text not null,
  language_code text not null default 'en',
  target_quota integer not null check (target_quota > 0),
  expected_loi_minutes integer check (expected_loi_minutes > 0),
  expected_ir numeric(5,2) check (expected_ir between 0 and 100),
  created_at timestamptz not null default now(),
  unique (project_id, country_code, language_code)
);

create table public.project_suppliers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_project_id text,
  supplier_cpi numeric(12,2) check (supplier_cpi >= 0),
  target_quota integer check (target_quota > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'ACTIVE', 'PAUSED', 'CLOSED')),
  created_at timestamptz not null default now(),
  unique (project_id, supplier_id)
);

create table public.survey_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  project_supplier_id uuid references public.project_suppliers(id) on delete set null,
  respondent_ref text not null,
  status text not null default 'START',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (project_id, respondent_ref)
);

create table public.survey_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.survey_sessions(id) on delete cascade,
  event_type text not null check (event_type in ('START', 'REACHED_CLIENT', 'COMPLETE', 'TERMINATE', 'QUOTA_FULL', 'QUALITY_TERMINATE', 'ABANDON')),
  provider_transaction_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (session_id, event_type, provider_transaction_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index projects_organization_status_idx on public.projects (organization_id, status);
create index survey_sessions_project_status_idx on public.survey_sessions (project_id, status);
create index survey_events_session_occurred_idx on public.survey_events (session_id, occurred_at desc);
create index audit_logs_organization_created_idx on public.audit_logs (organization_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch_updated_at before update on public.projects
for each row execute function public.touch_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.clients enable row level security;
alter table public.suppliers enable row level security;
alter table public.projects enable row level security;
alter table public.project_markets enable row level security;
alter table public.project_suppliers enable row level security;
alter table public.survey_sessions enable row level security;
alter table public.survey_events enable row level security;
alter table public.audit_logs enable row level security;

create policy "members can read organizations" on public.organizations for select to authenticated using (public.is_organization_member(id));
create policy "members can read memberships" on public.organization_members for select to authenticated using (public.is_organization_member(organization_id));

create policy "members manage clients" on public.clients for all to authenticated
using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "members manage suppliers" on public.suppliers for all to authenticated
using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "members manage projects" on public.projects for all to authenticated
using (public.is_organization_member(organization_id)) with check (public.is_organization_member(organization_id));
create policy "members manage project markets" on public.project_markets for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy "members manage project suppliers" on public.project_suppliers for all to authenticated
using (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)))
with check (exists (select 1 from public.projects p where p.id = project_id and public.is_organization_member(p.organization_id)));
create policy "members read survey sessions" on public.survey_sessions for select to authenticated using (public.is_organization_member(organization_id));
create policy "members read survey events" on public.survey_events for select to authenticated using (public.is_organization_member(organization_id));
create policy "members read audit logs" on public.audit_logs for select to authenticated using (public.is_organization_member(organization_id));

comment on table public.survey_events is 'Append-only operational event ledger. Provider callbacks should insert through trusted server code.';
