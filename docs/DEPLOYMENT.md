# ResearchOps deployment checklist

## Current hosted staging

- URL: `https://researchops-fieldwork.rav9912.chatgpt.site`
- Access: publicly reachable through Sites; ResearchOps authentication remains mandatory and protected APIs reject unauthenticated requests.
- Runtime: Sites-managed Cloudflare Worker-compatible Vinext build.
- Database/Auth: Supabase Free in `ap-south-1`, with migrations `001` through `019` applied.
- Runtime configuration: managed through Sites environment variables and secrets; no hosted credentials belong in repository files.

The staging site is the permanent hosted test environment. Quick Tunnels remain temporary local-development surfaces.

## Runtime configuration

Public browser variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Server-only Worker secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EVENT_INGESTION_SECRET`
- `CPX_CALLBACK_SECRET`
- `BITLABS_CALLBACK_SECRET`
- `PURESPECTRUM_CALLBACK_SECRET`
- `FRAUD_HASH_SECRET`

Never expose server-only values with a `VITE_` prefix. Configure them using the chosen Cloudflare hosting secret manager, not source files.

## Staging gate

1. Apply every SQL file through the highest numbered migration to staging.
2. Configure Supabase Auth redirect URLs for login and password recovery.
3. Create two organizations and role fixtures (OWNER, ADMIN, PM, ANALYST, MEMBER).
4. Run database/RLS integration checks, provider callback fixtures, and the vertical E2E flow.
5. Verify health/readiness, structured logs, request IDs, rate-limit responses, audit records, notifications, fraud review, analytics, and restore readiness.
6. Confirm accessibility/responsive checks and record approval before promotion.

## Production promotion

- Build from the exact tested revision.
- Confirm backup health and migration compatibility.
- Apply forward migrations before deploying code that depends on them.
- Deploy the Worker/site, then run health, readiness, authentication, project read, and signed callback smoke checks.
- Monitor error rates, callback rejection/duplicate rates, and latency during the initial release window.

## Named Cloudflare Tunnel

Quick Tunnels are demonstration-only. Production requires an account-managed named tunnel, stable hostname, DNS route, least-privilege access policy, and a service-managed origin process. Keep the origin bound to loopback, configure automatic restart, and verify the stable hostname after every deployment.

## Rollback

Retain the previous application deployment and its compatible schema range. Roll application code back first when the schema is backward-compatible. If it is not, use the tested forward-fix procedure or restore plan in `docs/OPERATIONS.md`; never improvise destructive schema reversal in production.
