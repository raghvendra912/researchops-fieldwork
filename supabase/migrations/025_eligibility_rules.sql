create table public.project_eligibility_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  variable_key text not null check (variable_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  operator text not null check (operator in ('EQ','NE','IN','NOT_IN','GTE','LTE','BETWEEN')),
  values jsonb not null check (jsonb_typeof(values)='array' and jsonb_array_length(values) between 1 and 50),
  required boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id,variable_key)
);

create index project_eligibility_rules_project_idx on public.project_eligibility_rules(project_id,active,sort_order);
alter table public.project_eligibility_rules enable row level security;
create policy "members read project eligibility" on public.project_eligibility_rules for select to authenticated
  using (public.is_organization_member(organization_id));
create policy "operators manage project eligibility" on public.project_eligibility_rules for all to authenticated
  using (public.can_operate_organization(organization_id)) with check (public.can_operate_organization(organization_id));
grant select,insert,update,delete on public.project_eligibility_rules to authenticated;

create or replace function public.replace_project_eligibility_rules(p_project_code text,p_rules jsonb)
returns setof public.project_eligibility_rules language plpgsql security invoker set search_path=public as $$
declare target public.projects%rowtype;
begin
  select * into target from public.projects where project_code=upper(trim(p_project_code));
  if not found or not public.can_operate_organization(target.organization_id) then raise exception 'Project access denied'; end if;
  if jsonb_typeof(coalesce(p_rules,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_rules,'[]'::jsonb)) > 30 then raise exception 'Invalid eligibility rules'; end if;
  if exists(select 1 from jsonb_to_recordset(coalesce(p_rules,'[]'::jsonb)) r(variable_key text,operator text,values jsonb,required boolean,active boolean,sort_order integer)
    where r.variable_key !~ '^[a-z][a-z0-9_]{0,49}$' or r.operator not in ('EQ','NE','IN','NOT_IN','GTE','LTE','BETWEEN') or jsonb_typeof(r.values)<>'array' or jsonb_array_length(r.values) not between 1 and 50) then raise exception 'Invalid eligibility rule'; end if;
  delete from public.project_eligibility_rules where project_id=target.id;
  insert into public.project_eligibility_rules(organization_id,project_id,variable_key,operator,values,required,active,sort_order)
  select target.organization_id,target.id,lower(trim(r.variable_key)),r.operator,r.values,coalesce(r.required,true),coalesce(r.active,true),coalesce(r.sort_order,ordinality::integer)
  from jsonb_to_recordset(coalesce(p_rules,'[]'::jsonb)) with ordinality r(variable_key text,operator text,values jsonb,required boolean,active boolean,sort_order integer,ordinality bigint);
  return query select * from public.project_eligibility_rules where project_id=target.id order by sort_order,created_at;
end $$;

revoke all on function public.replace_project_eligibility_rules(text,jsonb) from public;
grant execute on function public.replace_project_eligibility_rules(text,jsonb) to authenticated;
