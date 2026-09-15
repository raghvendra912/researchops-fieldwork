-- Separate supplier-owned attempt references by assignment. The ResearchOps
-- survey_sessions.id remains the globally unique client-facing attempt ID.
-- Apply before allowing duplicate external references across suppliers.

alter table public.survey_sessions drop constraint if exists survey_sessions_project_id_respondent_ref_key;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.survey_sessions'::regclass
    and conname='survey_sessions_assignment_ref_key') then
    alter table public.survey_sessions add constraint survey_sessions_assignment_ref_key
      unique(project_id,project_supplier_id,respondent_ref);
  end if;
end $$;
create unique index if not exists survey_sessions_direct_ref_key on public.survey_sessions(project_id,respondent_ref)
  where project_supplier_id is null;

alter table public.survey_quota_reservations drop constraint if exists survey_quota_reservations_project_id_respondent_ref_key;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.survey_quota_reservations'::regclass
    and conname='survey_quota_reservations_assignment_ref_key') then
    alter table public.survey_quota_reservations add constraint survey_quota_reservations_assignment_ref_key
      unique(project_id,project_supplier_id,respondent_ref);
  end if;
end $$;

create or replace function public.ingest_survey_event(
  p_organization_id uuid, p_project_code text, p_supplier_id uuid,
  p_respondent_ref text, p_event_type text, p_provider_transaction_id text,
  p_occurred_at timestamptz, p_metadata jsonb, p_is_test boolean
)
returns table (session_id uuid, event_id uuid, created boolean)
language plpgsql security definer set search_path=public as $$
declare target_project public.projects%rowtype; target_assignment_id uuid; target_session_id uuid;
  target_event_id uuid; was_created boolean := false;
begin
  if p_event_type not in ('START','REACHED_CLIENT','COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')
    or coalesce(trim(p_respondent_ref),'')='' then raise exception 'Invalid event'; end if;
  select * into target_project from public.projects p
    where p.organization_id=p_organization_id and p.project_code=p_project_code;
  if not found then raise exception 'Project not found'; end if;
  if p_supplier_id is not null then
    select ps.id into target_assignment_id from public.project_suppliers ps
      where ps.project_id=target_project.id and ps.supplier_id=p_supplier_id;
    if not found then raise exception 'Supplier is not assigned to project'; end if;
    insert into public.survey_sessions(organization_id,project_id,project_supplier_id,respondent_ref,status,is_test)
    values(p_organization_id,target_project.id,target_assignment_id,trim(p_respondent_ref),p_event_type,coalesce(p_is_test,false))
    on conflict(project_id,project_supplier_id,respondent_ref) do update set
      status=excluded.status,is_test=survey_sessions.is_test or excluded.is_test,
      completed_at=case when p_event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE')
        then coalesce(p_occurred_at,now()) else survey_sessions.completed_at end
    returning id into target_session_id;
  else
    insert into public.survey_sessions(organization_id,project_id,project_supplier_id,respondent_ref,status,is_test)
    values(p_organization_id,target_project.id,null,trim(p_respondent_ref),p_event_type,coalesce(p_is_test,false))
    on conflict(project_id,respondent_ref) where project_supplier_id is null do update set
      status=excluded.status,is_test=survey_sessions.is_test or excluded.is_test,
      completed_at=case when p_event_type in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE')
        then coalesce(p_occurred_at,now()) else survey_sessions.completed_at end
    returning id into target_session_id;
  end if;
  insert into public.survey_events(organization_id,session_id,event_type,provider_transaction_id,occurred_at,metadata)
  values(p_organization_id,target_session_id,p_event_type,nullif(trim(p_provider_transaction_id),''),
    coalesce(p_occurred_at,now()),coalesce(p_metadata,'{}'::jsonb))
  on conflict do nothing returning id into target_event_id;
  was_created := found;
  if not was_created then
    select e.id into target_event_id from public.survey_events e where e.session_id=target_session_id
      and e.event_type=p_event_type
      and coalesce(e.provider_transaction_id,'')=coalesce(nullif(trim(p_provider_transaction_id),''),'');
  end if;
  return query select target_session_id,target_event_id,was_created;
end $$;
revoke all on function public.ingest_survey_event(uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean) from public;
grant execute on function public.ingest_survey_event(uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean) to service_role;

create or replace function public.reserve_project_quota(
  p_organization_id uuid,p_project_code text,p_supplier_id uuid,p_respondent_ref text,p_matching_cell_ids jsonb
)
returns table(reservation_id uuid,quota_cell_id uuid,allowed boolean,reason text,reserved_until timestamptz)
language plpgsql security definer set search_path=public as $$
declare target_project public.projects%rowtype; target_assignment public.project_suppliers%rowtype;
  existing public.survey_quota_reservations%rowtype; candidate public.project_quota_cells%rowtype;
  selected_cell_id uuid; used_count integer; candidate_id_text text; match_count integer;
  created_id uuid; created_expires timestamptz;
