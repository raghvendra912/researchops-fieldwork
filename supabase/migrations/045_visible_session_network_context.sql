-- Store access-controlled network context for projects that explicitly enable Geo Security.
-- Historical sessions are intentionally not backfilled because their source IP/city is unavailable.

alter table public.survey_sessions
  add column if not exists ip_address inet;

create or replace function public.capture_session_network_context(
  p_session_id uuid,
  p_ip_address text,
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
    ip_address=case when nullif(trim(p_ip_address),'') is null then null else trim(p_ip_address)::inet end,
    geo_country_code=nullif(upper(left(trim(p_country_code),2)),''),
    geo_region_code=nullif(left(trim(p_region_code),80),''),
    geo_city=nullif(left(trim(p_city),120),''),
    geo_check_status=p_check_status
  where id=p_session_id;
end $$;

revoke all on function public.capture_session_network_context(uuid,text,text,text,text,text) from public;
grant execute on function public.capture_session_network_context(uuid,text,text,text,text,text) to service_role;

notify pgrst, 'reload schema';
