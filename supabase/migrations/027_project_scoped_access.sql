create table public.project_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  access_role text not null check (access_role in ('EDITOR','REVIEWER','VIEWER')),
  created_by uuid references public.user_profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,user_id)
);

create index project_access_grants_user_idx on public.project_access_grants(user_id,project_id);
create index project_access_grants_project_idx on public.project_access_grants(project_id,access_role);
create trigger project_access_grants_touch_updated_at before update on public.project_access_grants
for each row execute function public.touch_updated_at();

create or replace function public.can_access_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (
      m.role in ('OWNER','ADMIN') or p.project_manager_id=auth.uid()
      or exists(select 1 from public.project_access_grants g where g.project_id=p.id and g.user_id=auth.uid())
    )
  );
$$;

create or replace function public.can_operate_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (
      m.role in ('OWNER','ADMIN')
      or (m.role='PM' and (p.project_manager_id=auth.uid() or exists(select 1 from public.project_access_grants g where g.project_id=p.id and g.user_id=auth.uid() and g.access_role='EDITOR')))
    )
  );
$$;

create or replace function public.can_review_project(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (
      m.role in ('OWNER','ADMIN')
      or (m.role='PM' and (p.project_manager_id=auth.uid() or exists(select 1 from public.project_access_grants g where g.project_id=p.id and g.user_id=auth.uid())))
      or (m.role='ANALYST' and exists(select 1 from public.project_access_grants g where g.project_id=p.id and g.user_id=auth.uid() and g.access_role='REVIEWER'))
    )
  );
$$;

create or replace function public.can_manage_project_access(target_project_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.projects p
    join public.organization_members m on m.organization_id=p.organization_id and m.user_id=auth.uid()
    where p.id=target_project_id and (m.role in ('OWNER','ADMIN') or (m.role='PM' and p.project_manager_id=auth.uid()))
  );
$$;

revoke all on function public.can_access_project(uuid) from public;
revoke all on function public.can_operate_project(uuid) from public;
revoke all on function public.can_review_project(uuid) from public;
revoke all on function public.can_manage_project_access(uuid) from public;
grant execute on function public.can_access_project(uuid),public.can_operate_project(uuid),public.can_review_project(uuid),public.can_manage_project_access(uuid) to authenticated;

create or replace function public.validate_project_access_grant()
returns trigger language plpgsql security definer set search_path=public as $$
declare project_org uuid; manager_id uuid; member_role text;
begin
  select organization_id,project_manager_id into project_org,manager_id from public.projects where id=new.project_id;
  select role into member_role from public.organization_members where organization_id=project_org and user_id=new.user_id;
  if project_org is null or new.organization_id<>project_org or member_role is null
    or member_role in ('OWNER','ADMIN') or new.user_id=manager_id
    or (member_role='PM' and new.access_role not in ('EDITOR','VIEWER'))
    or (member_role='ANALYST' and new.access_role not in ('REVIEWER','VIEWER'))
    or (member_role='MEMBER' and new.access_role<>'VIEWER') then
    raise exception 'Project role is incompatible with workspace role';
  end if;
  return new;
end $$;

create trigger project_access_grants_validate before insert or update on public.project_access_grants
for each row execute function public.validate_project_access_grant();

alter table public.project_access_grants enable row level security;
create policy "scoped users read project access" on public.project_access_grants for select to authenticated using (public.can_access_project(project_id));
create policy "project leads insert access" on public.project_access_grants for insert to authenticated with check (
  public.can_manage_project_access(project_id)
);
create policy "project leads update access" on public.project_access_grants for update to authenticated using (public.can_manage_project_access(project_id)) with check (
  public.can_manage_project_access(project_id)
);
create policy "project leads delete access" on public.project_access_grants for delete to authenticated using (public.can_manage_project_access(project_id));
grant select,insert,update,delete on public.project_access_grants to authenticated;

drop policy if exists "members read projects" on public.projects;
drop policy if exists "operators update projects" on public.projects;
create policy "scoped users read projects" on public.projects for select to authenticated using (public.can_access_project(id));
create policy "scoped operators update projects" on public.projects for update to authenticated using (public.can_operate_project(id)) with check (public.can_operate_project(id));