begin
  if coalesce(trim(p_respondent_ref),'')='' or jsonb_typeof(coalesce(p_matching_cell_ids,'[]'::jsonb))<>'array'
    then raise exception 'Invalid quota reservation'; end if;
  select * into target_project from public.projects
    where organization_id=p_organization_id and project_code=upper(trim(p_project_code)) for update;
  if not found then raise exception 'Project not found'; end if;
  select * into target_assignment from public.project_suppliers
    where project_id=target_project.id and supplier_id=p_supplier_id for update;
  if not found then raise exception 'Supplier is not assigned to project'; end if;
  if exists(select 1 from public.survey_sessions s where s.project_id=target_project.id
    and s.project_supplier_id=target_assignment.id and s.respondent_ref=trim(p_respondent_ref)
    and s.status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')) then
    return query select null::uuid,null::uuid,false,'RESPONDENT_TERMINAL',null::timestamptz; return;
  end if;
  update public.survey_quota_reservations r set status='EXPIRED'
    where r.project_id=target_project.id and r.status='RESERVED' and r.expires_at<=now();
  select * into existing from public.survey_quota_reservations r where r.project_id=target_project.id
    and r.project_supplier_id=target_assignment.id and r.respondent_ref=trim(p_respondent_ref) for update;
  if found and existing.status='RESERVED' and existing.expires_at>now() then
    return query select existing.id,existing.quota_cell_id,true,'ALREADY_RESERVED',existing.expires_at; return;
  elsif found and existing.status='CONSUMED' then
    return query select existing.id,existing.quota_cell_id,false,'RESPONDENT_TERMINAL',existing.expires_at; return;
  end if;
  select count(*) into used_count from public.survey_quota_reservations r where r.project_id=target_project.id
    and (r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now()));
  if target_project.quota is not null and used_count>=target_project.quota then
    return query select null::uuid,null::uuid,false,'PROJECT_FULL',null::timestamptz; return; end if;
  select count(*) into used_count from public.survey_quota_reservations r
    where r.project_supplier_id=target_assignment.id
    and (r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now()));
  if coalesce(target_assignment.target_quota,target_project.quota) is not null
    and used_count>=coalesce(target_assignment.target_quota,target_project.quota) then
    return query select null::uuid,null::uuid,false,'SUPPLIER_FULL',null::timestamptz; return; end if;
  match_count := jsonb_array_length(coalesce(p_matching_cell_ids,'[]'::jsonb));
  for candidate_id_text in select value from jsonb_array_elements_text(coalesce(p_matching_cell_ids,'[]'::jsonb)) loop
    if candidate_id_text !~* '^[0-9a-f-]{36}$' then continue; end if;
    select * into candidate from public.project_quota_cells c
      where c.id=candidate_id_text::uuid and c.project_id=target_project.id and c.active for update;
    if not found then continue; end if;
    select count(*) into used_count from public.survey_quota_reservations r where r.quota_cell_id=candidate.id
      and (r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now()));
    if used_count<candidate.target_quota then selected_cell_id:=candidate.id; exit; end if;
  end loop;
  if match_count>0 and selected_cell_id is null then
    return query select null::uuid,null::uuid,false,'QUOTA_CELL_FULL',null::timestamptz; return; end if;
  insert into public.survey_quota_reservations
    (organization_id,project_id,project_supplier_id,quota_cell_id,respondent_ref,status,expires_at)
  values(target_project.organization_id,target_project.id,target_assignment.id,selected_cell_id,
    trim(p_respondent_ref),'RESERVED',now()+interval '2 hours')
  on conflict(project_id,project_supplier_id,respondent_ref) do update set
    quota_cell_id=excluded.quota_cell_id,status='RESERVED',expires_at=excluded.expires_at
  returning id,expires_at into created_id,created_expires;
  reservation_id:=created_id; quota_cell_id:=selected_cell_id; allowed:=true;
  reason:='RESERVED'; reserved_until:=created_expires; return next;
end $$;
revoke all on function public.reserve_project_quota(uuid,text,uuid,text,jsonb) from public;
grant execute on function public.reserve_project_quota(uuid,text,uuid,text,jsonb) to service_role;

