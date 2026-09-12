create table public.project_quota_cells (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  target_quota integer not null check (target_quota > 0),
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) <= 20),
  priority integer not null default 0 check (priority between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,name)
);

create table public.survey_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  project_supplier_id uuid not null references public.project_suppliers(id) on delete cascade,
  quota_cell_id uuid references public.project_quota_cells(id) on delete set null,
  respondent_ref text not null,
  status text not null default 'RESERVED' check (status in ('RESERVED','CONSUMED','RELEASED','EXPIRED')),
  expires_at timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,respondent_ref)
);

create index project_quota_cells_routing_idx on public.project_quota_cells(project_id,active,priority);
create index survey_quota_reservations_project_idx on public.survey_quota_reservations(project_id,status,expires_at);
create index survey_quota_reservations_assignment_idx on public.survey_quota_reservations(project_supplier_id,status,expires_at);
create index survey_quota_reservations_cell_idx on public.survey_quota_reservations(quota_cell_id,status,expires_at);

create trigger project_quota_cells_touch_updated_at before update on public.project_quota_cells
for each row execute function public.touch_updated_at();
create trigger survey_quota_reservations_touch_updated_at before update on public.survey_quota_reservations
for each row execute function public.touch_updated_at();

alter table public.project_quota_cells enable row level security;
alter table public.survey_quota_reservations enable row level security;
create policy "members read project quota cells" on public.project_quota_cells for select to authenticated using (public.is_organization_member(organization_id));
create policy "operators manage project quota cells" on public.project_quota_cells for all to authenticated using (public.can_operate_organization(organization_id)) with check (public.can_operate_organization(organization_id));
create policy "members read quota reservations" on public.survey_quota_reservations for select to authenticated using (public.is_organization_member(organization_id));
grant select,insert,update,delete on public.project_quota_cells to authenticated;
grant select on public.survey_quota_reservations to authenticated;

create or replace function public.replace_project_quota_cells(p_project_code text,p_cells jsonb)
returns setof public.project_quota_cells language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype; cell jsonb; condition jsonb; names text[] := '{}';
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code));
  if not found or not public.can_operate_organization(target.organization_id) then raise exception 'Project access denied'; end if;
  if jsonb_typeof(coalesce(p_cells,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_cells,'[]'::jsonb)) > 50 then raise exception 'Invalid quota cells'; end if;
  for cell in select value from jsonb_array_elements(coalesce(p_cells,'[]'::jsonb)) loop
    if coalesce(trim(cell->>'name'),'')='' or char_length(trim(cell->>'name'))>100 or coalesce((cell->>'target_quota')::integer,0)<1
      or coalesce((cell->>'priority')::integer,0) not between 0 and 10000 or jsonb_typeof(coalesce(cell->'conditions','[]'::jsonb))<>'array'
      or jsonb_array_length(coalesce(cell->'conditions','[]'::jsonb))>20 or lower(trim(cell->>'name'))=any(names) then raise exception 'Invalid quota cell'; end if;
    names := array_append(names,lower(trim(cell->>'name')));
    for condition in select value from jsonb_array_elements(coalesce(cell->'conditions','[]'::jsonb)) loop
      if coalesce(condition->>'variable_key','') !~ '^[a-z][a-z0-9_]{0,49}$' or condition->>'operator' not in ('EQ','NE','IN','NOT_IN','GTE','LTE','BETWEEN')
        or jsonb_typeof(condition->'values')<>'array' or jsonb_array_length(condition->'values') not between 1 and 50 then raise exception 'Invalid quota condition'; end if;
    end loop;
  end loop;
  insert into public.project_quota_cells(organization_id,project_id,name,target_quota,conditions,priority,active)
  select target.organization_id,target.id,trim(r.name),r.target_quota,coalesce(r.conditions,'[]'::jsonb),coalesce(r.priority,ordinality::integer*10),coalesce(r.active,true)
  from jsonb_to_recordset(coalesce(p_cells,'[]'::jsonb)) with ordinality r(name text,target_quota integer,conditions jsonb,priority integer,active boolean,ordinality bigint)
  on conflict(project_id,name) do update set target_quota=excluded.target_quota,conditions=excluded.conditions,priority=excluded.priority,active=excluded.active;
  delete from public.project_quota_cells where project_id=target.id and not (lower(name)=any(names));
  return query select * from public.project_quota_cells where project_id=target.id order by priority,name;
end $$;

revoke all on function public.replace_project_quota_cells(text,jsonb) from public;
grant execute on function public.replace_project_quota_cells(text,jsonb) to authenticated;

create or replace function public.reserve_project_quota(
  p_organization_id uuid,p_project_code text,p_supplier_id uuid,p_respondent_ref text,p_matching_cell_ids jsonb
)
returns table(reservation_id uuid,quota_cell_id uuid,allowed boolean,reason text,reserved_until timestamptz)
language plpgsql security definer set search_path=public as $$
declare target_project public.projects%rowtype; target_assignment public.project_suppliers%rowtype; existing public.survey_quota_reservations%rowtype;
  candidate public.project_quota_cells%rowtype; selected_cell_id uuid; used_count integer; candidate_id_text text; match_count integer; created_id uuid; created_expires timestamptz;
