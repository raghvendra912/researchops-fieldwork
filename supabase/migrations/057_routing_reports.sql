-- Phase 5 reporting: date-ranged supplier funnel joining router entry hits
-- (routing_hits) with the sessions each supplier actually produced.
-- security invoker: RLS on routing_hits (operators) and survey_sessions applies
-- to the caller, so the API reads with the user's token, never the service role.

create or replace function public.supplier_funnel_report(
  p_organization_id uuid,
  p_from timestamptz default now() - interval '30 days',
  p_to timestamptz default now(),
  p_project_id uuid default null,
  p_supplier_id uuid default null
)
returns table (
  supplier_id uuid, supplier_name text, clicks bigint, decisions jsonb,
  starts bigint, reached bigint, completes bigint, terminates bigint, quota_full bigint, quality_terminates bigint
)
language sql stable security invoker set search_path = public as $$
  with hit_decisions as (
    select h.supplier_id, h.decision, count(*)::bigint as hits
    from public.routing_hits h
    where h.organization_id = p_organization_id and h.hop = 'SUPPLIER_ENTRY'
      and h.created_at >= p_from and h.created_at < p_to
      and (p_project_id is null or h.project_id = p_project_id)
      and (p_supplier_id is null or h.supplier_id = p_supplier_id)
    group by h.supplier_id, h.decision
  ),
  hit_totals as (
    select supplier_id, sum(hits)::bigint as clicks, jsonb_object_agg(decision, hits) as decisions
    from hit_decisions group by supplier_id
  ),
  session_counts as (
    select ps.supplier_id,
      count(*) filter (where e.types && array['START'])::bigint as starts,
      count(*) filter (where e.types && array['REACHED_CLIENT'])::bigint as reached,
      count(*) filter (where e.types && array['COMPLETE'] and s.is_valid)::bigint as completes,
      count(*) filter (where e.types && array['TERMINATE'])::bigint as terminates,
      count(*) filter (where e.types && array['QUOTA_FULL'])::bigint as quota_full,
      count(*) filter (where e.types && array['QUALITY_TERMINATE'])::bigint as quality_terminates
    from (
      select s.id, s.project_supplier_id,
        (coalesce(s.internal_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
          and coalesce(s.vendor_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
          and not exists (select 1 from public.fraud_flags f where f.session_id = s.id
            and (f.status = 'CONFIRMED' or (f.rule_code = 'SPEEDING' and f.status = 'OPEN')))) as is_valid
      from public.survey_sessions s
      where s.organization_id = p_organization_id and not s.is_test
        and s.started_at >= p_from and s.started_at < p_to
        and (p_project_id is null or s.project_id = p_project_id)
    ) s
    join public.project_suppliers ps on ps.id = s.project_supplier_id
    cross join lateral (select coalesce(array_agg(distinct ev.event_type), '{}'::text[]) as types from public.survey_events ev where ev.session_id = s.id) e
    where p_supplier_id is null or ps.supplier_id = p_supplier_id
    group by ps.supplier_id
  )
  select coalesce(t.supplier_id, c.supplier_id) as supplier_id, sup.name as supplier_name,
    coalesce(t.clicks, 0)::bigint, coalesce(t.decisions, '{}'::jsonb),
    coalesce(c.starts, 0)::bigint, coalesce(c.reached, 0)::bigint, coalesce(c.completes, 0)::bigint,
    coalesce(c.terminates, 0)::bigint, coalesce(c.quota_full, 0)::bigint, coalesce(c.quality_terminates, 0)::bigint
  from hit_totals t
  full outer join session_counts c on c.supplier_id = t.supplier_id
  left join public.suppliers sup on sup.id = coalesce(t.supplier_id, c.supplier_id)
  order by coalesce(t.clicks, 0) desc, sup.name nulls last
$$;

revoke all on function public.supplier_funnel_report(uuid, timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.supplier_funnel_report(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated, service_role;
