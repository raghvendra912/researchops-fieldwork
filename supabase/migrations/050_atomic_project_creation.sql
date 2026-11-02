-- Migration 050: Atomic project creation, project cloning, and archiving (WS-E)
-- Provides single-transaction atomic project creation wrapping project, markets,
-- geo-security, and metadata setup, preventing partial project state on failure.

-- 1. Atomic project creation
create or replace function public.create_project_atomic(
  p_project_name text,
  p_client_name text,
  p_client_po text,
  p_type text,
  p_category text,
  p_client_cpi numeric,
  p_currency text,
  p_survey_url text,
  p_test_survey_url text,
  p_survey_parameters jsonb,
  p_supplier_assignments jsonb,
  p_markets jsonb,
  p_geo_security_enabled boolean default false,
  p_reference_setup jsonb default '{}'::jsonb
)
returns table(project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare
  v_project_id uuid;
  v_project_code text;
  v_status text;
  v_first_market jsonb;
begin
  -- Validate markets array
  if jsonb_typeof(p_markets) <> 'array' or jsonb_array_length(p_markets) < 1 then
    raise exception 'At least one market is required';
  end if;

  v_first_market := p_markets->0;

  -- 1. Create base project with first market using existing v4 function
  select cp.project_id, cp.project_code, cp.status
  into v_project_id, v_project_code, v_status
  from public.create_project_with_market_v4(
    p_project_name,
    p_client_name,
    p_client_po,
    p_type,
    p_category,
    p_client_cpi,
    coalesce(nullif(trim(p_currency), ''), 'USD'),
    coalesce((v_first_market->>'targetQuota')::integer, (v_first_market->>'target_quota')::integer, 100),
    coalesce(v_first_market->>'countryCode', v_first_market->>'country_code', 'US'),
    coalesce(v_first_market->>'languageCode', v_first_market->>'language_code', 'en'),
    coalesce((v_first_market->>'expectedLoiMinutes')::integer, (v_first_market->>'expected_loi_minutes')::integer, 10),
    coalesce((v_first_market->>'expectedIr')::numeric, (v_first_market->>'expected_ir')::numeric, 50.0),
    p_supplier_assignments,
    p_survey_url,
    p_test_survey_url,
    p_survey_parameters
  ) cp;

  -- 2. If multiple markets provided, replace markets atomically
  if jsonb_array_length(p_markets) > 1 then
    perform public.replace_project_markets(
      v_project_code,
      (select jsonb_agg(jsonb_build_object(
        'country_code', coalesce(m->>'countryCode', m->>'country_code'),
        'language_code', coalesce(m->>'languageCode', m->>'language_code'),
        'target_quota', coalesce((m->>'targetQuota')::integer, (m->>'target_quota')::integer, 1),
        'expected_loi_minutes', coalesce((m->>'expectedLoiMinutes')::integer, (m->>'expected_loi_minutes')::integer, 10),
        'expected_ir', coalesce((m->>'expectedIr')::numeric, (m->>'expected_ir')::numeric, 50.0)
      )) from jsonb_array_elements(p_markets) m)
    );
  end if;

  -- 3. Configure geo security if requested
  if coalesce(p_geo_security_enabled, false) then
    perform public.configure_project_geo_security(v_project_code, true);
  end if;

  -- 4. Apply reference setup metadata if provided
  if p_reference_setup is not null and p_reference_setup <> '{}'::jsonb then
    update public.projects
    set field_period = nullif(trim(coalesce(p_reference_setup->>'field_period', '')), ''),
        target_audience = nullif(trim(coalesce(p_reference_setup->>'target_audience', '')), ''),
        sample_provider = nullif(trim(coalesce(p_reference_setup->>'sample_provider', '')), ''),
        end_client = nullif(trim(coalesce(p_reference_setup->>'end_client', '')), '')
    where id = v_project_id;
  end if;

  return query select v_project_id, v_project_code, v_status;
end $$;

-- 2. Project clone function
create or replace function public.clone_project(p_project_code text, p_new_name text)
returns table(project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare
  source public.projects%rowtype;
  new_proj record;
  markets_json jsonb;
  assignments_json jsonb;
begin
  select * into source from public.projects where project_code = upper(trim(p_project_code));
  if not found then raise exception 'Source project not found'; end if;
  if not public.can_operate_project(source.id) then raise exception 'Project operator access required'; end if;

  select jsonb_agg(jsonb_build_object(
    'countryCode', country_code,
    'languageCode', language_code,
    'targetQuota', target_quota,
    'expectedLoiMinutes', expected_loi_minutes,
    'expectedIr', expected_ir
  )) into markets_json
  from public.project_markets where project_id = source.id;

  select jsonb_agg(jsonb_build_object(
    'supplierId', ps.supplier_id,
    'supplierCpi', ps.supplier_cpi,
    'targetQuota', ps.target_quota,
    'status', 'ACTIVE'
  )) into assignments_json
  from public.project_suppliers ps where ps.project_id = source.id;

  return query
  select cp.project_id, cp.project_code, cp.status
  from public.create_project_atomic(
    trim(p_new_name),
    (select name from public.clients where id = source.client_id),
    source.client_po,
    source.type,
    source.category,
    source.client_cpi,
    source.currency,
    source.survey_url,
    source.test_survey_url,
    source.survey_parameters,
    coalesce(assignments_json, '[]'::jsonb),
    coalesce(markets_json, '[]'::jsonb),
    source.geo_security_enabled,
    jsonb_build_object('target_audience', source.target_audience, 'end_client', source.end_client)
  ) cp;
end $$;

-- 3. Project archive function
create or replace function public.archive_project(p_project_code text)
returns table(project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects where project_code = upper(trim(p_project_code)) for update;
  if not found then raise exception 'Project not found'; end if;
  if not public.can_operate_project(target.id) then raise exception 'Project operator access required'; end if;

  if target.status = 'LIVE' then
    raise exception 'Cannot archive an active LIVE project. Pause or close the project first.';
  end if;

  update public.projects set status = 'CLOSED', updated_at = now()
  where id = target.id returning id, project_code, status into project_id, project_code, status;

  insert into public.audit_logs(organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values(target.organization_id, auth.uid(), 'PROJECT_ARCHIVED', 'PROJECT', target.id, jsonb_build_object('project_code', target.project_code));

  return next;
end $$;

grant execute on function public.create_project_atomic(text,text,text,text,text,numeric,text,text,text,jsonb,jsonb,jsonb,boolean,jsonb) to authenticated;
grant execute on function public.clone_project(text,text) to authenticated;
grant execute on function public.archive_project(text) to authenticated;