drop policy if exists "members read project markets" on public.project_markets;
drop policy if exists "operators create project markets" on public.project_markets;
drop policy if exists "operators update project markets" on public.project_markets;
drop policy if exists "admins delete project markets" on public.project_markets;
create policy "scoped users read project markets" on public.project_markets for select to authenticated using (public.can_access_project(project_id));
create policy "scoped operators insert project markets" on public.project_markets for insert to authenticated with check (public.can_operate_project(project_id));
create policy "scoped operators update project markets" on public.project_markets for update to authenticated using (public.can_operate_project(project_id)) with check (public.can_operate_project(project_id));
create policy "scoped operators delete project markets" on public.project_markets for delete to authenticated using (public.can_operate_project(project_id));

drop policy if exists "members read project suppliers" on public.project_suppliers;
drop policy if exists "operators create project suppliers" on public.project_suppliers;
drop policy if exists "operators update project suppliers" on public.project_suppliers;
drop policy if exists "admins delete project suppliers" on public.project_suppliers;
create policy "scoped users read project suppliers" on public.project_suppliers for select to authenticated using (public.can_access_project(project_id));
create policy "scoped operators insert project suppliers" on public.project_suppliers for insert to authenticated with check (public.can_operate_project(project_id));
create policy "scoped operators update project suppliers" on public.project_suppliers for update to authenticated using (public.can_operate_project(project_id)) with check (public.can_operate_project(project_id));
create policy "scoped operators delete project suppliers" on public.project_suppliers for delete to authenticated using (public.can_operate_project(project_id));

drop policy if exists "members read survey sessions" on public.survey_sessions;
create policy "scoped users read survey sessions" on public.survey_sessions for select to authenticated using (public.can_access_project(project_id));
drop policy if exists "members read survey events" on public.survey_events;
create policy "scoped users read survey events" on public.survey_events for select to authenticated using (exists(select 1 from public.survey_sessions s where s.id=session_id and public.can_access_project(s.project_id)));

drop policy if exists "members read quality policies" on public.project_quality_policies;
drop policy if exists "operators manage quality policies" on public.project_quality_policies;
create policy "scoped users read quality policies" on public.project_quality_policies for select to authenticated using (public.can_access_project(project_id));
create policy "scoped operators manage quality policies" on public.project_quality_policies for all to authenticated using (public.can_operate_project(project_id)) with check (public.can_operate_project(project_id));

drop policy if exists "members read fraud flags" on public.fraud_flags;
drop policy if exists "operators update fraud flags" on public.fraud_flags;
create policy "scoped users read fraud flags" on public.fraud_flags for select to authenticated using (exists(select 1 from public.survey_sessions s where s.id=session_id and public.can_access_project(s.project_id)));
create policy "scoped reviewers update fraud flags" on public.fraud_flags for update to authenticated using (exists(select 1 from public.survey_sessions s where s.id=session_id and public.can_review_project(s.project_id))) with check (exists(select 1 from public.survey_sessions s where s.id=session_id and public.can_review_project(s.project_id)));

drop policy if exists "members read project eligibility" on public.project_eligibility_rules;
drop policy if exists "operators manage project eligibility" on public.project_eligibility_rules;
create policy "scoped users read project eligibility" on public.project_eligibility_rules for select to authenticated using (public.can_access_project(project_id));
create policy "scoped operators manage project eligibility" on public.project_eligibility_rules for all to authenticated using (public.can_operate_project(project_id)) with check (public.can_operate_project(project_id));

drop policy if exists "members read project quota cells" on public.project_quota_cells;
drop policy if exists "operators manage project quota cells" on public.project_quota_cells;
create policy "scoped users read project quota cells" on public.project_quota_cells for select to authenticated using (public.can_access_project(project_id));
create policy "scoped operators manage project quota cells" on public.project_quota_cells for all to authenticated using (public.can_operate_project(project_id)) with check (public.can_operate_project(project_id));
drop policy if exists "members read quota reservations" on public.survey_quota_reservations;
create policy "scoped users read quota reservations" on public.survey_quota_reservations for select to authenticated using (public.can_access_project(project_id));

drop policy if exists "members read notifications" on public.notifications;
drop policy if exists "members mark notifications read" on public.notifications;
create policy "scoped users read notifications" on public.notifications for select to authenticated using (
  public.is_organization_member(organization_id) and (user_id is null or user_id=auth.uid()) and (project_id is null or public.can_access_project(project_id))
);
create policy "scoped users mark notifications read" on public.notifications for update to authenticated using (
  public.is_organization_member(organization_id) and (user_id is null or user_id=auth.uid()) and (project_id is null or public.can_access_project(project_id))
) with check (
  public.is_organization_member(organization_id) and (user_id is null or user_id=auth.uid()) and (project_id is null or public.can_access_project(project_id))
);

