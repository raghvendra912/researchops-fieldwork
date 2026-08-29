alter table public.organizations add column if not exists timezone text not null default 'UTC';
alter table public.organizations drop constraint if exists organizations_timezone_check;
alter table public.organizations add constraint organizations_timezone_check check (timezone in ('UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Singapore', 'Australia/Sydney'));

create or replace function public.update_current_organization_settings(p_name text, p_timezone text)
returns table (organization_id uuid, organization_name text, organization_slug text, organization_timezone text, membership_role text)
language plpgsql security definer set search_path = public
as $$
declare
  v_membership public.organization_members;
  v_organization public.organizations;
  v_name text := trim(coalesce(p_name, ''));
  v_timezone text := trim(coalesce(p_timezone, ''));
begin
  select * into v_membership from public.organization_members where user_id = auth.uid() order by created_at limit 1;
  if v_membership.organization_id is null then raise exception 'Workspace membership is required'; end if;
  if v_membership.role not in ('OWNER', 'ADMIN') then raise exception 'Administrator access is required'; end if;
  if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Organization name must be between 2 and 100 characters'; end if;
  if v_timezone not in ('UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Asia/Singapore', 'Australia/Sydney') then raise exception 'Unsupported organization timezone'; end if;

  update public.organizations set name = v_name, timezone = v_timezone where id = v_membership.organization_id returning * into v_organization;
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_organization.id, auth.uid(), 'ORGANIZATION_SETTINGS_UPDATED', 'ORGANIZATION', v_organization.id, jsonb_build_object('name', v_organization.name, 'timezone', v_organization.timezone));
  return query select v_organization.id, v_organization.name, v_organization.slug, v_organization.timezone, v_membership.role;
end;
$$;

revoke all on function public.update_current_organization_settings(text, text) from public;
grant execute on function public.update_current_organization_settings(text, text) to authenticated;
comment on function public.update_current_organization_settings is 'Updates owner/admin-controlled workspace display settings and records an audit event.';
