-- Marketplace supply (Plan A): import survey inventory from sample marketplaces,
-- route our own suppliers' traffic into those surveys, and track revenue, supplier
-- cost, reversals, and margin per confirmed complete.
--
-- Written to be safely re-runnable from the SQL editor (see the 039 retry lesson):
-- every object uses IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS.
-- Marketplace secrets are never stored here; config.secretEnv only NAMES the
-- Worker environment variable that holds the signing secret.

create table if not exists public.marketplaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null check (length(trim(name)) between 2 and 80),
  provider text not null default 'GENERIC' check (provider in ('GENERIC','CINT','PURESPECTRUM','DYNATA','TOLUNA','OTHER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','PAUSED')),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  reversal_window_days integer check (reversal_window_days is null or reversal_window_days between 0 and 365),
  config jsonb not null default '{}'::jsonb check (
    jsonb_typeof(config) = 'object'
    and (config->>'secretEnv' is null or config->>'secretEnv' ~ '^MARKETPLACE_[A-Z0-9_]{1,40}_SECRET$')
  ),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.marketplace_surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  marketplace_id uuid not null references public.marketplaces(id) on delete cascade,
  external_id text not null check (length(external_id) between 1 and 120),
  title text not null check (length(trim(title)) between 1 and 300),
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  language_code text check (language_code is null or language_code ~ '^[a-z]{2,8}(-[A-Za-z0-9]{2,8})*$'),
  cpi numeric(12,2) not null check (cpi >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  loi_minutes integer check (loi_minutes is null or loi_minutes >= 1),
  incidence_pct numeric(5,2) check (incidence_pct is null or incidence_pct between 0 and 100),
  conversion_pct numeric(5,2) check (conversion_pct is null or conversion_pct between 0 and 100),
  quota_remaining integer check (quota_remaining is null or quota_remaining >= 0),
  status text not null default 'OPEN' check (status in ('OPEN','PAUSED','CLOSED')),
  entry_url text check (entry_url is null or (length(entry_url) <= 2048 and entry_url ~ '^https?://')),
  qualifications jsonb not null default '[]'::jsonb check (jsonb_typeof(qualifications) = 'array'),
  quotas jsonb not null default '[]'::jsonb check (jsonb_typeof(quotas) = 'array'),
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  unique (marketplace_id, external_id)
);
create index if not exists marketplace_surveys_open_idx
  on public.marketplace_surveys(organization_id, status, country_code, cpi desc);

create table if not exists public.marketplace_qualification_map (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  marketplace_id uuid not null references public.marketplaces(id) on delete cascade,
  external_code text not null check (length(external_code) between 1 and 80),
  variable_key text not null check (variable_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  operator_default text not null default 'IN' check (operator_default in ('EQ','NE','IN','NOT_IN','GTE','LTE','BETWEEN')),
  value_map jsonb not null default '{}'::jsonb check (jsonb_typeof(value_map) = 'object'),
  created_at timestamptz not null default now(),
  unique (marketplace_id, external_code)
);

alter table public.projects
  add column if not exists marketplace_survey_id uuid references public.marketplace_surveys(id) on delete set null,
  add column if not exists cpi_currency text not null default 'USD';
alter table public.projects drop constraint if exists projects_cpi_currency_valid;
alter table public.projects add constraint projects_cpi_currency_valid check (cpi_currency ~ '^[A-Z]{3}$');
create unique index if not exists projects_marketplace_survey_key
  on public.projects(marketplace_survey_id) where marketplace_survey_id is not null;

-- One revenue row and one supplier-cost row per complete, plus an optional
-- reversal row per kind. Amounts are stored in the project currency with no FX
-- or tax assumption (FIN-01 commercial rules are still undecided).
create table if not exists public.finance_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id uuid not null references public.survey_sessions(id) on delete cascade,
  project_supplier_id uuid references public.project_suppliers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  marketplace_id uuid references public.marketplaces(id) on delete set null,
  kind text not null check (kind in ('REVENUE','SUPPLIER_COST')),
  entry_type text not null check (entry_type in ('COMPLETE','REVERSAL')),
  amount numeric(14,2) not null check (amount >= 0),
  signed_amount numeric(14,2) generated always as (case when entry_type = 'REVERSAL' then -amount else amount end) stored,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'PENDING' check (status in ('PENDING','CONFIRMED','REVERSED')),
  occurred_at timestamptz not null default now(),
  confirmed_at timestamptz,
  reason text check (reason is null or length(reason) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id, kind, entry_type)
);
create index if not exists finance_ledger_project_idx on public.finance_ledger_entries(organization_id, project_id, occurred_at desc);
create index if not exists finance_ledger_marketplace_idx on public.finance_ledger_entries(marketplace_id, supplier_id);
create index if not exists finance_ledger_pending_idx on public.finance_ledger_entries(occurred_at)
  where status = 'PENDING' and entry_type = 'COMPLETE';

