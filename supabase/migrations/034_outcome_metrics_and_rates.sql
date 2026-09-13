-- Keep every terminal outcome observable while separating UAT from billable delivery.
-- IR = completes / (completes + terminates); conversion = completes / reached client.

create or replace view public.project_event_metrics with (security_invoker=true) as
select p.organization_id,p.id project_id,p.project_code,
 count(distinct s.id) filter(where not s.is_test and e.event_type='START')::integer starts,
 count(distinct s.id) filter(where not s.is_test and e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')::integer completes,
 count(distinct s.id) filter(where not s.is_test and e.event_type='TERMINATE')::integer terminates,
 count(distinct s.id) filter(where not s.is_test and e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct s.id) filter(where not s.is_test and e.event_type='QUALITY_TERMINATE')::integer quality_term,
 count(distinct s.id) filter(where not s.is_test and e.event_type='ABANDON')::integer abandons,
 count(distinct s.id) filter(where not s.is_test and s.status in ('START','REACHED_CLIENT'))::integer in_progress,
 count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE' and e.occurred_at>=now()-interval '24 hours')::integer completes_l24,
 coalesce(round(100.0*count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type in('COMPLETE','TERMINATE')),0),2),0) incidence_rate,
 coalesce(round(100.0*count(distinct s.id) filter(where not s.is_test and e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type='REACHED_CLIENT'),0),2),0) conversion_rate,
 coalesce(round(100.0*count(distinct s.id) filter(where not s.is_test and e.event_type='ABANDON')/nullif(count(distinct s.id) filter(where not s.is_test and e.event_type='START'),0),2),0) abandon_rate,
 max(e.occurred_at) filter(where not s.is_test) last_event_at,
 max(e.occurred_at) filter(where not s.is_test and e.event_type='COMPLETE') last_complete_at,
 round(avg(extract(epoch from(s.completed_at-s.started_at))) filter(where not s.is_test and s.completed_at is not null),0)::integer average_duration_seconds,
 count(distinct s.id) filter(where s.is_test)::integer test_starts,
 count(distinct s.id) filter(where s.is_test and e.event_type='COMPLETE')::integer test_completes,
 count(distinct s.id) filter(where s.is_test and e.event_type='TERMINATE')::integer test_terminates,
 count(distinct s.id) filter(where s.is_test and e.event_type='QUOTA_FULL')::integer test_over_quota,
 count(distinct s.id) filter(where s.is_test and e.event_type='QUALITY_TERMINATE')::integer test_quality_term
from public.projects p left join public.survey_sessions s on s.project_id=p.id left join public.survey_events e on e.session_id=s.id
group by p.organization_id,p.id,p.project_code;

create or replace view public.project_supplier_event_metrics with (security_invoker=true) as
select p.organization_id,p.id project_id,p.project_code,ps.id project_supplier_id,ps.supplier_id,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='START')::integer starts,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')::integer completes,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='TERMINATE')::integer terminates,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct ss.id) filter(where not ss.is_test and e.event_type='QUALITY_TERMINATE')::integer quality_term,
 coalesce(round(100.0*count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')/nullif(count(distinct ss.id) filter(where not ss.is_test and e.event_type in('COMPLETE','TERMINATE')),0),2),0) incidence_rate,
 round(count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')*coalesce(ps.supplier_cpi,0),2) cost,
 count(distinct ss.id) filter(where ss.is_test)::integer test_starts,
 coalesce(round(100.0*count(distinct ss.id) filter(where not ss.is_test and e.event_type='COMPLETE')/nullif(count(distinct ss.id) filter(where not ss.is_test and e.event_type='REACHED_CLIENT'),0),2),0) conversion_rate,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='COMPLETE')::integer test_completes,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='TERMINATE')::integer test_terminates,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='QUOTA_FULL')::integer test_over_quota,
 count(distinct ss.id) filter(where ss.is_test and e.event_type='QUALITY_TERMINATE')::integer test_quality_term
from public.projects p join public.project_suppliers ps on ps.project_id=p.id left join public.survey_sessions ss on ss.project_supplier_id=ps.id left join public.survey_events e on e.session_id=ss.id
group by p.organization_id,p.id,p.project_code,ps.id,ps.supplier_id,ps.supplier_cpi;

