-- Performance indexes, each tied to a query that actually exists.
--
-- Scope note: this migration is a scaling optimisation only. Indexes never
-- change query results, so omitting it breaks nothing; it only matters once
-- survey_events and survey_sessions hold enough rows that the planner stops
-- choosing sequential scans.
--
-- Every index below cites the query that uses it. Indexes were deliberately
-- NOT added for access patterns with no supporting query, or already covered
-- by an existing index: each one costs write throughput on the hot
-- event-ingestion path.

-- Used by public.analytics_snapshot(), whose `scoped` CTE filters
--   where e.organization_id = organization and e.occurred_at >= p_from and e.occurred_at < p_to
-- The existing survey_events indexes lead with session_id, so they cannot
-- serve an organization + date-range scan.
create index if not exists survey_events_organization_occurred_idx
  on public.survey_events (organization_id, occurred_at);

-- Used by the survey_sessions branch of public.analytics_snapshot():
--   where s.organization_id = organization and s.started_at >= p_from and s.started_at < p_to
-- Note this filters started_at, not completed_at. survey_sessions_test_scope_idx
-- leads with project_id and cannot serve the organization-scoped range.
create index if not exists survey_sessions_organization_started_idx
  on public.survey_sessions (organization_id, started_at);

-- Used by the fraud review queue, which reads
--   /rest/v1/fraud_flags?order=created_at.desc&limit=100
-- with no explicit status or organization predicate (tenant scoping is applied
-- by RLS through survey_sessions). fraud_flags_org_status_idx leads with
-- organization_id and status, so it cannot serve that ordering.
create index if not exists fraud_flags_created_at_idx
  on public.fraud_flags (created_at desc);

comment on index survey_events_organization_occurred_idx is
  'Supports the organization + date-range scan in analytics_snapshot';
comment on index survey_sessions_organization_started_idx is
  'Supports the organization + date-range scan in analytics_snapshot';
comment on index fraud_flags_created_at_idx is
  'Supports the fraud review queue recency ordering';