drop trigger if exists marketplaces_touch_updated_at on public.marketplaces;
create trigger marketplaces_touch_updated_at before update on public.marketplaces
for each row execute function public.touch_updated_at();

alter table public.marketplaces enable row level security;
alter table public.marketplace_surveys enable row level security;
alter table public.marketplace_qualification_map enable row level security;
alter table public.finance_ledger_entries enable row level security;

-- Commercial data (CPI, revenue, margin) is visible to operators only; sales
-- ownership and analyst/member roles do not grant financial visibility.
drop policy if exists "operators read marketplaces" on public.marketplaces;
create policy "operators read marketplaces" on public.marketplaces for select to authenticated
  using (public.can_operate_organization(organization_id));
drop policy if exists "admins manage marketplaces" on public.marketplaces;
create policy "admins manage marketplaces" on public.marketplaces for all to authenticated
  using (public.can_administer_organization(organization_id))
  with check (public.can_administer_organization(organization_id));

drop policy if exists "operators read marketplace surveys" on public.marketplace_surveys;
create policy "operators read marketplace surveys" on public.marketplace_surveys for select to authenticated
  using (public.can_operate_organization(organization_id));

drop policy if exists "operators read qualification map" on public.marketplace_qualification_map;
create policy "operators read qualification map" on public.marketplace_qualification_map for select to authenticated
  using (public.can_operate_organization(organization_id));
drop policy if exists "admins manage qualification map" on public.marketplace_qualification_map;
create policy "admins manage qualification map" on public.marketplace_qualification_map for all to authenticated
  using (public.can_administer_organization(organization_id))
  with check (public.can_administer_organization(organization_id));

drop policy if exists "operators read finance ledger" on public.finance_ledger_entries;
create policy "operators read finance ledger" on public.finance_ledger_entries for select to authenticated
  using (public.can_operate_organization(organization_id));

grant select on public.marketplaces, public.marketplace_surveys, public.marketplace_qualification_map,
  public.finance_ledger_entries to authenticated;
grant insert, update, delete on public.marketplaces, public.marketplace_qualification_map to authenticated;

-- ---------------------------------------------------------------------------
-- Marketplaces
-- ---------------------------------------------------------------------------

create or replace function public.create_marketplace(
  p_name text, p_provider text, p_currency text, p_reversal_window_days integer, p_config jsonb
)
returns table(new_marketplace_id uuid, new_client_id uuid)
language plpgsql security invoker set search_path = public as $$
declare
  v_org uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_client uuid;
  v_marketplace uuid := gen_random_uuid();
begin
  select om.organization_id into v_org from public.organization_members om
  where om.user_id = auth.uid() order by om.created_at limit 1;
  if v_org is null then raise exception 'The signed-in user does not belong to an organization'; end if;
  if not public.can_administer_organization(v_org) then raise exception 'Only workspace owners and admins can add marketplaces'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Marketplace name must be 2-80 characters'; end if;
  -- The marketplace acts as the "client" of every imported project, so it owns
  -- the client end links (/r/client/<token>/<outcome>) the marketplace redirects to.
  select c.id into v_client from public.clients c where c.organization_id = v_org and c.name = v_name;
  if v_client is null then
    v_client := gen_random_uuid();
    insert into public.clients(id, organization_id, name, status) values (v_client, v_org, v_name, 'ACTIVE');
  end if;
  insert into public.marketplaces(id, organization_id, client_id, name, provider, currency, reversal_window_days, config)
  values (v_marketplace, v_org, v_client, v_name, upper(coalesce(nullif(trim(p_provider), ''), 'GENERIC')),
    upper(coalesce(nullif(trim(p_currency), ''), 'USD')), p_reversal_window_days, coalesce(p_config, '{}'::jsonb));
  insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'MARKETPLACE_CREATED', 'MARKETPLACE', v_marketplace, jsonb_build_object('name', v_name));
  return query select v_marketplace, v_client;
