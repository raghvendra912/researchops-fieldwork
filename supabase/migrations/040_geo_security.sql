-- Optional project-level geolocation security using hosting-edge location headers.
-- Exact coordinates and raw IP addresses are intentionally not retained.

alter table public.projects
  add column if not exists geo_security_enabled boolean not null default false;

alter table public.survey_sessions
  add column if not exists geo_country_code text,
  add column if not exists geo_region_code text,
  add column if not exists geo_city text,
  add column if not exists geo_check_status text not null default 'NOT_ENABLED';

alter table public.survey_sessions drop constraint if exists survey_sessions_geo_check_status_check;
alter table public.survey_sessions add constraint survey_sessions_geo_check_status_check
  check (geo_check_status in ('NOT_ENABLED','MATCH','MISMATCH','UNKNOWN'));

create or replace function public.configure_project_geo_security(
  p_project_code text,
  p_enabled boolean
)
returns boolean
language plpgsql security definer set search_path=public as $$
declare target_project public.projects%rowtype;
begin
  select * into target_project from public.projects p
    where p.project_code=upper(trim(p_project_code))
      and public.can_operate_organization(p.organization_id);
  if not found then raise exception 'Project not found'; end if;
  update public.projects set geo_security_enabled=coalesce(p_enabled,false),updated_at=now()
    where id=target_project.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_project.organization_id,auth.uid(),'PROJECT_GEO_SECURITY_UPDATED','PROJECT',target_project.id,
    jsonb_build_object('enabled',coalesce(p_enabled,false)));
  return coalesce(p_enabled,false);
end $$;

revoke all on function public.configure_project_geo_security(text,boolean) from public;
grant execute on function public.configure_project_geo_security(text,boolean) to authenticated;

create or replace function public.capture_session_geolocation(
  p_session_id uuid,
  p_country_code text,
  p_region_code text,
  p_city text,
  p_check_status text
)
returns void
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(p_check_status,'') not in ('NOT_ENABLED','MATCH','MISMATCH','UNKNOWN') then
    raise exception 'Invalid geolocation check status';
  end if;
  update public.survey_sessions set
    geo_country_code=nullif(upper(left(trim(p_country_code),2)),''),
    geo_region_code=nullif(left(trim(p_region_code),80),''),
    geo_city=nullif(left(trim(p_city),120),''),
    geo_check_status=p_check_status
  where id=p_session_id;
end $$;

revoke all on function public.capture_session_geolocation(uuid,text,text,text,text) from public;
grant execute on function public.capture_session_geolocation(uuid,text,text,text,text) to service_role;

notify pgrst, 'reload schema';
