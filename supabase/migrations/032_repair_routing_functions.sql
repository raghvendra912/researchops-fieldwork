create or replace function public.replace_project_eligibility_rules(p_project_code text,p_rules jsonb)
returns setof public.project_eligibility_rules language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code));
  if not found or not public.can_operate_project(target.id) then raise exception 'Project access denied'; end if;
  if jsonb_typeof(coalesce(p_rules,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rules,'[]'::jsonb)) > 30 then raise exception 'Invalid eligibility rules'; end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_rules,'[]'::jsonb)) r(variable_key text,operator text,values jsonb,required boolean,active boolean,sort_order integer)
    where r.variable_key !~ '^[a-z][a-z0-9_]{0,49}$' or r.operator not in ('EQ','NE','IN','NOT_IN','GTE','LTE','BETWEEN') or jsonb_typeof(r.values)<>'array' or jsonb_array_length(r.values) not between 1 and 50) then raise exception 'Invalid eligibility rule'; end if;
  delete from public.project_eligibility_rules where project_id=target.id;
  insert into public.project_eligibility_rules(organization_id,project_id,variable_key,operator,values,required,active,sort_order)
  select target.organization_id,target.id,lower(trim(r.variable_key)),r.operator,r.values,coalesce(r.required,true),coalesce(r.active,true),coalesce(r.sort_order,r.ordinality::integer)
  from rows from (jsonb_to_recordset(coalesce(p_rules,'[]'::jsonb)) as (variable_key text,operator text,values jsonb,required boolean,active boolean,sort_order integer))
    with ordinality as r(variable_key,operator,values,required,active,sort_order,ordinality);
  return query select * from public.project_eligibility_rules where project_id=target.id order by sort_order,created_at;
end $$;

create or replace function public.replace_project_quota_cells(p_project_code text,p_cells jsonb)
returns setof public.project_quota_cells language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype; cell jsonb; condition jsonb; names text[] := array[]::text[];
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code));
  if not found or not public.can_operate_project(target.id) then raise exception 'Project access denied'; end if;
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
  select target.organization_id,target.id,trim(r.name),r.target_quota,coalesce(r.conditions,'[]'::jsonb),coalesce(r.priority,r.ordinality::integer*10),coalesce(r.active,true)
  from rows from (jsonb_to_recordset(coalesce(p_cells,'[]'::jsonb)) as (name text,target_quota integer,conditions jsonb,priority integer,active boolean))
    with ordinality as r(name,target_quota,conditions,priority,active,ordinality)
  on conflict(project_id,name) do update set target_quota=excluded.target_quota,conditions=excluded.conditions,priority=excluded.priority,active=excluded.active;
  delete from public.project_quota_cells where project_id=target.id and not (lower(name)=any(names));
  return query select * from public.project_quota_cells where project_id=target.id order by priority,name;
end $$;

create or replace function public.reserve_project_quota(p_organization_id uuid,p_project_code text,p_supplier_id uuid,p_respondent_ref text,p_matching_cell_ids jsonb)
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
  if exists(select 1 from public.survey_sessions s where s.project_id=target_project.id and s.respondent_ref=trim(p_respondent_ref) and s.status in ('COMPLETE','TERMINATE','QUOTA_FULL','QUALITY_TERMINATE','ABANDON')) then return query select null::uuid,null::uuid,false,'RESPONDENT_TERMINAL',null::timestamptz; return; end if;
  update public.survey_quota_reservations r set status='EXPIRED' where r.project_id=target_project.id and r.status='RESERVED' and r.expires_at<=now();
  select * into existing from public.survey_quota_reservations r where r.project_id=target_project.id and r.respondent_ref=trim(p_respondent_ref) for update;
  if found and existing.status='RESERVED' and existing.expires_at>now() then return query select existing.id,existing.quota_cell_id,true,'ALREADY_RESERVED',existing.expires_at; return;
  elsif found and existing.status='CONSUMED' then return query select existing.id,existing.quota_cell_id,false,'RESPONDENT_TERMINAL',existing.expires_at; return; end if;
  select count(*) into used_count from public.survey_quota_reservations r where r.project_id=target_project.id and (r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now()));
  if target_project.quota is not null and used_count>=target_project.quota then return query select null::uuid,null::uuid,false,'PROJECT_FULL',null::timestamptz; return; end if;
  select count(*) into used_count from public.survey_quota_reservations r where r.project_supplier_id=target_assignment.id and (r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now()));
  if coalesce(target_assignment.target_quota,target_project.quota) is not null and used_count>=coalesce(target_assignment.target_quota,target_project.quota) then return query select null::uuid,null::uuid,false,'SUPPLIER_FULL',null::timestamptz; return; end if;
  match_count := jsonb_array_length(coalesce(p_matching_cell_ids,'[]'::jsonb));
  for candidate_id_text in select value from jsonb_array_elements_text(coalesce(p_matching_cell_ids,'[]'::jsonb)) loop
    if candidate_id_text !~* '^[0-9a-f-]{36}$' then continue; end if;
    select * into candidate from public.project_quota_cells c where c.id=candidate_id_text::uuid and c.project_id=target_project.id and c.active for update;
    if not found then continue; end if;
    select count(*) into used_count from public.survey_quota_reservations r where r.quota_cell_id=candidate.id and (r.status='CONSUMED' or (r.status='RESERVED' and r.expires_at>now()));
    if used_count<candidate.target_quota then selected_cell_id:=candidate.id; exit; end if;
  end loop;
  if match_count>0 and selected_cell_id is null then return query select null::uuid,null::uuid,false,'QUOTA_CELL_FULL',null::timestamptz; return; end if;
  insert into public.survey_quota_reservations(organization_id,project_id,project_supplier_id,quota_cell_id,respondent_ref,status,expires_at)
  values(target_project.organization_id,target_project.id,target_assignment.id,selected_cell_id,trim(p_respondent_ref),'RESERVED',now()+interval '2 hours')
  on conflict(project_id,respondent_ref) do update set project_supplier_id=excluded.project_supplier_id,quota_cell_id=excluded.quota_cell_id,status='RESERVED',expires_at=excluded.expires_at
  returning id,expires_at into created_id,created_expires;
  reservation_id:=created_id; quota_cell_id:=selected_cell_id; allowed:=true; reason:='RESERVED'; reserved_until:=created_expires; return next;
end $$;

select pg_notify('pgrst','reload schema');