end $$;
revoke all on function public.create_marketplace(text,text,text,integer,jsonb) from public;
grant execute on function public.create_marketplace(text,text,text,integer,jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Survey inventory
-- ---------------------------------------------------------------------------

-- Pauses LIVE projects whose marketplace survey is closed or paused so suppliers
-- stop sending traffic into a survey that can no longer pay. Internal helper:
-- called by the sync and maintenance functions below, never directly by users.
create or replace function public.pause_projects_for_unavailable_surveys(p_marketplace_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_paused integer := 0;
begin
  with paused as (
    update public.projects p set status = 'PAUSED'
    from public.marketplace_surveys ms
    where p.marketplace_survey_id = ms.id and p.status = 'LIVE' and ms.status in ('CLOSED','PAUSED')
      and (p_marketplace_id is null or ms.marketplace_id = p_marketplace_id)
    returning p.id, p.organization_id, p.project_code, ms.status as survey_status
  ), logged as (
    insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    select organization_id, auth.uid(), 'PROJECT_PAUSED_MARKETPLACE_SURVEY', 'PROJECT', id,
      jsonb_build_object('project_code', project_code, 'survey_status', survey_status)
    from paused
    returning 1
  )
  select count(*)::integer into v_paused from paused;
  return v_paused;
end $$;
revoke all on function public.pause_projects_for_unavailable_surveys(uuid) from public, anon, authenticated;
grant execute on function public.pause_projects_for_unavailable_surveys(uuid) to service_role;

create or replace function public.upsert_marketplace_surveys(
  p_marketplace_id uuid, p_surveys jsonb, p_full_snapshot boolean default false
)
returns table(inserted_count integer, updated_count integer, closed_count integer, paused_projects integer)
language plpgsql security definer set search_path = public as $$
declare
  m public.marketplaces%rowtype;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_closed integer := 0;
  v_paused integer := 0;
begin
  select * into m from public.marketplaces where id = p_marketplace_id;
  if not found then raise exception 'Marketplace not found'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_operate_organization(m.organization_id) then
    raise exception 'Marketplace access denied';
  end if;
  if m.status <> 'ACTIVE' then raise exception 'Marketplace is paused'; end if;
  if jsonb_typeof(p_surveys) <> 'array' or jsonb_array_length(p_surveys) > 500 then
    raise exception 'Provide up to 500 surveys per sync';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_surveys) as s(
      external_id text, title text, country_code text, language_code text, cpi numeric, currency text,
      loi_minutes integer, incidence_pct numeric, conversion_pct numeric, quota_remaining integer,
      status text, entry_url text, qualifications jsonb, quotas jsonb)
    where s.external_id is null or length(trim(s.external_id)) not between 1 and 120
      or s.title is null or length(trim(s.title)) not between 1 and 300
      or s.cpi is null or s.cpi < 0
      or coalesce(s.status, 'OPEN') not in ('OPEN','PAUSED','CLOSED')
      or (s.country_code is not null and s.country_code !~ '^[A-Za-z]{2}$')
      or (s.language_code is not null and s.language_code !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$')
      or (s.currency is not null and s.currency !~ '^[A-Za-z]{3}$')
      or (s.loi_minutes is not null and s.loi_minutes < 1)
      or (s.incidence_pct is not null and s.incidence_pct not between 0 and 100)
      or (s.conversion_pct is not null and s.conversion_pct not between 0 and 100)
      or (s.quota_remaining is not null and s.quota_remaining < 0)
      or (s.entry_url is not null and (length(s.entry_url) > 2048 or s.entry_url !~ '^https?://'))
      or (s.qualifications is not null and jsonb_typeof(s.qualifications) <> 'array')
      or (s.quotas is not null and jsonb_typeof(s.quotas) <> 'array')
  ) then raise exception 'Invalid survey inventory'; end if;
  if (select count(*) from jsonb_to_recordset(p_surveys) as s(external_id text))
     <> (select count(distinct trim(s.external_id)) from jsonb_to_recordset(p_surveys) as s(external_id text)) then
    raise exception 'Duplicate survey identifiers in the sync';
  end if;

  with upserted as (
    insert into public.marketplace_surveys(
      organization_id, marketplace_id, external_id, title, country_code, language_code, cpi, currency,
      loi_minutes, incidence_pct, conversion_pct, quota_remaining, status, entry_url, qualifications, quotas)
    select m.organization_id, m.id, trim(s.external_id), trim(s.title), upper(s.country_code), lower(s.language_code),
      s.cpi, upper(coalesce(s.currency, m.currency)), s.loi_minutes, s.incidence_pct, s.conversion_pct,
      s.quota_remaining, coalesce(s.status, 'OPEN'), nullif(trim(s.entry_url), ''),
      coalesce(s.qualifications, '[]'::jsonb), coalesce(s.quotas, '[]'::jsonb)
    from jsonb_to_recordset(p_surveys) as s(
      external_id text, title text, country_code text, language_code text, cpi numeric, currency text,
      loi_minutes integer, incidence_pct numeric, conversion_pct numeric, quota_remaining integer,
      status text, entry_url text, qualifications jsonb, quotas jsonb)
    on conflict (marketplace_id, external_id) do update set
      title = excluded.title, country_code = excluded.country_code, language_code = excluded.language_code,
      cpi = excluded.cpi, currency = excluded.currency, loi_minutes = excluded.loi_minutes,
      incidence_pct = excluded.incidence_pct, conversion_pct = excluded.conversion_pct,
      quota_remaining = excluded.quota_remaining, status = excluded.status, entry_url = excluded.entry_url,
      qualifications = excluded.qualifications, quotas = excluded.quotas, last_synced_at = now()
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted)::integer, count(*) filter (where not was_inserted)::integer
  into v_inserted, v_updated from upserted;

  -- A full snapshot lists every survey the marketplace still offers, so anything
  -- missing from it has been withdrawn.
  if p_full_snapshot then
    update public.marketplace_surveys ms set status = 'CLOSED', last_synced_at = now()
    where ms.marketplace_id = m.id and ms.status <> 'CLOSED'
      and not exists (
        select 1 from jsonb_to_recordset(p_surveys) as s(external_id text) where trim(s.external_id) = ms.external_id);
    get diagnostics v_closed = row_count;
  end if;

  v_paused := public.pause_projects_for_unavailable_surveys(m.id);
  update public.marketplaces set last_synced_at = now() where id = m.id;
  return query select v_inserted, v_updated, v_closed, v_paused;
end $$;
revoke all on function public.upsert_marketplace_surveys(uuid,jsonb,boolean) from public;
grant execute on function public.upsert_marketplace_surveys(uuid,jsonb,boolean) to authenticated, service_role;

-- Creates a PENDING project from a marketplace survey in one transaction. The
-- marketplace is the project client, the survey's entry URL becomes the client
-- survey URL, and mapped qualifications become eligibility rules. Qualifications
-- without a mapping are returned so the operator can decide how to screen them.
create or replace function public.import_marketplace_survey(
  p_survey_id uuid, p_project_name text, p_quota integer, p_supplier_assignments jsonb
)
returns table(new_project_id uuid, new_project_code text, new_status text, mapped_rules integer, unmapped_codes text[])
language plpgsql security invoker set search_path = public as $$
declare
  ms public.marketplace_surveys%rowtype;
  m public.marketplaces%rowtype;
  v_manager_name text;
  v_project_id uuid := gen_random_uuid();
  v_project_code text;
  v_quota integer;
  v_rules integer := 0;
  v_unmapped text[];
  v_assignments jsonb := coalesce(p_supplier_assignments, '[]'::jsonb);
begin
  select * into ms from public.marketplace_surveys where id = p_survey_id;
  if not found then raise exception 'Marketplace survey not found or access denied'; end if;
  select * into m from public.marketplaces where id = ms.marketplace_id;
  if not public.can_operate_organization(ms.organization_id) then raise exception 'The workspace role cannot create projects'; end if;
  if m.status <> 'ACTIVE' then raise exception 'Marketplace is paused'; end if;
  if ms.status <> 'OPEN' then raise exception 'Only open marketplace surveys can be imported'; end if;
  if m.client_id is null then raise exception 'Link a client record to this marketplace before importing'; end if;
  if ms.country_code is null or ms.language_code is null then raise exception 'The survey needs a country and language before it can be imported'; end if;
  if exists (select 1 from public.projects p where p.marketplace_survey_id = ms.id) then
    raise exception 'This marketplace survey has already been imported';
  end if;
  v_quota := coalesce(p_quota, ms.quota_remaining);
  if v_quota is null or v_quota < 1 then raise exception 'Provide a target quota of at least 1'; end if;
  if jsonb_typeof(v_assignments) <> 'array' or jsonb_array_length(v_assignments) > 100 then raise exception 'Invalid supplier assignments'; end if;
  if (select count(*) from jsonb_to_recordset(v_assignments) as a(supplier_id uuid))
     <> (select count(distinct a.supplier_id) from jsonb_to_recordset(v_assignments) as a(supplier_id uuid)) then
    raise exception 'Duplicate supplier assignment';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_assignments) as a(supplier_id uuid, supplier_cpi numeric)
    left join public.suppliers s on s.id = a.supplier_id and s.organization_id = ms.organization_id
    where s.id is null or a.supplier_cpi is null or a.supplier_cpi < 0
  ) then raise exception 'Invalid supplier assignment'; end if;
  if exists (
    select 1 from jsonb_to_recordset(v_assignments) as a(supplier_cpi numeric) where a.supplier_cpi > ms.cpi
  ) then raise exception 'Supplier CPI exceeds the marketplace CPI; the project would lose money on every complete'; end if;

  select display_name into v_manager_name from public.user_profiles where id = auth.uid();
  v_project_code := 'ROP-' || nextval('public.project_code_sequence')::text;

  insert into public.projects(
    id, organization_id, client_id, project_code, project_name, project_type, project_manager_id,
    project_manager_name, client_cpi, quota, status, start_date, survey_url, marketplace_survey_id, cpi_currency)
  values (
    v_project_id, ms.organization_id, m.client_id, v_project_code,
    left(coalesce(nullif(trim(p_project_name), ''), ms.title), 200), 'Marketplace', auth.uid(),
    coalesce(v_manager_name, 'Team member'), ms.cpi, v_quota, 'PENDING', current_date, ms.entry_url, ms.id, ms.currency);

  insert into public.project_markets(project_id, country_code, language_code, target_quota, expected_loi_minutes, expected_ir)
  values (v_project_id, ms.country_code, ms.language_code, v_quota, coalesce(ms.loi_minutes, 1), coalesce(ms.incidence_pct, 0));

  insert into public.project_suppliers(project_id, supplier_id, supplier_cpi, target_quota, status)
  select v_project_id, a.supplier_id, a.supplier_cpi, v_quota, 'PENDING'
  from jsonb_to_recordset(v_assignments) as a(supplier_id uuid, supplier_cpi numeric);

  with quals as (
    select q.code, q.operator, q.values, q.qpos
    from rows from (jsonb_to_recordset(ms.qualifications) as (code text, operator text, values jsonb))
      with ordinality as q(code, operator, values, qpos)
  ), mapped as (
    select distinct on (mp.variable_key)
      mp.variable_key,
      case when q.operator in ('EQ','NE','IN','NOT_IN','GTE','LTE','BETWEEN') then q.operator else mp.operator_default end as operator,
      case when jsonb_typeof(q.values) = 'array' then coalesce((
        select jsonb_agg(coalesce(mp.value_map ->> v.val, v.val) order by v.ord)
        from jsonb_array_elements_text(q.values) with ordinality as v(val, ord)), '[]'::jsonb)
      else '[]'::jsonb end as vals,
      q.qpos
    from quals q
    join public.marketplace_qualification_map mp on mp.marketplace_id = ms.marketplace_id and mp.external_code = q.code
    order by mp.variable_key, q.qpos
  ), inserted as (
    insert into public.project_eligibility_rules(organization_id, project_id, variable_key, operator, values, required, active, sort_order)
    select ms.organization_id, v_project_id, mp.variable_key, mp.operator, mp.vals, true, true,
      least(1000, (row_number() over (order by mp.qpos))::integer)
    from mapped mp
    where jsonb_array_length(mp.vals) between 1 and 50
      and (mp.operator <> 'BETWEEN' or jsonb_array_length(mp.vals) = 2)
    returning 1
  ) select count(*)::integer into v_rules from inserted;

  select array_agg(distinct q.code order by q.code) into v_unmapped
  from jsonb_to_recordset(ms.qualifications) as q(code text)
  where q.code is not null and not exists (
    select 1 from public.marketplace_qualification_map mp where mp.marketplace_id = ms.marketplace_id and mp.external_code = q.code);

  insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (ms.organization_id, auth.uid(), 'MARKETPLACE_SURVEY_IMPORTED', 'PROJECT', v_project_id,
    jsonb_build_object('project_code', v_project_code, 'marketplace', m.name, 'external_id', ms.external_id, 'cpi', ms.cpi));

  return query select v_project_id, v_project_code, 'PENDING'::text, v_rules, coalesce(v_unmapped, '{}'::text[]);
