alter table public.clients
  add column if not exists contact_name text,
  add column if not exists address text,
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists complete_url text,
  add column if not exists terminate_url text,
  add column if not exists quota_full_url text,
  add column if not exists security_terminate_url text,
  add column if not exists redirect_token uuid not null default gen_random_uuid();

alter table public.suppliers
  add column if not exists contact_name text,
  add column if not exists address text,
  add column if not exists contact_email text,
  add column if not exists phone text,
  add column if not exists redirect_mode text not null default 'STATIC',
  add column if not exists complete_url text,
  add column if not exists terminate_url text,
  add column if not exists quota_full_url text,
  add column if not exists security_terminate_url text,
  add column if not exists redirect_token uuid not null default gen_random_uuid();

alter table public.projects
  add column if not exists survey_url text,
  add column if not exists security_terminate_url text;

alter table public.suppliers drop constraint if exists suppliers_redirect_mode_check;
alter table public.suppliers add constraint suppliers_redirect_mode_check check (redirect_mode in ('STATIC', 'DYNAMIC'));

alter table public.clients drop constraint if exists clients_contact_email_valid;
alter table public.clients add constraint clients_contact_email_valid check (contact_email is null or (length(contact_email) <= 254 and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
alter table public.suppliers drop constraint if exists suppliers_contact_email_valid;
alter table public.suppliers add constraint suppliers_contact_email_valid check (contact_email is null or (length(contact_email) <= 254 and contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

alter table public.clients drop constraint if exists clients_redirect_urls_valid;
alter table public.clients add constraint clients_redirect_urls_valid check (
  (complete_url is null or (length(complete_url) <= 2048 and complete_url ~ '^https?://')) and
  (terminate_url is null or (length(terminate_url) <= 2048 and terminate_url ~ '^https?://')) and
  (quota_full_url is null or (length(quota_full_url) <= 2048 and quota_full_url ~ '^https?://')) and
  (security_terminate_url is null or (length(security_terminate_url) <= 2048 and security_terminate_url ~ '^https?://'))
);
alter table public.suppliers drop constraint if exists suppliers_redirect_urls_valid;
alter table public.suppliers add constraint suppliers_redirect_urls_valid check (
  (complete_url is null or (length(complete_url) <= 2048 and complete_url ~ '^https?://')) and
  (terminate_url is null or (length(terminate_url) <= 2048 and terminate_url ~ '^https?://')) and
  (quota_full_url is null or (length(quota_full_url) <= 2048 and quota_full_url ~ '^https?://')) and
  (security_terminate_url is null or (length(security_terminate_url) <= 2048 and security_terminate_url ~ '^https?://'))
);
alter table public.projects drop constraint if exists projects_survey_url_valid;
alter table public.projects add constraint projects_survey_url_valid check (survey_url is null or (length(survey_url) <= 2048 and survey_url ~ '^https?://'));
alter table public.projects drop constraint if exists projects_security_terminate_url_valid;
alter table public.projects add constraint projects_security_terminate_url_valid check (security_terminate_url is null or (length(security_terminate_url) <= 2048 and security_terminate_url ~ '^https?://'));

create unique index if not exists clients_redirect_token_idx on public.clients (redirect_token);
create unique index if not exists suppliers_redirect_token_idx on public.suppliers (redirect_token);

drop policy if exists "operators create clients" on public.clients;
drop policy if exists "operators update clients" on public.clients;
create policy "admins create clients" on public.clients for insert to authenticated with check (public.can_administer_organization(organization_id));
create policy "admins update clients" on public.clients for update to authenticated using (public.can_administer_organization(organization_id)) with check (public.can_administer_organization(organization_id));

create or replace function public.create_project_with_market_v3(
  p_project_name text, p_client_name text, p_client_po text, p_project_type text, p_category text,
  p_client_cpi numeric, p_quota integer, p_country_code text, p_language_code text,
  p_expected_loi_minutes integer, p_expected_ir numeric, p_supplier_names text[],
  p_survey_url text, p_security_terminate_url text
)
returns table (project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare v_organization_id uuid; v_client_id uuid; v_project public.projects;
begin
  select om.organization_id into v_organization_id from public.organization_members om where om.user_id=auth.uid() order by om.created_at limit 1;
  if v_organization_id is null then raise exception 'The signed-in user does not belong to an organization'; end if;
  if not public.can_operate_organization(v_organization_id) then raise exception 'The workspace role cannot create projects'; end if;
  select id into v_client_id from public.clients where organization_id=v_organization_id and name=trim(p_client_name);
  if v_client_id is null then raise exception 'Select an existing client'; end if;
  insert into public.projects(organization_id,client_id,project_code,project_name,project_type,category,project_manager_id,client_po,client_cpi,quota,status,start_date,survey_url,security_terminate_url)
  values(v_organization_id,v_client_id,'PRJ-'||nextval('public.project_code_sequence')::text,trim(p_project_name),nullif(trim(p_project_type),''),nullif(trim(p_category),''),auth.uid(),nullif(trim(p_client_po),''),p_client_cpi,p_quota,'DRAFT',current_date,nullif(trim(p_survey_url),''),nullif(trim(p_security_terminate_url),''))
  returning * into v_project;
  insert into public.project_markets(project_id,country_code,language_code,target_quota,expected_loi_minutes,expected_ir)
  values(v_project.id,upper(trim(p_country_code)),lower(trim(p_language_code)),p_quota,p_expected_loi_minutes,p_expected_ir);
  insert into public.project_suppliers(project_id,supplier_id,target_quota,status)
  select v_project.id,s.id,p_quota,'PENDING' from public.suppliers s where s.organization_id=v_organization_id and s.name=any(coalesce(p_supplier_names,array[]::text[]))
  on conflict on constraint project_suppliers_project_id_supplier_id_key do nothing;
  return query select v_project.id,v_project.project_code,v_project.status;
end $$;

create or replace function public.update_project_core_v3(
  p_project_code text, p_project_name text, p_client_po text, p_project_type text, p_category text,
  p_client_cpi numeric, p_quota integer, p_end_date date, p_survey_url text, p_security_terminate_url text
)
returns table (project_id uuid, project_code text, status text)
language plpgsql security invoker set search_path = public as $$
declare target public.projects%rowtype; previous jsonb;
begin
  if coalesce(trim(p_project_name), '') = '' or p_client_cpi < 0 or p_quota < 1 then raise exception 'Invalid project details'; end if;
  select * into target from public.projects p where p.project_code=p_project_code and public.can_operate_organization(p.organization_id) for update;
  if not found then raise exception 'Project not found or access denied'; end if;
  previous := to_jsonb(target);
  update public.projects p set project_name=trim(p_project_name),client_po=nullif(trim(p_client_po),''),project_type=nullif(trim(p_project_type),''),category=nullif(trim(p_category),''),client_cpi=p_client_cpi,quota=p_quota,end_date=p_end_date,survey_url=nullif(trim(p_survey_url),''),security_terminate_url=nullif(trim(p_security_terminate_url),'') where p.id=target.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) values(target.organization_id,auth.uid(),'PROJECT_UPDATED','PROJECT',target.id,jsonb_build_object('before',previous,'project_code',target.project_code));
  return query select target.id,target.project_code,target.status;
end $$;

revoke all on function public.create_project_with_market_v3(text,text,text,text,text,numeric,integer,text,text,integer,numeric,text[],text,text) from public;
revoke all on function public.update_project_core_v3(text,text,text,text,text,numeric,integer,date,text,text) from public;
grant execute on function public.create_project_with_market_v3(text,text,text,text,text,numeric,integer,text,text,integer,numeric,text[],text,text) to authenticated;
grant execute on function public.update_project_core_v3(text,text,text,text,text,numeric,integer,date,text,text) to authenticated;

create or replace view public.project_event_metrics with (security_invoker = true) as
select p.organization_id,p.id project_id,p.project_code,
 count(distinct s.id) filter(where e.event_type='START')::integer starts,
 count(distinct s.id) filter(where e.event_type='REACHED_CLIENT')::integer reached,
 count(distinct s.id) filter(where e.event_type='COMPLETE')::integer completes,
 count(distinct s.id) filter(where e.event_type='TERMINATE')::integer terminates,
 count(distinct s.id) filter(where e.event_type='QUOTA_FULL')::integer over_quota,
 count(distinct s.id) filter(where e.event_type='QUALITY_TERMINATE')::integer quality_term,
 count(distinct s.id) filter(where e.event_type='ABANDON')::integer abandons,
 count(distinct s.id) filter(where e.event_type='COMPLETE' and e.occurred_at>=now()-interval '24 hours')::integer completes_l24,
 round(100*count(distinct s.id) filter(where e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where e.event_type in('COMPLETE','TERMINATE')),0),2) incidence_rate,
 round(100*count(distinct s.id) filter(where e.event_type='COMPLETE')/nullif(count(distinct s.id) filter(where e.event_type='START'),0),2) conversion_rate,
 round(100*count(distinct s.id) filter(where e.event_type='ABANDON')/nullif(count(distinct s.id) filter(where e.event_type='START'),0),2) abandon_rate,
 max(e.occurred_at) filter(where e.event_type='COMPLETE') last_complete_at,
 round(avg(extract(epoch from (s.completed_at-s.started_at))) filter(where s.completed_at is not null),0)::integer average_duration_seconds
from public.projects p left join public.survey_sessions s on s.project_id=p.id left join public.survey_events e on e.session_id=s.id
group by p.organization_id,p.id,p.project_code;

grant select on public.project_event_metrics to authenticated;

comment on column public.suppliers.redirect_mode is 'STATIC URLs are reused across projects; DYNAMIC URLs may contain {{respondent_id}} and {{project_id}} placeholders.';
comment on column public.projects.survey_url is 'Client survey entry URL or template. Supports {{respondent_id}} and generated outcome URL placeholders.';