create or replace function public.analytics_snapshot(p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare organization uuid; result jsonb;
begin
 select organization_id into organization from public.organization_members where user_id=auth.uid() order by created_at limit 1;
 if organization is null then raise exception 'Workspace membership required'; end if;
 with production_events as (
  select e.*,s.project_id,s.project_supplier_id from public.survey_events e join public.survey_sessions s on s.id=e.session_id where e.organization_id=organization and not s.is_test and e.occurred_at>=p_from and e.occurred_at<p_to
 ), production_sessions as (
  select s.* from public.survey_sessions s where s.organization_id=organization and not s.is_test and s.started_at>=p_from and s.started_at<p_to
 ), test_outcomes as (
  select count(*)::integer test_starts,count(*) filter(where status='COMPLETE')::integer test_completes,count(*) filter(where status='TERMINATE')::integer test_terminates,count(*) filter(where status='QUOTA_FULL')::integer test_over_quota,count(*) filter(where status='QUALITY_TERMINATE')::integer test_quality_terminates from public.survey_sessions where organization_id=organization and is_test and started_at>=p_from and started_at<p_to
 ), portfolio as (
  select count(distinct session_id) filter(where event_type='START') starts,count(distinct session_id) filter(where event_type='REACHED_CLIENT') reached,count(distinct session_id) filter(where event_type='COMPLETE') completes,count(distinct session_id) filter(where event_type='TERMINATE') terminates,count(distinct session_id) filter(where event_type='QUOTA_FULL') over_quota,count(distinct session_id) filter(where event_type='QUALITY_TERMINATE') quality_terminates,count(distinct session_id) filter(where event_type='ABANDON') abandons,max(occurred_at) last_event_at from production_events
 ), open_sessions as (select count(*)::integer in_progress from production_sessions where status in ('START','REACHED_CLIENT')),
 suppliers as (
  select sup.name,count(distinct pe.session_id) filter(where pe.event_type='START') starts,count(distinct pe.session_id) filter(where pe.event_type='REACHED_CLIENT') reached,count(distinct pe.session_id) filter(where pe.event_type='COMPLETE') completes,count(distinct pe.session_id) filter(where pe.event_type='TERMINATE') terminates,count(distinct pe.session_id) filter(where pe.event_type='QUOTA_FULL') over_quota,count(distinct pe.session_id) filter(where pe.event_type='QUALITY_TERMINATE') quality_terminates,coalesce(round(100.0*count(distinct pe.session_id) filter(where pe.event_type='COMPLETE')/nullif(count(distinct pe.session_id) filter(where pe.event_type in('COMPLETE','TERMINATE')),0),2),0) ir,coalesce(round(100.0*count(distinct pe.session_id) filter(where pe.event_type='COMPLETE')/nullif(count(distinct pe.session_id) filter(where pe.event_type='REACHED_CLIENT'),0),2),0) conversion,round(count(distinct pe.session_id) filter(where pe.event_type='COMPLETE')*coalesce(ps.supplier_cpi,0),2) cost from public.project_suppliers ps join public.suppliers sup on sup.id=ps.supplier_id left join production_events pe on pe.project_supplier_id=ps.id where sup.organization_id=organization group by sup.name,ps.supplier_cpi
 ), clients as (select c.name,count(distinct pe.session_id) filter(where pe.event_type='COMPLETE') completes from public.clients c join public.projects p on p.client_id=c.id left join production_events pe on pe.project_id=p.id where c.organization_id=organization group by c.name),
 markets as (select pm.country_code,count(distinct pe.session_id) filter(where pe.event_type='COMPLETE') completes from public.project_markets pm join public.projects p on p.id=pm.project_id left join production_events pe on pe.project_id=p.id where p.organization_id=organization group by pm.country_code)
 select jsonb_build_object(
  'portfolio',(select jsonb_build_object('testStarts',t.test_starts,'testCompletes',t.test_completes,'testTerminates',t.test_terminates,'testOverQuota',t.test_over_quota,'testQualityTerminates',t.test_quality_terminates,'starts',p.starts,'reached',p.reached,'completes',p.completes,'terminates',p.terminates,'overQuota',p.over_quota,'qualityTerminates',p.quality_terminates,'abandons',p.abandons,'inProgress',(select in_progress from open_sessions),'incidenceRate',coalesce(round(100.0*p.completes/nullif(p.completes+p.terminates,0),2),0),'conversionRate',coalesce(round(100.0*p.completes/nullif(p.reached,0),2),0),'dropOffRate',coalesce(round(100.0*p.abandons/nullif(p.starts,0),2),0),'lastEventAt',p.last_event_at) from portfolio p cross join test_outcomes t),
  'suppliers',coalesce((select jsonb_agg(jsonb_build_object('name',name,'starts',starts,'reached',reached,'completes',completes,'terminates',terminates,'overQuota',over_quota,'qualityTerminates',quality_terminates,'incidenceRate',ir,'conversionRate',conversion,'cost',cost) order by completes desc) from suppliers),'[]'::jsonb),
  'clients',coalesce((select jsonb_agg(jsonb_build_object('name',name,'completes',completes) order by completes desc) from clients),'[]'::jsonb),
  'markets',coalesce((select jsonb_agg(jsonb_build_object('countryCode',country_code,'completes',completes) order by completes desc) from markets),'[]'::jsonb)
 ) into result; return result;
end $$;

grant select on public.project_event_metrics,public.project_supplier_event_metrics to authenticated;
revoke all on function public.analytics_snapshot(timestamptz,timestamptz) from public;
grant execute on function public.analytics_snapshot(timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