begin
  if coalesce(trim(p_respondent_ref),'')='' or jsonb_typeof(coalesce(p_matching_cell_ids,'[]'::jsonb))<>'array' then raise exception 'Invalid quota reservation'; end if;
  select * into target_project from public.projects where organization_id=p_organization_id and project_code=upper(trim(p_project_code)) for update;
  if not found then raise exception 'Project not found'; end if;
  select * into target_assignment from public.project_suppliers where project_id=target_project.id and supplier_id=p_supplier_id for update;
  if not found then raise exception 'Supplier is not assigned to project'; end if;

  if exists(select 1 from public.survey_sessions where project_id=target_project.id and respondent_ref=trim(p_respondent_ref) and status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')) then
    return query select null::uuid,null::uuid,false,'RESPONDENT_TERMINAL',null::timestamptz; return;
  end if;
  update public.survey_quota_reservations set status='EXPIRED' where project_id=target_project.id and status='RESERVED' and expires_at<=now();
  select * into existing from public.survey_quota_reservations where project_id=target_project.id and respondent_ref=trim(p_respondent_ref) for update;
  if found and existing.status='RESERVED' and existing.expires_at>now() then
    return query select existing.id,existing.quota_cell_id,true,'ALREADY_RESERVED',existing.expires_at; return;
  elsif found and existing.status='CONSUMED' then
    return query select existing.id,existing.quota_cell_id,false,'RESPONDENT_TERMINAL',existing.expires_at; return;
  end if;

  select count(*) into used_count from public.survey_quota_reservations where project_id=target_project.id and (status='CONSUMED' or (status='RESERVED' and expires_at>now()));
  if target_project.quota is not null and used_count>=target_project.quota then return query select null::uuid,null::uuid,false,'PROJECT_FULL',null::timestamptz; return; end if;
  select count(*) into used_count from public.survey_quota_reservations where project_supplier_id=target_assignment.id and (status='CONSUMED' or (status='RESERVED' and expires_at>now()));
  if coalesce(target_assignment.target_quota,target_project.quota) is not null and used_count>=coalesce(target_assignment.target_quota,target_project.quota) then return query select null::uuid,null::uuid,false,'SUPPLIER_FULL',null::timestamptz; return; end if;

  match_count := jsonb_array_length(coalesce(p_matching_cell_ids,'[]'::jsonb));
  for candidate_id_text in select value from jsonb_array_elements_text(coalesce(p_matching_cell_ids,'[]'::jsonb)) loop
    if candidate_id_text !~* '^[0-9a-f-]{36}$' then continue; end if;
    select * into candidate from public.project_quota_cells where id=candidate_id_text::uuid and project_id=target_project.id and active for update;
    if not found then continue; end if;
    select count(*) into used_count from public.survey_quota_reservations where quota_cell_id=candidate.id and (status='CONSUMED' or (status='RESERVED' and expires_at>now()));
    if used_count<candidate.target_quota then selected_cell_id:=candidate.id; exit; end if;
  end loop;
  if match_count>0 and selected_cell_id is null then return query select null::uuid,null::uuid,false,'QUOTA_CELL_FULL',null::timestamptz; return; end if;

  insert into public.survey_quota_reservations(organization_id,project_id,project_supplier_id,quota_cell_id,respondent_ref,status,expires_at)
  values(target_project.organization_id,target_project.id,target_assignment.id,selected_cell_id,trim(p_respondent_ref),'RESERVED',now()+interval '2 hours')
  on conflict(project_id,respondent_ref) do update set project_supplier_id=excluded.project_supplier_id,quota_cell_id=excluded.quota_cell_id,status='RESERVED',expires_at=excluded.expires_at
  returning id,expires_at into created_id,created_expires;
  reservation_id:=created_id; quota_cell_id:=selected_cell_id; allowed:=true; reason:='RESERVED'; reserved_until:=created_expires; return next;
end $$;

revoke all on function public.reserve_project_quota(uuid,text,uuid,text,jsonb) from public;
grant execute on function public.reserve_project_quota(uuid,text,uuid,text,jsonb) to service_role;

create or replace function public.release_quota_reservation(p_reservation_id uuid)
returns boolean language sql security definer set search_path=public as $$
  update public.survey_quota_reservations set status='RELEASED'
  where id=p_reservation_id and status='RESERVED' returning true;
$$;
revoke all on function public.release_quota_reservation(uuid) from public;
grant execute on function public.release_quota_reservation(uuid) to service_role;

create or replace function public.apply_quota_reservation_outcome()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_session public.survey_sessions%rowtype;
begin
  if new.event_type not in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON') then return new; end if;
  select * into target_session from public.survey_sessions where id=new.session_id;
  if target_session.is_test then return new; end if;
  update public.survey_quota_reservations set status=case when new.event_type='COMPLETE' then 'CONSUMED' else 'RELEASED' end,expires_at=greatest(expires_at,new.occurred_at)
  where project_id=target_session.project_id and respondent_ref=target_session.respondent_ref and status='RESERVED';
  return new;
end $$;

create trigger survey_events_apply_quota_reservation after insert on public.survey_events
for each row execute function public.apply_quota_reservation_outcome();

create view public.project_quota_cell_metrics with (security_invoker=true) as
select c.organization_id,c.project_id,c.id quota_cell_id,c.name,c.target_quota,c.priority,c.active,
  count(r.id) filter(where r.status='CONSUMED')::integer completes,
  count(r.id) filter(where r.status='RESERVED' and r.expires_at>now())::integer reserved,
  greatest(c.target_quota-count(r.id) filter(where r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now())),0)::integer remaining
from public.project_quota_cells c left join public.survey_quota_reservations r on r.quota_cell_id=c.id
group by c.organization_id,c.project_id,c.id,c.name,c.target_quota,c.priority,c.active;

grant select on public.project_quota_cell_metrics to authenticated;
comment on table public.survey_quota_reservations is 'Atomic live-traffic capacity reservations. Test sessions never reserve quota; completes consume and other terminal outcomes release.';
