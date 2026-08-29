create or replace function public.create_initial_organization(p_name text)
returns table (organization_id uuid, organization_name text, organization_slug text, membership_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_slug text;
  v_organization public.organizations;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if exists (select 1 from public.organization_members where user_id = v_user_id) then
    raise exception 'The signed-in user already belongs to an organization';
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Organization name must contain at least two characters';
  end if;

  v_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then
    v_slug := 'workspace';
  end if;
  if exists (select 1 from public.organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.organizations (name, slug)
  values (trim(p_name), v_slug)
  returning * into v_organization;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization.id, v_user_id, 'OWNER');

  insert into public.suppliers (organization_id, name, code, supplier_type) values
    (v_organization.id, 'CPX Research', 'CPX', 'PROGRAMMATIC'),
    (v_organization.id, 'BitLabs', 'BITLABS', 'PROGRAMMATIC'),
    (v_organization.id, 'PureSpectrum', 'PURESPECTRUM', 'PROGRAMMATIC');

  return query select v_organization.id, v_organization.name, v_organization.slug, 'OWNER'::text;
end;
$$;

revoke all on function public.create_initial_organization(text) from public;
grant execute on function public.create_initial_organization(text) to authenticated;

comment on function public.create_initial_organization is 'Creates the first organization and OWNER membership for an authenticated user with no existing membership.';
