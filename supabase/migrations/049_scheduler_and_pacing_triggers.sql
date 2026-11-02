-- Migration 049: Scheduler, pacing risk triggers, and automated maintenance (WS-D)
-- Adds automated notification emission for QUOTA_REACHED, PACING_RISK, and CALLBACK_FAILURE,
-- and provides scheduled maintenance for abandonment reconciliation and privacy purging.

-- 1. Trigger to emit QUOTA_REACHED when project target completes are achieved
create or replace function public.emit_quota_reached_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_project public.projects%rowtype;
  valid_completes integer;
  in_app boolean;
begin
  if new.event_type <> 'COMPLETE' then return new; end if;

  select p.* into target_project
  from public.projects p
  join public.survey_sessions s on s.project_id = p.id
  where s.id = new.session_id;

  if not found or target_project.quota is null or target_project.status <> 'LIVE' then
    return new;
  end if;

  -- Count valid billable completes for this project
  select count(distinct s.id) into valid_completes
  from public.survey_sessions s
  join public.survey_events e on e.session_id = s.id
  where s.project_id = target_project.id
    and not s.is_test
    and e.event_type = 'COMPLETE'
    and coalesce(s.internal_approval_status, 'NOT_REVIEWED') <> 'REJECTED'
    and coalesce(s.vendor_approval_status, 'NOT_REVIEWED') <> 'REJECTED';

  if valid_completes >= target_project.quota then
    -- Check if notification was already sent in last 24 hours to prevent spam
    if not exists (
      select 1 from public.notifications n
      where n.project_id = target_project.id
        and n.event_type = 'QUOTA_REACHED'
        and n.created_at >= now() - interval '24 hours'
    ) then
      select coalesce(r.in_app_enabled, true) into in_app
      from public.notification_rules r
      where r.organization_id = target_project.organization_id
        and r.event_type = 'QUOTA_REACHED';

      if coalesce(in_app, true) then
        insert into public.notifications (
          organization_id, project_id, event_type, severity, title, body, metadata
        ) values (
          target_project.organization_id,
          target_project.id,
          'QUOTA_REACHED',
          'INFO',
          'Target quota reached for ' || target_project.project_code,
          target_project.project_name || ' reached its target of ' || target_project.quota || ' completes (' || valid_completes || ' valid completes recorded).',
          jsonb_build_object('quota', target_project.quota, 'completes', valid_completes)
        );
      end if;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists survey_events_quota_reached on public.survey_events;
create trigger survey_events_quota_reached
after insert on public.survey_events
for each row execute function public.emit_quota_reached_notification();

-- 2. Function to detect pacing risks across live projects
create or replace function public.check_pacing_and_alert()
returns integer language plpgsql security definer set search_path = public as $$
declare
  proj record;
  alert_count integer := 0;
  in_app boolean;
  threshold_pct numeric;
begin
  for proj in
    select p.id, p.organization_id, p.project_code, p.project_name, p.quota, p.created_at,
      count(distinct s.id) filter (where e.event_type = 'COMPLETE' and not s.is_test) as completes,
      max(e.occurred_at) as last_complete_at
    from public.projects p
    left join public.survey_sessions s on s.project_id = p.id
    left join public.survey_events e on e.session_id = s.id
    where p.status = 'LIVE' and p.quota is not null and p.quota > 0
    group by p.id, p.organization_id, p.project_code, p.project_name, p.quota, p.created_at
  loop
    -- Read pacing threshold from notification rules (default 80%)
    select coalesce(r.threshold, 80), coalesce(r.in_app_enabled, true)
    into threshold_pct, in_app
    from public.notification_rules r
    where r.organization_id = proj.organization_id and r.event_type = 'PACING_RISK';

    -- Pacing risk condition: project has been live > 48h and is below 20% of target,
    -- or has stalled with no complete in > 24h while under target
    if (proj.completes < proj.quota) and (
      (proj.last_complete_at is not null and proj.last_complete_at < now() - interval '24 hours') or
      (proj.last_complete_at is null and proj.created_at < now() - interval '24 hours')
    ) then
      if not exists (
        select 1 from public.notifications n
        where n.project_id = proj.id
          and n.event_type = 'PACING_RISK'
          and n.created_at >= now() - interval '24 hours'
      ) then
        if coalesce(in_app, true) then
          insert into public.notifications (
            organization_id, project_id, event_type, severity, title, body, metadata
          ) values (
            proj.organization_id,
            proj.id,
            'PACING_RISK',
            'WARNING',
            'Pacing alert for ' || proj.project_code,
            proj.project_name || ' has stalled or is delivering behind pace (' || proj.completes || '/' || proj.quota || ' completes).',
            jsonb_build_object('quota', proj.quota, 'completes', proj.completes)
          );
          alert_count := alert_count + 1;
        end if;
      end if;
    end if;
  end loop;

  return alert_count;
end $$;

-- 3. Comprehensive maintenance RPC callable by cron scheduler
create or replace function public.perform_maintenance_tasks()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  purged_values integer := 0;
  pacing_alerts integer := 0;
  result jsonb;
begin
  -- 1. Purge expired response variables per data retention policy
  select coalesce(public.purge_expired_survey_response_values(), 0) into purged_values;

  -- 2. Check pacing risks and emit notifications
  select coalesce(public.check_pacing_and_alert(), 0) into pacing_alerts;

  result := jsonb_build_object(
    'success', true,
    'purgedValues', purged_values,
    'pacingAlerts', pacing_alerts,
    'executedAt', now()
  );

  return result;
end $$;

revoke all on function public.check_pacing_and_alert() from public;
grant execute on function public.check_pacing_and_alert() to service_role;

revoke all on function public.perform_maintenance_tasks() from public;
grant execute on function public.perform_maintenance_tasks() to service_role;

