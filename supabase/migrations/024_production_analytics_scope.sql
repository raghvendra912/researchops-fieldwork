create or replace function public.analytics_snapshot(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare organization uuid; result jsonb;
begin
 select organization_id into organization from public.organization_members where user_id=auth.uid() order by created_at limit 1;
 if organization is null then raise exception 'Workspace membership required'; end if;
 with production_events as (
   select e.*,s.project_id,s.project_supplier_id from public.survey_events e join public.survey_sessions s on s.id=e.session_id
   where e.organization_id=organization and not s.is_test and e.occurred_at>=p_from and e.occurred_at<p_to
 ), production_sessions as (
   select s.* from public.survey_sessions s where s.organization_id=organization and not s.is_test and s.started_at>=p_from and s.started_at<p_to
 ), test_sessions as (
   select count(*)::integer test_starts from public.survey_sessions s where s.organization_id=organization and s.is_test and s.started_at>=p_from and s.started_at<p_to
 ), portfolio as (
   select count(distinct session_id) filter(where event_type='START') starts,count(distinct session_id) filter(where event_type='REACHED_CLIENT') reached,
     count(distinct session_id) filter(where event_type='COMPLETE') completes,count(distinct session_id) filter(where event_type='TERMINATE') terminates,
     count(distinct session_id) filter(where event_type='QUOTA_FULL') over_quota,count(distinct session_id) filter(where event_type='QUALITY_TERMINATE') quality_terminates,
     count(distinct session_id) filter(where event_type='ABANDON') abandons,max(occurred_at) last_event_at from production_events
 ), open_sessions as (
   select count(*)::integer in_progress from production_sessions where status in ('START','REACHED_CLIENT')
 ), suppliers as (
   select sup.name,count(distinct pe.session_id) filter(where pe.event_type='START') starts,count(distinct pe.session_id) filter(where pe.event_type='COMPLETE') completes,
     round(100*count(distinct pe.session_id) filter(where pe.event_type='COMPLETE')/nullif(count(distinct pe.session_id) filter(where pe.event_type in('COMPLETE','TERMINATE')),0),2) ir,
     round(count(distinct pe.session_id) filter(where pe.event_type='COMPLETE')*coalesce(ps.supplier_cpi,0),2) cost
   from public.project_suppliers ps join public.suppliers sup on sup.id=ps.supplier_id left join production_events pe on pe.project_supplier_id=ps.id
   where sup.organization_id=organization group by sup.name,ps.supplier_cpi
 ), clients as (
   select c.name,count(distinct pe.session_id) filter(where pe.event_type='COMPLETE') completes from public.clients c join public.projects p on p.client_id=c.id left join production_events pe on pe.project_id=p.id where c.organization_id=organization group by c.name
 ), markets as (
   select pm.country_code,count(distinct pe.session_id) filter(where pe.event_type='COMPLETE') completes from public.project_markets pm join public.projects p on p.id=pm.project_id left join production_events pe on pe.project_id=p.id where p.organization_id=organization group by pm.country_code
 )
 select jsonb_build_object(
   'portfolio',(select jsonb_build_object('testStarts',(select test_starts from test_sessions),'starts',starts,'reached',reached,'completes',completes,'terminates',terminates,'overQuota',over_quota,'qualityTerminates',quality_terminates,'abandons',abandons,'inProgress',(select in_progress from open_sessions),'conversionRate',coalesce(round(100*completes/nullif(starts,0),2),0),'dropOffRate',coalesce(round(100*abandons/nullif(starts,0),2),0),'lastEventAt',last_event_at) from portfolio),
   'suppliers',coalesce((select jsonb_agg(jsonb_build_object('name',name,'starts',starts,'completes',completes,'incidenceRate',ir,'cost',cost) order by completes desc) from suppliers),'[]'::jsonb),
   'clients',coalesce((select jsonb_agg(jsonb_build_object('name',name,'completes',completes) order by completes desc) from clients),'[]'::jsonb),
   'markets',coalesce((select jsonb_agg(jsonb_build_object('countryCode',country_code,'completes',completes) order by completes desc) from markets),'[]'::jsonb)
 ) into result;
 return result;
end $$;

revoke all on function public.analytics_snapshot(timestamptz,timestamptz) from public;
grant execute on function public.analytics_snapshot(timestamptz,timestamptz) to authenticated;