create or replace function public.replace_project_access_grants(p_project_code text,p_grants jsonb)
returns setof public.project_access_grants language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype; item jsonb; member_role text; seen uuid[] := '{}'; target_user uuid;
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code));
  if not found or not public.can_manage_project_access(target.id) then raise exception 'Project access administration denied'; end if;
  if jsonb_typeof(coalesce(p_grants,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_grants,'[]'::jsonb))>50 then raise exception 'Invalid project access grants'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_grants,'[]'::jsonb)) loop
    member_role:=null;
    begin target_user:=(item->>'user_id')::uuid; exception when others then raise exception 'Invalid project collaborator'; end;
    if target_user=any(seen) or coalesce(item->>'access_role','') not in ('EDITOR','REVIEWER','VIEWER') then raise exception 'Invalid project collaborator'; end if;
    select role into member_role from public.organization_members where organization_id=target.organization_id and user_id=target_user;
    if member_role is null or member_role in ('OWNER','ADMIN') or target_user=target.project_manager_id
      or (member_role='PM' and item->>'access_role' not in ('EDITOR','VIEWER'))
      or (member_role='ANALYST' and item->>'access_role' not in ('REVIEWER','VIEWER'))
      or (member_role='MEMBER' and item->>'access_role'<>'VIEWER') then raise exception 'Project role is incompatible with workspace role'; end if;
    seen:=array_append(seen,target_user);
  end loop;
  delete from public.project_access_grants where project_id=target.id;
  insert into public.project_access_grants(organization_id,project_id,user_id,access_role,created_by)
  select target.organization_id,target.id,(r.user_id)::uuid,r.access_role,auth.uid()
  from jsonb_to_recordset(coalesce(p_grants,'[]'::jsonb)) r(user_id text,access_role text);
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target.organization_id,auth.uid(),'PROJECT_ACCESS_UPDATED','PROJECT',target.id,jsonb_build_object('project_code',target.project_code,'grant_count',jsonb_array_length(coalesce(p_grants,'[]'::jsonb))));
  return query select * from public.project_access_grants where project_id=target.id order by access_role,user_id;
end $$;

revoke all on function public.replace_project_access_grants(text,jsonb) from public;
grant execute on function public.replace_project_access_grants(text,jsonb) to authenticated;

create or replace function public.project_capabilities(p_project_code text)
returns table(project_id uuid,can_access boolean,can_operate boolean,can_review boolean,can_manage_access boolean)
language sql stable security definer set search_path=public as $$
  select p.id,
    public.can_access_project(p.id),
    public.can_operate_project(p.id),
    public.can_review_project(p.id),
    public.can_manage_project_access(p.id)
  from public.projects p
  where p.project_code=upper(trim(p_project_code)) and public.can_access_project(p.id)
  limit 1;
$$;

revoke all on function public.project_capabilities(text) from public;
grant execute on function public.project_capabilities(text) to authenticated;

create or replace function public.resolve_fraud_flag(p_flag_id uuid,p_status text)
returns table(id uuid,status text,reviewed_at timestamptz)
language plpgsql security invoker set search_path=public as $$
declare target public.fraud_flags%rowtype; target_project_id uuid;
begin
  if p_status not in ('CONFIRMED','DISMISSED') then raise exception 'Invalid resolution'; end if;
  select f.* into target from public.fraud_flags f join public.survey_sessions s on s.id=f.session_id
  where f.id=p_flag_id and public.can_review_project(s.project_id) for update of f;
  if not found then raise exception 'Flag not found or review access denied'; end if;
  select s.project_id into target_project_id from public.survey_sessions s where s.id=target.session_id;
  update public.fraud_flags f set status=p_status,reviewed_by=auth.uid(),reviewed_at=now() where f.id=target.id returning f.id,f.status,f.reviewed_at into id,status,reviewed_at;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(target.organization_id,auth.uid(),'FRAUD_FLAG_RESOLVED','FRAUD_FLAG',target.id,jsonb_build_object('from',target.status,'to',p_status,'project_id',target_project_id));
  return next;
end $$;

revoke all on function public.resolve_fraud_flag(uuid,text) from public;
grant execute on function public.resolve_fraud_flag(uuid,text) to authenticated;

comment on table public.project_access_grants is 'Explicit project scope: PM=EDITOR/VIEWER, ANALYST=REVIEWER/VIEWER, MEMBER=VIEWER. Owner/admin and the assigned project manager retain implicit access.';
