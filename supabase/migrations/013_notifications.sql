create table public.notification_rules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null check(event_type in ('PROJECT_LIVE','PROJECT_PAUSED','PROJECT_CLOSED','PACING_RISK','QUOTA_REACHED','QUALITY_FLAG','CALLBACK_FAILURE')),
  in_app_enabled boolean not null default true, email_enabled boolean not null default false,
  threshold numeric, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(organization_id,event_type)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, project_id uuid references public.projects(id) on delete cascade,
  event_type text not null, severity text not null default 'INFO' check(severity in ('INFO','WARNING','CRITICAL')),
  title text not null, body text not null, metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications(organization_id,user_id,read_at,created_at desc);
alter table public.notification_rules enable row level security; alter table public.notifications enable row level security;
create policy "members read notification rules" on public.notification_rules for select to authenticated using(public.is_organization_member(organization_id));
create policy "admins manage notification rules" on public.notification_rules for all to authenticated using(public.can_administer_organization(organization_id)) with check(public.can_administer_organization(organization_id));
create policy "members read notifications" on public.notifications for select to authenticated using(public.is_organization_member(organization_id) and (user_id is null or user_id=auth.uid()));
create policy "members mark notifications read" on public.notifications for update to authenticated using(public.is_organization_member(organization_id) and (user_id is null or user_id=auth.uid())) with check(public.is_organization_member(organization_id) and (user_id is null or user_id=auth.uid()));

create or replace function public.emit_project_status_notification() returns trigger language plpgsql security definer set search_path=public as $$
declare event_name text; enabled boolean;
begin if new.status=old.status then return new; end if;
 event_name:=case new.status when 'LIVE' then 'PROJECT_LIVE' when 'PAUSED' then 'PROJECT_PAUSED' when 'CLOSED' then 'PROJECT_CLOSED' else null end;
 if event_name is null then return new; end if;
 select coalesce(r.in_app_enabled,true) into enabled from public.notification_rules r where r.organization_id=new.organization_id and r.event_type=event_name;
 if coalesce(enabled,true) then insert into public.notifications(organization_id,project_id,event_type,severity,title,body,metadata) values(new.organization_id,new.id,event_name,case when new.status='PAUSED' then 'WARNING' else 'INFO' end,new.project_code||' is now '||lower(new.status),new.project_name||' moved from '||old.status||' to '||new.status,jsonb_build_object('from',old.status,'to',new.status)); end if; return new;
end $$;
create trigger projects_emit_status_notification after update of status on public.projects for each row execute function public.emit_project_status_notification();

create or replace function public.emit_fraud_notification() returns trigger language plpgsql security definer set search_path=public as $$
declare enabled boolean; project uuid; code text;
begin select s.project_id,p.project_code into project,code from public.survey_sessions s join public.projects p on p.id=s.project_id where s.id=new.session_id; select coalesce(r.in_app_enabled,true) into enabled from public.notification_rules r where r.organization_id=new.organization_id and r.event_type='QUALITY_FLAG'; if coalesce(enabled,true) then insert into public.notifications(organization_id,project_id,event_type,severity,title,body,metadata) values(new.organization_id,project,'QUALITY_FLAG',case when new.severity='HIGH' then 'CRITICAL' else 'WARNING' end,'Quality review needed for '||code,new.rule_code||' was detected for a respondent session.',jsonb_build_object('flagId',new.id,'rule',new.rule_code)); end if; return new; end $$;
create trigger fraud_flags_emit_notification after insert on public.fraud_flags for each row execute function public.emit_fraud_notification();

create or replace function public.replace_notification_rules(p_rules jsonb) returns setof public.notification_rules language plpgsql security invoker set search_path=public as $$
declare v_organization uuid;
begin select organization_id into v_organization from public.organization_members where user_id=auth.uid() and role in('OWNER','ADMIN') order by created_at limit 1; if v_organization is null then raise exception 'Administrator access required'; end if;
 insert into public.notification_rules(organization_id,event_type,in_app_enabled,email_enabled,threshold) select v_organization,r.event_type,r.in_app_enabled,r.email_enabled,r.threshold from jsonb_to_recordset(p_rules) as r(event_type text,in_app_enabled boolean,email_enabled boolean,threshold numeric) on conflict(organization_id,event_type) do update set in_app_enabled=excluded.in_app_enabled,email_enabled=excluded.email_enabled,threshold=excluded.threshold,updated_at=now();
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,metadata) values(v_organization,auth.uid(),'NOTIFICATION_RULES_UPDATED','NOTIFICATION_RULES',jsonb_build_object('rules',p_rules)); return query select nr.* from public.notification_rules nr where nr.organization_id=v_organization order by nr.event_type; end $$;
revoke all on function public.replace_notification_rules(jsonb) from public; grant execute on function public.replace_notification_rules(jsonb) to authenticated;
