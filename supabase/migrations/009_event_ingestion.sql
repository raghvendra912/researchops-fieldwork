create unique index survey_events_idempotency_idx
on public.survey_events (session_id, event_type, coalesce(provider_transaction_id, ''));

create or replace function public.ingest_survey_event(
  p_organization_id uuid,
  p_project_code text,
  p_supplier_id uuid,
  p_respondent_ref text,
  p_event_type text,
  p_provider_transaction_id text,
  p_occurred_at timestamptz,
  p_metadata jsonb
)
returns table (session_id uuid, event_id uuid, created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_project public.projects%rowtype;
  target_assignment_id uuid;
  target_session_id uuid;
  target_event_id uuid;
  was_created boolean := false;
begin
  if p_event_type not in ('START','REACHED_CLIENT','COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')
    or coalesce(trim(p_respondent_ref), '') = '' then raise exception 'Invalid event'; end if;
  select * into target_project from public.projects p where p.organization_id = p_organization_id and p.project_code = p_project_code;
  if not found then raise exception 'Project not found'; end if;
  if p_supplier_id is not null then
    select ps.id into target_assignment_id from public.project_suppliers ps where ps.project_id = target_project.id and ps.supplier_id = p_supplier_id;
    if not found then raise exception 'Supplier is not assigned to project'; end if;
  end if;

  insert into public.survey_sessions (organization_id, project_id, project_supplier_id, respondent_ref, status)
  values (p_organization_id, target_project.id, target_assignment_id, trim(p_respondent_ref), p_event_type)
  on conflict (project_id, respondent_ref) do update set
    project_supplier_id = coalesce(survey_sessions.project_supplier_id, excluded.project_supplier_id),
    status = excluded.status,
    completed_at = case when p_event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE') then coalesce(p_occurred_at, now()) else survey_sessions.completed_at end
  returning id into target_session_id;

  insert into public.survey_events (organization_id, session_id, event_type, provider_transaction_id, occurred_at, metadata)
  values (p_organization_id, target_session_id, p_event_type, nullif(trim(p_provider_transaction_id), ''), coalesce(p_occurred_at, now()), coalesce(p_metadata, '{}'::jsonb))
  on conflict do nothing returning id into target_event_id;
  was_created := found;
  if not was_created then
    select e.id into target_event_id from public.survey_events e where e.session_id = target_session_id and e.event_type = p_event_type and coalesce(e.provider_transaction_id, '') = coalesce(nullif(trim(p_provider_transaction_id), ''), '');
  end if;
  return query select target_session_id, target_event_id, was_created;
end;
$$;

revoke all on function public.ingest_survey_event(uuid,text,uuid,text,text,text,timestamptz,jsonb) from public;
grant execute on function public.ingest_survey_event(uuid,text,uuid,text,text,text,timestamptz,jsonb) to service_role;