create or replace function public.apply_quota_reservation_outcome()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_session public.survey_sessions%rowtype;
begin
  if new.event_type not in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then return new; end if;
  select * into target_session from public.survey_sessions where id=new.session_id;
  if target_session.is_test or target_session.project_supplier_id is null then return new; end if;
  update public.survey_quota_reservations set
    status=case when new.event_type='COMPLETE' then 'CONSUMED' else 'RELEASED' end,
    expires_at=greatest(expires_at,new.occurred_at)
  where project_id=target_session.project_id and project_supplier_id=target_session.project_supplier_id
    and respondent_ref=target_session.respondent_ref and status='RESERVED';
  return new;
end $$;

create or replace function public.supplier_scoped_ref_ready()
returns boolean language sql stable security invoker set search_path=public as $$ select true $$;
revoke all on function public.supplier_scoped_ref_ready() from public;
grant execute on function public.supplier_scoped_ref_ready() to service_role;

create or replace function public.protect_supplier_assignment_history()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.survey_sessions where project_supplier_id=old.id)
    or exists(select 1 from public.survey_quota_reservations where project_supplier_id=old.id) then
    raise exception 'Close supplier assignments with respondent history instead of removing them';
  end if;
  return old;
end $$;
drop trigger if exists project_suppliers_protect_history on public.project_suppliers;
create trigger project_suppliers_protect_history before delete on public.project_suppliers
for each row execute function public.protect_supplier_assignment_history();

-- Preserve assignment IDs across edits so routed sessions, reservations, and
-- outcome callbacks continue to point to the original supplier assignment.
create or replace function public.replace_project_suppliers(p_project_code text,p_assignments jsonb)
returns table(id uuid,supplier_id uuid,supplier_name text,supplier_project_id text,
  supplier_cpi numeric,target_quota integer,status text)
language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype;
begin
  if jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)>100
    then raise exception 'Invalid assignments'; end if;
  select * into target from public.projects p where p.project_code=p_project_code
    and public.can_operate_organization(p.organization_id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;
  if exists(select 1 from jsonb_to_recordset(p_assignments)
    as a(supplier_id uuid,supplier_project_id text,supplier_cpi numeric,target_quota integer,status text)
    left join public.suppliers s on s.id=a.supplier_id and s.organization_id=target.organization_id
    where s.id is null or a.supplier_cpi<0 or a.target_quota<1
      or a.status not in ('PENDING','ACTIVE','PAUSED','CLOSED'))
    then raise exception 'Invalid supplier assignment'; end if;
  if (select count(*) from jsonb_to_recordset(p_assignments) as a(supplier_id uuid))<>
     (select count(distinct a.supplier_id) from jsonb_to_recordset(p_assignments) as a(supplier_id uuid))
    then raise exception 'Duplicate supplier assignment'; end if;
  if exists(select 1 from public.project_suppliers ps where ps.project_id=target.id
    and not exists(select 1 from jsonb_to_recordset(p_assignments) a(supplier_id uuid)
      where a.supplier_id=ps.supplier_id)
    and (exists(select 1 from public.survey_sessions ss where ss.project_supplier_id=ps.id)
      or exists(select 1 from public.survey_quota_reservations qr where qr.project_supplier_id=ps.id)))
    then raise exception 'Close supplier assignments with respondent history instead of removing them'; end if;
  insert into public.project_suppliers(project_id,supplier_id,supplier_project_id,supplier_cpi,target_quota,status)
  select target.id,a.supplier_id,nullif(trim(a.supplier_project_id),''),a.supplier_cpi,a.target_quota,a.status
  from jsonb_to_recordset(p_assignments)
    as a(supplier_id uuid,supplier_project_id text,supplier_cpi numeric,target_quota integer,status text)
  on conflict on constraint project_suppliers_project_id_supplier_id_key do update set
    supplier_project_id=excluded.supplier_project_id,supplier_cpi=excluded.supplier_cpi,
    target_quota=excluded.target_quota,status=excluded.status;
  delete from public.project_suppliers ps where ps.project_id=target.id
    and not exists(select 1 from jsonb_to_recordset(p_assignments) a(supplier_id uuid)
      where a.supplier_id=ps.supplier_id);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target.organization_id,auth.uid(),'PROJECT_SUPPLIERS_REPLACED','PROJECT',target.id,
    jsonb_build_object('project_code',target.project_code,'assignments',p_assignments));
  return query select ps.id,ps.supplier_id,s.name,ps.supplier_project_id,ps.supplier_cpi,
    ps.target_quota,ps.status from public.project_suppliers ps
    join public.suppliers s on s.id=ps.supplier_id where ps.project_id=target.id order by s.name;
end $$;
revoke all on function public.replace_project_suppliers(text,jsonb) from public;
grant execute on function public.replace_project_suppliers(text,jsonb) to authenticated;

select pg_notify('pgrst','reload schema');
