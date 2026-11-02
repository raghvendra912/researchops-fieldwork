-- Industry-standard fieldwork router hit audit logging and atomic single-transaction entry routing.
-- Logs every hit (accepted or rejected) into routing_hits.
-- Provides route_supplier_entry() to collapse multi-step sequential REST calls into one transaction.

create table if not exists public.routing_hits (
  id uuid primary key default gen_random_uuid(),
  click_id uuid not null,
  visitor_id text,
  stage text not null check (stage in ('ENTRY', 'CLIENT_RETURN', 'SUPPLIER_EXIT')),
  status text not null check (status in ('ACCEPTED', 'REJECTED', 'PROCESSED')),
  rejection_reason text,
  project_id uuid references public.projects(id) on delete set null,
  project_code text,
  supplier_id uuid references public.suppliers(id) on delete set null,
  project_supplier_id uuid references public.project_suppliers(id) on delete set null,
  respondent_ref text,
  session_id uuid references public.survey_sessions(id) on delete set null,
  ip_address inet,
  country_code text,
  region_code text,
  city text,
  asn text,
  device_type text,
  browser_type text,
  os_type text,
  user_agent text,
  target_url text,
  duration_ms integer,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_routing_hits_project_created on public.routing_hits(project_id, created_at desc);
create index if not exists idx_routing_hits_supplier_created on public.routing_hits(supplier_id, created_at desc);
create index if not exists idx_routing_hits_session_id on public.routing_hits(session_id);
create index if not exists idx_routing_hits_click_id on public.routing_hits(click_id);
create index if not exists idx_routing_hits_visitor_id on public.routing_hits(visitor_id, created_at desc);

alter table public.routing_hits enable row level security;

create policy "service role manages routing hits" on public.routing_hits
  for all to service_role using (true) with check (true);

create policy "members read organization routing hits" on public.routing_hits
  for select to authenticated
  using (
    project_id is null or exists (
      select 1 from public.projects p
      where p.id = routing_hits.project_id
        and public.is_organization_member(p.organization_id)
    )
  );

grant select, insert on public.routing_hits to service_role;
grant select on public.routing_hits to authenticated;

-- Fast hit recording RPC for ctx.waitUntil background tasks
create or replace function public.record_routing_hit(
  p_click_id uuid,
  p_visitor_id text,
  p_stage text,
  p_status text,
  p_rejection_reason text,
  p_project_id uuid,
  p_project_code text,
  p_supplier_id uuid,
  p_project_supplier_id uuid,
  p_respondent_ref text,
  p_session_id uuid,
  p_ip_address text,
  p_country_code text,
  p_region_code text,
  p_city text,
  p_asn text,
  p_device_type text,
  p_browser_type text,
  p_os_type text,
  p_user_agent text,
  p_target_url text,
  p_duration_ms integer,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_hit_id uuid;
  v_inet inet;
begin
  if p_ip_address is not null and trim(p_ip_address) <> '' then
    begin
      v_inet := trim(p_ip_address)::inet;
    exception when others then
      v_inet := null;
    end;
  end if;

  insert into public.routing_hits (
    click_id, visitor_id, stage, status, rejection_reason,
    project_id, project_code, supplier_id, project_supplier_id,
    respondent_ref, session_id, ip_address, country_code,
    region_code, city, asn, device_type, browser_type, os_type,
    user_agent, target_url, duration_ms, metadata, created_at
  ) values (
    p_click_id, p_visitor_id, p_stage, p_status, p_rejection_reason,
    p_project_id, p_project_code, p_supplier_id, p_project_supplier_id,
    p_respondent_ref, p_session_id, v_inet, p_country_code,
    p_region_code, p_city, p_asn, p_device_type, p_browser_type, p_os_type,
    p_user_agent, p_target_url, p_duration_ms, coalesce(p_metadata, '{}'::jsonb), now()
  ) returning id into v_hit_id;

  return v_hit_id;
end $$;

revoke all on function public.record_routing_hit(uuid,text,text,text,text,uuid,text,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text,text,integer,jsonb) from public;
grant execute on function public.record_routing_hit(uuid,text,text,text,text,uuid,text,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,text,text,integer,jsonb) to service_role;

-- Single-transaction atomic entry router
create or replace function public.route_supplier_entry(
  p_assignment_id uuid,
  p_supplier_token text,
  p_project_code text,
  p_respondent_ref text,
  p_visitor_id text,
  p_ip_address text,
  p_country_code text,
  p_region_code text,
  p_city text,
  p_asn text,
  p_device_type text,
  p_browser_type text,
  p_os_type text,
  p_is_test boolean,
  p_matching_quota_cell_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_supplier public.suppliers%rowtype;
  v_assignment public.project_suppliers%rowtype;
  v_project public.projects%rowtype;
  v_client_token text;
  v_session_id uuid;
  v_outcome_token uuid;
  v_reservation_id uuid;
  v_market_countries text[];
  v_country_match boolean := true;
  v_geo_status text := 'NOT_ENABLED';
  v_inet inet;
begin
  -- 1. Resolve Supplier & Assignment
  if p_assignment_id is not null then
    select * into v_assignment from public.project_suppliers where id = p_assignment_id;
    if not found then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'ASSIGNMENT_NOT_FOUND', 'message', 'Masked assignment link is invalid');
    end if;
    select * into v_supplier from public.suppliers where id = v_assignment.supplier_id;
    select * into v_project from public.projects where id = v_assignment.project_id;
  else
    if p_supplier_token is null or trim(p_supplier_token) = '' then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'MISSING_SUPPLIER_TOKEN', 'message', 'Supplier token is required');
    end if;

    select * into v_supplier from public.suppliers
    where redirect_token = p_supplier_token::uuid
       or redirect_token >= (p_supplier_token || '-0000-0000-0000-000000000000')::uuid
      and redirect_token <= (p_supplier_token || '-ffff-ffff-ffff-ffffffffffff')::uuid
    limit 1;

    if not found then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'SUPPLIER_NOT_FOUND', 'message', 'Supplier link is invalid');
    end if;

    if p_project_code is null or trim(p_project_code) = '' then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'MISSING_PROJECT_CODE', 'message', 'Project code is required');
    end if;

    select * into v_project from public.projects
    where organization_id = v_supplier.organization_id
      and project_code = upper(trim(p_project_code));

    if not found then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'PROJECT_NOT_FOUND', 'message', 'Project not found');
    end if;

    select * into v_assignment from public.project_suppliers
    where project_id = v_project.id and supplier_id = v_supplier.id;

    if not found then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'SUPPLIER_NOT_ASSIGNED', 'message', 'Supplier is not assigned to this project', 'supplier_terminate_url', v_supplier.terminate_url);
    end if;
  end if;

  -- 2. Verify Supplier Status
  if v_supplier.status <> 'ACTIVE' then
    return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'INACTIVE_SUPPLIER', 'message', 'Supplier is inactive', 'supplier_terminate_url', v_supplier.terminate_url);
  end if;

  -- 3. Verify Project & Assignment Traffic Status (for live traffic)
  if not coalesce(p_is_test, false) then
    if v_project.status <> 'LIVE' or v_assignment.status <> 'ACTIVE' then
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'PROJECT_NOT_LIVE', 'message', 'Project traffic is not active', 'supplier_terminate_url', coalesce(v_supplier.terminate_url, v_supplier.security_terminate_url));
    end if;
  end if;

  -- 4. Cross-supplier respondent reference collision check
  if exists (
    select 1 from public.survey_sessions
    where project_id = v_project.id
      and respondent_ref = trim(p_respondent_ref)
      and project_supplier_id is distinct from v_assignment.id
  ) then
    return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'CROSS_SUPPLIER_COLLISION', 'message', 'Respondent ID already used by another supplier', 'supplier_terminate_url', v_supplier.terminate_url);
  end if;

  -- 5. Geolocation Security Validation
  if coalesce(v_project.geo_security_enabled, false) then
    select array_agg(upper(country_code)) into v_market_countries
    from public.project_markets
    where project_id = v_project.id;

    if p_country_code is null or length(trim(p_country_code)) <> 2 then
      v_geo_status := 'UNKNOWN';
    elsif upper(trim(p_country_code)) = any(coalesce(v_market_countries, '{}'::text[])) then
      v_geo_status := 'MATCH';
    else
      v_geo_status := 'MISMATCH';
      return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', 'GEO_COUNTRY_MISMATCH', 'message', 'Respondent location does not match target market', 'supplier_terminate_url', coalesce(v_supplier.security_terminate_url, v_supplier.terminate_url));
    end if;
  end if;

  -- 6. Quota Reservation (atomic for live traffic)
  if not coalesce(p_is_test, false) then
    declare
      v_res record;
    begin
      select * into v_res from public.reserve_project_quota(
        v_supplier.organization_id,
        v_project.project_code,
        v_supplier.id,
        trim(p_respondent_ref),
        coalesce(p_matching_quota_cell_ids, '[]'::jsonb)
      );

      if not coalesce(v_res.allowed, false) then
        return jsonb_build_object('allowed', false, 'status', 'REJECTED', 'reason', coalesce(v_res.reason, 'QUOTA_FULL'), 'message', 'Quota is full for this project or quota cell', 'supplier_quota_full_url', coalesce(v_supplier.quota_full_url, v_supplier.terminate_url));
      end if;
      v_reservation_id := v_res.reservation_id;
    end;
  end if;

  -- 7. Create or Update Survey Session
  if p_ip_address is not null and trim(p_ip_address) <> '' then
    begin
      v_inet := trim(p_ip_address)::inet;
    exception when others then
      v_inet := null;
    end;
  end if;

  v_outcome_token := gen_random_uuid();

  insert into public.survey_sessions (
    organization_id, project_id, project_supplier_id, respondent_ref,
    status, is_test, outcome_token, ip_address, geo_country_code,
    geo_region_code, geo_city, geo_check_status, started_at
  ) values (
    v_supplier.organization_id, v_project.id, v_assignment.id, trim(p_respondent_ref),
    'START', coalesce(p_is_test, false), v_outcome_token, v_inet,
    nullif(upper(left(trim(p_country_code), 2)), ''),
    nullif(left(trim(p_region_code), 80), ''),
    nullif(left(trim(p_city), 120), ''),
    v_geo_status, now()
  )
  on conflict (project_id, project_supplier_id, respondent_ref) do update set
    status = 'START',
    is_test = survey_sessions.is_test or excluded.is_test,
    outcome_token = coalesce(survey_sessions.outcome_token, excluded.outcome_token),
    ip_address = coalesce(excluded.ip_address, survey_sessions.ip_address),
    geo_country_code = coalesce(excluded.geo_country_code, survey_sessions.geo_country_code),
    geo_check_status = excluded.geo_check_status
  returning id, outcome_token into v_session_id, v_outcome_token;

  -- Record START survey event
  insert into public.survey_events (
    organization_id, session_id, event_type, provider_transaction_id, occurred_at, metadata
  ) values (
    v_supplier.organization_id, v_session_id, 'START', 'START:' || trim(p_respondent_ref), now(),
    jsonb_build_object(
      'source', case when coalesce(p_is_test, false) then 'test-redirect' else 'redirect' end,
      'isTest', coalesce(p_is_test, false),
      'visitorId', p_visitor_id,
      'deviceType', p_device_type,
      'browserType', p_browser_type,
      'osType', p_os_type,
      'asn', p_asn
    )
  );

  -- Fetch client token
  select redirect_token into v_client_token from public.clients where id = v_project.client_id;

  -- 8. Return Success Payload with Complete Route Context
  return jsonb_build_object(
    'allowed', true,
    'status', 'ACCEPTED',
    'session_id', v_session_id,
    'outcome_token', v_outcome_token,
    'reservation_id', v_reservation_id,
    'project_id', v_project.id,
    'project_code', v_project.project_code,
    'supplier_id', v_supplier.id,
    'project_supplier_id', v_assignment.id,
    'survey_url', v_project.survey_url,
    'test_survey_url', v_project.test_survey_url,
    'survey_parameters', coalesce(v_project.survey_parameters, '[]'::jsonb),
    'client_token', v_client_token,
    'supplier_complete_url', v_supplier.complete_url,
    'supplier_terminate_url', v_supplier.terminate_url,
    'supplier_quota_full_url', v_supplier.quota_full_url,
    'supplier_security_terminate_url', v_supplier.security_terminate_url
  );
end $$;

revoke all on function public.route_supplier_entry(uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb) from public;
grant execute on function public.route_supplier_entry(uuid,text,text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb) to service_role;

notify pgrst, 'reload schema';
