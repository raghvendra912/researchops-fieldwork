create or replace function public.replace_project_markets(p_project_code text, p_markets jsonb)
returns table (id uuid, country_code text, language_code text, target_quota integer, expected_loi_minutes integer, expected_ir numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare target public.projects%rowtype;
begin
  if jsonb_typeof(p_markets) <> 'array' or jsonb_array_length(p_markets) < 1 then
    raise exception 'At least one market is required';
  end if;
  select * into target from public.projects p where p.project_code = p_project_code
    and public.can_operate_organization(p.organization_id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_markets) as m(country_code text, language_code text, target_quota integer, expected_loi_minutes integer, expected_ir numeric)
    where coalesce(trim(m.country_code), '') !~ '^[A-Za-z]{2}$'
      or coalesce(trim(m.language_code), '') !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$'
      or m.target_quota < 1 or m.expected_loi_minutes < 1 or m.expected_ir < 0 or m.expected_ir > 100
  ) then raise exception 'Invalid market configuration'; end if;

  if (select count(*) from jsonb_to_recordset(p_markets) as m(country_code text, language_code text)) <>
     (select count(distinct upper(m.country_code) || ':' || lower(m.language_code)) from jsonb_to_recordset(p_markets) as m(country_code text, language_code text))
  then raise exception 'Duplicate market configuration'; end if;

  delete from public.project_markets pm where pm.project_id = target.id;
  insert into public.project_markets (project_id, country_code, language_code, target_quota, expected_loi_minutes, expected_ir)
  select target.id, upper(trim(m.country_code)), lower(trim(m.language_code)), m.target_quota, m.expected_loi_minutes, m.expected_ir
  from jsonb_to_recordset(p_markets) as m(country_code text, language_code text, target_quota integer, expected_loi_minutes integer, expected_ir numeric);

  update public.projects set quota = (select sum(pm.target_quota) from public.project_markets pm where pm.project_id = target.id) where projects.id = target.id;
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (target.organization_id, auth.uid(), 'PROJECT_MARKETS_REPLACED', 'PROJECT', target.id,
    jsonb_build_object('project_code', target.project_code, 'markets', p_markets));

  return query select pm.id, pm.country_code, pm.language_code, pm.target_quota, pm.expected_loi_minutes, pm.expected_ir
  from public.project_markets pm where pm.project_id = target.id order by pm.country_code, pm.language_code;
end;
$$;

revoke all on function public.replace_project_markets(text,jsonb) from public;
grant execute on function public.replace_project_markets(text,jsonb) to authenticated;
