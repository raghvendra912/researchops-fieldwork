-- Migration 051: Audit log viewer and multi-factor authentication controls (WS-F)
-- Adds workspace-level MFA enforcement settings, audit log indexes, and secure
-- audit log querying with actor resolution for operator review.

-- 1. MFA enforcement setting on organizations
alter table public.organizations
  add column if not exists mfa_required boolean not null default false;

-- 2. Audit log query performance indexes
create index if not exists audit_logs_org_created_idx
  on public.audit_logs(organization_id, created_at desc);

create index if not exists audit_logs_action_idx
  on public.audit_logs(organization_id, action, created_at desc);

-- 3. Audit log query function with actor user profile enrichment
create or replace function public.query_audit_logs(
  p_action text default null,
  p_entity_type text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table(
  id uuid,
  organization_id uuid,
  actor_user_id uuid,
  actor_email text,
  actor_display_name text,
  action text,
  entity_type text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql security invoker set search_path = public as $$
declare
  v_org_id uuid;
  v_limit integer;
  v_offset integer;
begin
  select m.organization_id into v_org_id
  from public.organization_members m
  where m.user_id = auth.uid() and m.role in ('OWNER', 'ADMIN', 'PM')
  order by m.created_at limit 1;

  if v_org_id is null then
    raise exception 'Operator access required to view audit logs';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select
    a.id,
    a.organization_id,
    a.actor_user_id,
    p.email as actor_email,
    p.display_name as actor_display_name,
    a.action,
    a.entity_type,
    a.entity_id::text,
    a.metadata,
    a.created_at
  from public.audit_logs a
  left join public.user_profiles p on p.id = a.actor_user_id
  where a.organization_id = v_org_id
    and (p_action is null or a.action = p_action)
    and (p_entity_type is null or a.entity_type = p_entity_type)
  order by a.created_at desc
  limit v_limit offset v_offset;
end $$;

-- 4. Function to toggle organization MFA requirement
create or replace function public.update_organization_mfa_policy(p_mfa_required boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid;
begin
  select m.organization_id into v_org_id
  from public.organization_members m
  where m.user_id = auth.uid() and m.role in ('OWNER', 'ADMIN')
  order by m.created_at limit 1;

  if v_org_id is null then
    raise exception 'Administrator access required';
  end if;

  update public.organizations
  set mfa_required = p_mfa_required
  where id = v_org_id;

  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (v_org_id, auth.uid(), 'ORGANIZATION_MFA_POLICY_UPDATED', 'ORGANIZATION', v_org_id, jsonb_build_object('mfa_required', p_mfa_required));

  return p_mfa_required;
end $$;

revoke all on function public.query_audit_logs(text, text, integer, integer) from public;
grant execute on function public.query_audit_logs(text, text, integer, integer) to authenticated;

revoke all on function public.update_organization_mfa_policy(boolean) from public;
grant execute on function public.update_organization_mfa_policy(boolean) to authenticated;

