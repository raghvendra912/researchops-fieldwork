# ResearchOps operations runbook

## Backup and recovery

Supabase PostgreSQL is the system of record. Enable the hosted plan's daily backups and point-in-time recovery where available. The organization owner must record the retention period and named recovery owner outside this repository.

Before every schema release:

1. Confirm the latest automatic backup is healthy.
2. Create an on-demand backup or logical dump using the environment's approved secret store; never commit database URLs or dumps.
3. Record the deployed migration number from `supabase/migrations/`.
4. Apply migrations in filename order to staging, run tenant/RLS and callback checks, then promote.

Quarterly restore drill:

1. Restore the latest backup into an isolated non-production Supabase project.
2. Configure temporary test users for two organizations.
3. Verify project counts, session/event counts, audit logs, fraud flags, notification records, and the highest migration.
4. Run the full test suite against the restored environment and verify cross-tenant reads/writes are denied.
5. Destroy the isolated restore after evidence and timings are recorded in the operations system.

For logical drills on self-hosted/local Supabase, dump the application-owned
`public`, `auth`, and `supabase_migrations` schemas. Do not treat managed
platform schemas such as `realtime` and `vault` as application backup scope;
those contain provider-managed objects and privileges that a normal restore
role cannot recreate. Restore into a newly created isolated database, remove
its empty default `public` schema first, validate the application table counts
and highest migration, then delete the isolated database and dump.

Recovery priority is organizations/auth membership, projects/directories, survey sessions/events, then derived views and operational records. Metrics and analytics are derived and must be recomputed from the event ledger rather than restored as mutable counters.

## Incident and rollback

- Use `x-request-id` to correlate a user report with sanitized Worker logs.
- Disable a compromised callback by rotating only that provider's callback secret.
- Pause affected projects before changing event interpretation or financial rules.
- Prefer a forward-fix migration. Database rollback is allowed only when the migration's reverse operation has been tested against a restored copy.
- Application rollback uses the previous known-good Cloudflare deployment while preserving the database unless compatibility analysis explicitly requires otherwise.

## Secret rotation

Rotate Supabase service-role, event ingestion, provider callback, and fraud hashing secrets independently. Rotating the fraud hashing secret changes future fingerprints and intentionally prevents comparisons with older hashes; schedule that rotation at a documented boundary.
