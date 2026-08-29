grant usage on schema public to authenticated, service_role;

grant select on public.organizations, public.organization_members to authenticated;
grant select, insert, update, delete on public.clients, public.suppliers, public.projects, public.project_markets, public.project_suppliers to authenticated;
grant select on public.survey_sessions, public.survey_events, public.audit_logs to authenticated;
grant insert on public.audit_logs to authenticated;
grant select, insert, update, delete on public.project_quality_policies to authenticated;
grant select, update on public.fraud_flags to authenticated;
grant select, insert, update, delete on public.notification_rules to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.project_event_metrics, public.project_supplier_event_metrics to authenticated;

grant usage, select on all sequences in schema public to authenticated;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

comment on schema public is 'ResearchOps API privileges are explicit; Row Level Security remains the authorization boundary for authenticated access.';
