create or replace view public.project_event_metrics
with (security_invoker = true)
as
select
  p.organization_id, p.id as project_id, p.project_code,
  count(distinct s.id) filter (where e.event_type = 'START')::integer as starts,
  count(distinct s.id) filter (where e.event_type = 'REACHED_CLIENT')::integer as reached,
  count(distinct s.id) filter (where e.event_type = 'COMPLETE')::integer as completes,
  count(distinct s.id) filter (where e.event_type = 'TERMINATE')::integer as terminates,
  count(distinct s.id) filter (where e.event_type = 'QUOTA_FULL')::integer as over_quota,
  count(distinct s.id) filter (where e.event_type = 'QUALITY_TERMINATE')::integer as quality_term,
  count(distinct s.id) filter (where e.event_type = 'ABANDON')::integer as abandons,
  count(distinct s.id) filter (where e.event_type = 'COMPLETE' and e.occurred_at >= now() - interval '24 hours')::integer as completes_l24,
  round(100 * count(distinct s.id) filter (where e.event_type = 'COMPLETE') / nullif(count(distinct s.id) filter (where e.event_type in ('COMPLETE','TERMINATE')), 0), 2) as incidence_rate,
  round(100 * count(distinct s.id) filter (where e.event_type = 'COMPLETE') / nullif(count(distinct s.id) filter (where e.event_type = 'START'), 0), 2) as conversion_rate,
  round(100 * count(distinct s.id) filter (where e.event_type = 'ABANDON') / nullif(count(distinct s.id) filter (where e.event_type = 'START'), 0), 2) as abandon_rate,
  max(e.occurred_at) filter (where e.event_type = 'COMPLETE') as last_complete_at
from public.projects p
left join public.survey_sessions s on s.project_id = p.id
left join public.survey_events e on e.session_id = s.id
group by p.organization_id, p.id, p.project_code;

create or replace view public.project_supplier_event_metrics
with (security_invoker = true)
as
select
  p.organization_id, p.id as project_id, p.project_code, ps.id as project_supplier_id, ps.supplier_id,
  count(distinct ss.id) filter (where e.event_type = 'START')::integer as starts,
  count(distinct ss.id) filter (where e.event_type = 'REACHED_CLIENT')::integer as reached,
  count(distinct ss.id) filter (where e.event_type = 'COMPLETE')::integer as completes,
  count(distinct ss.id) filter (where e.event_type = 'TERMINATE')::integer as terminates,
  count(distinct ss.id) filter (where e.event_type = 'QUOTA_FULL')::integer as over_quota,
  count(distinct ss.id) filter (where e.event_type = 'QUALITY_TERMINATE')::integer as quality_term,
  round(100 * count(distinct ss.id) filter (where e.event_type = 'COMPLETE') / nullif(count(distinct ss.id) filter (where e.event_type in ('COMPLETE','TERMINATE')), 0), 2) as incidence_rate,
  round(count(distinct ss.id) filter (where e.event_type = 'COMPLETE') * coalesce(ps.supplier_cpi, 0), 2) as cost
from public.projects p
join public.project_suppliers ps on ps.project_id = p.id
left join public.survey_sessions ss on ss.project_supplier_id = ps.id
left join public.survey_events e on e.session_id = ss.id
group by p.organization_id, p.id, p.project_code, ps.id, ps.supplier_id, ps.supplier_cpi;

grant select on public.project_event_metrics to authenticated;
grant select on public.project_supplier_event_metrics to authenticated;