end $$;
revoke all on function public.import_marketplace_survey(uuid,text,integer,jsonb) from public;
grant execute on function public.import_marketplace_survey(uuid,text,integer,jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Finance ledger
-- ---------------------------------------------------------------------------

-- Every non-test complete earns revenue at the project CPI and owes the supplier
-- at the assignment CPI. Marketplace completes start PENDING until confirmed by
-- the marketplace (or its reversal window passes); direct-client completes are
-- confirmed immediately.
create or replace function public.post_complete_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  proj public.projects%rowtype;
  v_marketplace uuid;
  v_supplier uuid;
  v_supplier_cpi numeric;
  v_status text;
begin
  if new.status <> 'COMPLETE' or new.is_test then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'COMPLETE' then return new; end if;
  select * into proj from public.projects where id = new.project_id;
  if not found then return new; end if;
  select ms.marketplace_id into v_marketplace from public.marketplace_surveys ms where ms.id = proj.marketplace_survey_id;
  v_status := case when proj.marketplace_survey_id is null then 'CONFIRMED' else 'PENDING' end;
  select ps.supplier_id, ps.supplier_cpi into v_supplier, v_supplier_cpi
  from public.project_suppliers ps where ps.id = new.project_supplier_id;

  if proj.client_cpi is not null then
    insert into public.finance_ledger_entries(organization_id, project_id, session_id, project_supplier_id, supplier_id,
      marketplace_id, kind, entry_type, amount, currency, status, occurred_at, confirmed_at)
    values (new.organization_id, new.project_id, new.id, new.project_supplier_id, v_supplier, v_marketplace,
      'REVENUE', 'COMPLETE', proj.client_cpi, proj.cpi_currency, v_status, coalesce(new.completed_at, now()),
      case when v_status = 'CONFIRMED' then now() end)
    on conflict (session_id, kind, entry_type) do nothing;
  end if;
  if v_supplier_cpi is not null then
    insert into public.finance_ledger_entries(organization_id, project_id, session_id, project_supplier_id, supplier_id,
      marketplace_id, kind, entry_type, amount, currency, status, occurred_at, confirmed_at)
    values (new.organization_id, new.project_id, new.id, new.project_supplier_id, v_supplier, v_marketplace,
      'SUPPLIER_COST', 'COMPLETE', v_supplier_cpi, proj.cpi_currency, v_status, coalesce(new.completed_at, now()),
      case when v_status = 'CONFIRMED' then now() end)
    on conflict (session_id, kind, entry_type) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists survey_sessions_post_ledger on public.survey_sessions;
create trigger survey_sessions_post_ledger after insert or update of status on public.survey_sessions
for each row execute function public.post_complete_to_ledger();
revoke all on function public.post_complete_to_ledger() from public, anon, authenticated;

create or replace function public.confirm_ledger_entries(p_session_ids uuid[])
returns table(confirmed_count integer)
language plpgsql security definer set search_path = public as $$
declare v_count integer := 0;
begin
  if coalesce(array_length(p_session_ids, 1), 0) not between 1 and 500 then raise exception 'Provide 1-500 sessions'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and exists (
    select 1 from public.survey_sessions s where s.id = any(p_session_ids) and not public.can_operate_organization(s.organization_id)
  ) then raise exception 'Finance access denied'; end if;
  update public.finance_ledger_entries e set status = 'CONFIRMED', confirmed_at = now()
  where e.session_id = any(p_session_ids) and e.entry_type = 'COMPLETE' and e.status = 'PENDING';
  get diagnostics v_count = row_count;
  return query select v_count;
end $$;
revoke all on function public.confirm_ledger_entries(uuid[]) from public;
grant execute on function public.confirm_ledger_entries(uuid[]) to authenticated, service_role;

create or replace function public.reverse_session_ledger(p_session_id uuid, p_reason text)
returns table(reversed_entries integer, reversed_revenue numeric, reversed_cost numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_entries integer := 0;
  v_revenue numeric := 0;
  v_cost numeric := 0;
begin
  select s.organization_id into v_org from public.survey_sessions s where s.id = p_session_id;
  if v_org is null then raise exception 'Session not found'; end if;
  if coalesce(auth.role(), '') <> 'service_role' and not public.can_operate_organization(v_org) then
    raise exception 'Finance access denied';
  end if;
  with reversed as (
    insert into public.finance_ledger_entries(organization_id, project_id, session_id, project_supplier_id, supplier_id,
      marketplace_id, kind, entry_type, amount, currency, status, occurred_at, confirmed_at, reason, created_by)
    select e.organization_id, e.project_id, e.session_id, e.project_supplier_id, e.supplier_id, e.marketplace_id,
      e.kind, 'REVERSAL', e.amount, e.currency, 'CONFIRMED', now(), now(),
      left(coalesce(nullif(trim(p_reason), ''), 'Reversed'), 500), auth.uid()
    from public.finance_ledger_entries e where e.session_id = p_session_id and e.entry_type = 'COMPLETE'
    on conflict (session_id, kind, entry_type) do nothing
    returning kind, amount
  )
  select count(*)::integer, coalesce(sum(amount) filter (where kind = 'REVENUE'), 0),
    coalesce(sum(amount) filter (where kind = 'SUPPLIER_COST'), 0)
  into v_entries, v_revenue, v_cost from reversed;
  if v_entries > 0 then
    update public.finance_ledger_entries set status = 'REVERSED'
    where session_id = p_session_id and entry_type = 'COMPLETE';
    insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
    values (v_org, auth.uid(), 'SESSION_LEDGER_REVERSED', 'SESSION', p_session_id,
      jsonb_build_object('reason', left(coalesce(p_reason, ''), 500), 'revenue', v_revenue, 'cost', v_cost));
  end if;
  return query select v_entries, v_revenue, v_cost;
end $$;
revoke all on function public.reverse_session_ledger(uuid,text) from public;
grant execute on function public.reverse_session_ledger(uuid,text) to authenticated, service_role;

create or replace function public.finance_summary(
  p_from timestamptz default null, p_to timestamptz default null, p_project_code text default null
)
returns table(
  project_id uuid, project_code text, project_name text, marketplace_name text, currency text,
  completes bigint, reversals bigint, revenue numeric, supplier_cost numeric, margin numeric,
  pending_revenue numeric, confirmed_revenue numeric)
language sql stable security invoker set search_path = public as $$
  select p.id, p.project_code, p.project_name, m.name, e.currency,
    count(*) filter (where e.kind = 'REVENUE' and e.entry_type = 'COMPLETE'),
    count(*) filter (where e.kind = 'REVENUE' and e.entry_type = 'REVERSAL'),
    coalesce(sum(e.signed_amount) filter (where e.kind = 'REVENUE'), 0),
    coalesce(sum(e.signed_amount) filter (where e.kind = 'SUPPLIER_COST'), 0),
    coalesce(sum(e.signed_amount) filter (where e.kind = 'REVENUE'), 0)
      - coalesce(sum(e.signed_amount) filter (where e.kind = 'SUPPLIER_COST'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'REVENUE' and e.entry_type = 'COMPLETE' and e.status = 'PENDING'), 0),
    coalesce(sum(e.amount) filter (where e.kind = 'REVENUE' and e.entry_type = 'COMPLETE' and e.status = 'CONFIRMED'), 0)
  from public.finance_ledger_entries e
  join public.projects p on p.id = e.project_id
  left join public.marketplaces m on m.id = e.marketplace_id
  where (p_from is null or e.occurred_at >= p_from)
    and (p_to is null or e.occurred_at < p_to)
    and (p_project_code is null or p.project_code = p_project_code)
  group by p.id, p.project_code, p.project_name, m.name, e.currency
  order by p.project_code, e.currency;
$$;
revoke all on function public.finance_summary(timestamptz,timestamptz,text) from public;
grant execute on function public.finance_summary(timestamptz,timestamptz,text) to authenticated, service_role;

-- Marketplaces score suppliers on conversion and reversal rate; our own margin
-- depends on earnings per click.
create or replace function public.marketplace_supplier_kpis(p_marketplace_id uuid default null)
returns table(
  marketplace_id uuid, marketplace_name text, supplier_id uuid, supplier_name text, currency text,
  starts bigint, completes bigint, reversals bigint, conversion_pct numeric, reversal_rate_pct numeric,
  revenue numeric, supplier_cost numeric, margin numeric, earnings_per_click numeric)
language sql stable security invoker set search_path = public as $$
  with traffic as (
    select m.id as mid, m.name as mname, ps.supplier_id as sid, sup.name as sname, p.cpi_currency as cur,
      count(*) as starts, count(*) filter (where ss.status = 'COMPLETE') as completes
    from public.survey_sessions ss
    join public.projects p on p.id = ss.project_id and p.marketplace_survey_id is not null
    join public.marketplace_surveys msv on msv.id = p.marketplace_survey_id
    join public.marketplaces m on m.id = msv.marketplace_id
    join public.project_suppliers ps on ps.id = ss.project_supplier_id
    join public.suppliers sup on sup.id = ps.supplier_id
    where not ss.is_test and (p_marketplace_id is null or m.id = p_marketplace_id)
    group by m.id, m.name, ps.supplier_id, sup.name, p.cpi_currency
  ), money as (
    select e.marketplace_id as mid, e.supplier_id as sid, e.currency as cur,
      count(*) filter (where e.kind = 'REVENUE' and e.entry_type = 'REVERSAL') as reversals,
      coalesce(sum(e.signed_amount) filter (where e.kind = 'REVENUE'), 0) as revenue,
      coalesce(sum(e.signed_amount) filter (where e.kind = 'SUPPLIER_COST'), 0) as cost
    from public.finance_ledger_entries e
    where e.marketplace_id is not null and e.supplier_id is not null
    group by e.marketplace_id, e.supplier_id, e.currency
  )
  select t.mid, t.mname, t.sid, t.sname, t.cur, t.starts, t.completes, coalesce(x.reversals, 0),
    round(100.0 * t.completes / nullif(t.starts, 0), 2),
    round(100.0 * coalesce(x.reversals, 0) / nullif(t.completes, 0), 2),
    coalesce(x.revenue, 0), coalesce(x.cost, 0), coalesce(x.revenue, 0) - coalesce(x.cost, 0),
    round(coalesce(x.revenue, 0) / nullif(t.starts, 0), 4)
  from traffic t left join money x on x.mid = t.mid and x.sid = t.sid and x.cur = t.cur
  order by t.mname, t.sname;
$$;
revoke all on function public.marketplace_supplier_kpis(uuid) from public;
grant execute on function public.marketplace_supplier_kpis(uuid) to authenticated, service_role;

-- Entry point for the scheduled maintenance job (service role only): confirm
-- marketplace completes whose reversal window has passed, and pause LIVE projects
-- whose marketplace survey has closed or paused so suppliers stop sending traffic.
create or replace function public.maintain_marketplace_supply(p_now timestamptz default now())
returns table(confirmed_entries integer, paused_projects integer)
language plpgsql security definer set search_path = public as $$
declare
  v_confirmed integer := 0;
  v_paused integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Marketplace maintenance is restricted to the service role';
  end if;
  update public.finance_ledger_entries e set status = 'CONFIRMED', confirmed_at = p_now
  from public.marketplaces m
  where e.marketplace_id = m.id and e.entry_type = 'COMPLETE' and e.status = 'PENDING'
    and m.reversal_window_days is not null
    and e.occurred_at + make_interval(days => m.reversal_window_days) <= p_now;
  get diagnostics v_confirmed = row_count;

  v_paused := public.pause_projects_for_unavailable_surveys(null);
  return query select v_confirmed, v_paused;
end $$;
revoke all on function public.maintain_marketplace_supply(timestamptz) from public, anon, authenticated;
grant execute on function public.maintain_marketplace_supply(timestamptz) to service_role;

-- Make the new tables and functions visible to PostgREST immediately.
notify pgrst, 'reload schema';
