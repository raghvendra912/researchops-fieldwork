create or replace function public.replace_project_access_grants(p_project_code text,p_grants jsonb)
returns setof public.project_access_grants language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype; item jsonb; member_role text; seen uuid[] := array[]::uuid[]; target_user uuid;
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

select pg_notify('pgrst','reload schema');
