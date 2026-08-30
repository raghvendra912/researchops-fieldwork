# ResearchOps Development Tracker

> This file is the single source of truth for project progress. Read it before making changes and update it before ending every development session.

Last updated: 2026-08-30
Current milestone: External integration and browser/deployment gates
Overall state: Client redirect-destination separation, email-OTP signup, password recovery, and the Supabase Auth POST proxy fix are deployed; live password traffic reaches Supabase, while the requested replacement account needs an operator dashboard reset because the email already exists

## Resume protocol

Every developer or coding agent must follow this sequence:

1. Read this entire file and `README.md`.
2. Inspect the current workspace before editing. Do not rebuild completed features from scratch.
3. Check the Current focus section and continue the first unblocked item.
4. Keep changes limited to the selected milestone unless a dependency requires otherwise.
5. Run the acceptance checks listed for the changed features.
6. Update feature statuses, Current focus, Verification record, Decisions, Blockers, and Session log before stopping.
7. Never put passwords, access tokens, provider secrets, or service-role keys in this file.

Use this prompt in a new conversation:

```text
Read PROJECT_TRACKER.md and README.md in the current workspace. Inspect the existing implementation, then continue the Current focus without rebuilding completed features. Follow the acceptance criteria, verify your work, and update PROJECT_TRACKER.md before finishing.
```

## Status legend

| Status | Meaning |
|---|---|
| DONE | Implemented and verified against the stated acceptance criteria. |
| PROTOTYPE | Working UI or mock behavior exists, but it is not production-connected. |
| READY | Code or schema exists but still needs environment setup or live verification. |
| IN PROGRESS | This is the active implementation item. Keep at most one main feature here. |
| TODO | Not implemented. |
| BLOCKED | Cannot continue until the named dependency or credential is available. |

## Current focus

### Now - M8 verification and external integrations

1. Delete and recreate the single requested existing Auth account through the verified Supabase dashboard, then verify password login.
2. Complete browser-driven keyboard, responsive, authenticated-flow, and hosted health/readiness verification for `TST-04`/`TST-05` when a supported browser runtime is available.
3. Replace provider fixtures with official sandbox contract tests when vendor credentials are supplied.
4. Resolve the remaining financial rules before implementing financial accounting beyond the approved `ID_SUBMITTED` and `INVOICED` operational states.

### Next - external decision and credential gates

- Obtain official CPX, BitLabs, and PureSpectrum sandbox contracts and credentials.
- Select an email delivery provider and error-tracking sink.
- Approve financial, currency/FX, tax, reconciliation, and permission rules.
- Supply Cloudflare and hosted Supabase staging credentials for deployment verification.

### Browser verification gate

- Connect the supported in-app/external browser surface, then run authenticated keyboard, responsive, and critical-flow verification for `TST-04`/`TST-05`.

## Feature board

### M1 - Foundation and first vertical slice

| ID | Feature | Status | Acceptance / current result |
|---|---|---|---|
| `FND-01` | Cloudflare-compatible React/Vite application | DONE | Application builds with Vinext/Vite and the Cloudflare Worker entry point. |
| `FND-02` | Responsive product shell and navigation | DONE | Desktop, tablet, and mobile layouts exist with routes for all planned centers. |
| `FND-03` | Dashboard UI | READY | Organization-wide Overview loads monthly completes, live-project counts, supplier delivery/cost, and operational notifications from protected APIs; project creation remains in PM-scoped Project Center. |
| `FND-04` | Login UI | READY | Supabase sign-in/session/sign-out and protected product gating are implemented; an explicit local-only testing switch can issue an OWNER session only after a per-launch high-entropy protected-link cookie, while ordinary visitors and all non-testing environments retain normal login enforcement. |
| `FND-05` | Worker health endpoint | DONE | `GET /api/health` returns HTTP 200 and `status: healthy`. |
| `FND-06` | Baseline automated tests | DONE | Server-render and Worker API smoke tests pass. |
| `FND-07` | TypeScript and production build | DONE | `tsc --noEmit` and `npm run build` pass. |
| `DEV-01` | Cloudflare Quick Tunnel workflow | DONE | `npm run tunnel` builds and serves production; `npm run tunnel:dev` serves Vite with hot reload; both report readiness, validate the public page and browser-style CSS, create a temporary public URL, and clean up owned processes on normal exit. |

### M2 - Supabase, authentication, and tenancy

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `ENV-01` | Supabase development environment | DONE | Docker-backed local Supabase is running on loopback with development credentials kept outside source control. |
| `DB-01` | Core PostgreSQL schema | DONE | The complete tenant schema and atomic RLS-protected RPC set are applied through migration `019` and exercised live. |
| `DB-02` | Apply and verify migration | DONE | Migrations `001` through `019` and the development seed are applied; live integration tests verify constraints, RPCs, grants, routing data, and idempotency. |
| `DB-03` | Tenant Row Level Security | DONE | A live three-user/two-organization integration test proves cross-tenant reads are hidden, writes are denied, and analyst writes are denied. |
| `DB-04` | Development seed | DONE | Local seed data is applied and later onboarding creates Auth-linked tenant memberships safely. |
| `AUTH-01` | Supabase email authentication | READY | Sign in, sign out, session restoration, generic error state, and route protection are implemented; public tunnel signup and authenticated API access are live-verified. |
| `AUTH-02` | Password recovery | READY | Generic reset request plus explicit PKCE-code, token-hash, and implicit-token callback exchange now establish the recovery session before showing the new-password form; production browser verification remains gated. |
| `AUTH-03` | Email OTP signup | READY | Public signup requests account-creating email OTPs, verifies the code, and routes new users into workspace onboarding; hosted email-template configuration and live delivery verification remain. |
| `ORG-01` | Organization onboarding | READY | Membership gate, onboarding UI/API, OWNER membership transaction, and default supplier creation are implemented; public tunnel creation/read is live-verified. |
| `ORG-02` | Roles and server authorization | DONE | Worker and database role boundaries are live integration-tested for owner, analyst, and cross-tenant access. |
| `ORG-03` | Workspace settings | DONE | Owner/admin-controlled organization name and timezone persist through an audited RPC; mandatory security controls are presented as enforced and live update/audit/restore verification passes. |
| `ORG-04` | Tenant-visible member profiles | DONE | Auth signup/update synchronizes a safe display name; tenant RLS exposes only shared-workspace teammates, and project manager reads never expose internal IDs as labels. |
| `AUD-01` | Privileged action audit trail | DONE | Live integration verifies project creation/update/transitions, directory changes, market/quota changes, supplier assignments, fraud resolution, and rule administration audit records. |

### M3 - Projects, clients, suppliers, and markets

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `PRJ-01` | Project Center table UI | READY | PM-scoped API supports distinct internal-ID/general search, all-client/all-type facets, durable manager facets, multi-status filtering, newest-first pagination, safe CSV export, and role-aware New Project access; browser evidence and hosted rollout remain pending. |
| `PRJ-02` | Project summary metrics | READY | Status counts, event outcomes, monthly Overview completes, and average respondent duration are connected in Supabase mode with demo fallback. |
| `PRJ-03` | Demo project API | DONE | The explicit no-credentials fallback covers list/detail/create/update, transitions, markets, and assignments for local demonstrations. |
| `PRJ-04` | Persistent project read API | DONE | Live Worker integration proves authenticated tenant-scoped detail and filtered/paginated list reads from Supabase. |
| `PRJ-05` | Persistent project creation | DONE | Live Worker integration proves existing-client-only atomic creation with controlled type/category, current created date, signed-in PM, first market, multiple saved suppliers, survey URL, and security URL; malformed quota, LOI, incidence, and URL inputs are rejected. |
| `PRJ-06` | Project update API | DONE | Live Worker integration proves validated atomic persistence and the corresponding audit record. |
| `PRJ-07` | Project state transitions | DONE | Hosted migration and automated rules implement PENDING, LIVE, PAUSED, ID_SUBMITTED, INVOICED, and CLOSED with audited controlled transitions; existing DRAFT records were normalized to PENDING. |
| `PRJ-08` | Project detail UI | READY | API-backed detail loading/editing, created date, survey/security URLs, average duration, lifecycle actions, markets, and expanded supplier comparison render in mock/Supabase modes; non-operators remain read-only. |
| `PRJ-09` | Project manager and survey configuration | DONE | Creation assigns the authenticated operator; audited create/read/update flows persist validated project survey and security-termination URLs while directory records own outcome routing. |
| `MKT-01` | Multi-market editor | DONE | Live Worker integration replaces two unique country-language rows atomically and verifies the audit record. |
| `MKT-02` | ISO market option catalog | READY | Hosted creation and market editing expose the complete ISO 3166-1 alpha-2 country and ISO 639-1 language catalogs with API allowlist validation; browser interaction evidence remains pending. |
| `QTA-01` | Quota management | DONE | Live Worker integration proves positive market quotas and the 150-response project quota roll-up. |
| `CLI-01` | Client directory UI | READY | Searchable numbered list remains above create/edit; View opens a modal with four same-origin masked links, individual/copy-all actions, and a separate redirect-variable editor; browser evidence remains. |
| `CLI-02` | Client CRUD | READY | Client destination URLs are excluded while validated redirect-variable definitions persist through migration `021`; local API coverage passes and hosted migration/live verification remain. |
| `SUP-01` | Supplier directory UI | READY | Create/edit UI includes contacts, STATIC/DYNAMIC mode, four outcome destinations, and copyable Test/Live links without the obsolete supplier-type choice. |
| `SUP-02` | Supplier CRUD | DONE | Live Worker integration proves tenant-scoped contact/redirect create/update, persistent reads, opaque token generation, constraints, and audit records. |
| `SUP-03` | Project supplier assignment UI | READY | Operators manage supplier ID, CPI, quota, and traffic state while viewing ST/RC/CO/TE/OQ/QT, IR, cost, redirect mode, and copyable project Test/Live links; PAUSED/CLOSED stops live routing. |
| `SUP-04` | Persistent supplier assignment | DONE | Live Worker integration proves atomic assignment replacement for supplier project ID, CPI, quota, status, tenant authorization, and audit history. |

### M4 - Sessions, events, and operational metrics

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `EVT-01` | Survey session schema | DONE | Live Worker integration persists five respondent sessions and all seven planned immutable event types. |
| `EVT-02` | Append-only event ingestion service | DONE | Live timestamped HMAC requests invoke the service-role-only RPC for every planned event type. |
| `EVT-03` | Duplicate transaction handling | DONE | Live replay returns the original event with `created: false`; metrics remain single-counted. |
| `MET-01` | Metrics aggregation service | DONE | Live views correctly aggregate starts, reached-client, complete, terminate, over-quota, quality terminate, abandon/conversion rates, supplier cost, and average respondent duration. |
| `MET-02` | Live Project Center metrics | DONE | Live tenant-scoped list/detail responses return the persisted five starts and one complete. |
| `MET-03` | Supplier comparison metrics | DONE | Live assignment delivery returns five starts, one complete, and the expected 8.75 supplier cost. |
| `RSP-01` | Respondent/session explorer | DONE | Project filter/search returns normalized chronological timelines with supplier CPI and duration; a formula-safe per-project/all-project CSV export supports up to 1,000 rows. |
| `ANA-01` | Analytics UI | READY | Date controls, source comparisons, supplier conversion/IR/cost indicators, and formula-safe portfolio/supplier/client/market CSV export are implemented with demo fallback. |
| `ANA-02` | Persistent analytics API | DONE | Live date-bounded tenant analytics returns the expected portfolio events and supplier cost from persisted data. |

### M5 - Provider integrations and callbacks

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `PROV-01` | Provider adapter interface | DONE | Shared provider types isolate launch URL construction, callback normalization, verification routing, and core event processing; contract and live callback-path tests pass. |
| `CPX-01` | CPX adapter | BLOCKED | Isolated test-mode mapping and contract coverage exist; official sandbox payload/signature documentation and credentials are required before claiming CPX compatibility. |
| `BIT-01` | BitLabs adapter | BLOCKED | Isolated test-mode mapping and contract coverage exist; official sandbox payload/signature documentation and credentials are required before claiming BitLabs compatibility. |
| `PURE-01` | PureSpectrum adapter | BLOCKED | Isolated test-mode mapping and contract coverage exist; official sandbox payload/signature documentation and credentials are required before claiming PureSpectrum compatibility. |
| `CBK-01` | Callback routing | DONE | Live signed CPX, BitLabs, and PureSpectrum test callbacks normalize and persist through dedicated provider routes. |
| `CBK-02` | Fast callback acknowledgement | DONE | Live callback paths perform only signature validation, normalization, and the atomic event write before returning success. |
| `CBK-03` | Callback observability | DONE | Live provider responses carry request IDs; structured records cover provider, outcome, rejection, throttling, status, and latency without sensitive identifiers. |
| `RDR-01` | Opaque live respondent routing | DONE | Live verification proves opaque supplier links enforce active state/quota, record events, apply fraud/security checks, mask all client callbacks, redirect into the project survey, and return the final outcome to the supplier destination. |

### M6 - Security and fraud controls

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `SEC-01` | Provider signature verification | DONE | Timestamp-plus-raw-body HMAC, expiry rejection, constant-time comparison, unsigned rejection, and live signed callbacks are verified. |
| `SEC-02` | API authorization middleware | DONE | PostgREST validates bearer JWTs while the shared guard enforces tenant membership and role; owner, analyst, and cross-tenant behavior is live-tested. |
| `SEC-03` | Rate limiting | DONE | Callback, generic event, password login, signup, and recovery endpoints enforce per-origin limits with Retry-After responses; automated boundary tests pass. |
| `SEC-04` | Secret management | DONE | Service-role, ingestion, callback, and fraud secrets remain server-only Worker bindings, are absent from browser variables/responses/logs, and have documented hosted-secret procedures. |
| `FRD-01` | Duplicate IP/device controls | DONE | Live repeated IP/device inputs create high-severity flags from server-only HMAC fingerprints without persisting raw identifiers. |
| `FRD-02` | Speeding and quality rules | DONE | Live rapid completion creates an explainable speeding flag; trusted quality-signal rule behavior is migration- and API-tested. |
| `FRD-03` | Research Defender integration | BLOCKED | Requires a product decision, current API contract, and credentials; native fraud controls remain independent. |
| `FRD-04` | Fraud review queue | DONE | Live tenant-scoped review returns project-linked flags and persists an operator CONFIRMED resolution with audit history; capability metadata makes analyst/member views explicitly read-only and omits decision controls. |

### M7 - Notifications and financials

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `NOT-01` | Transactional email provider | BLOCKED | Email channel preferences are modeled, but delivery requires selecting a provider and supplying credentials. |
| `NOT-02` | Operational alerts | DONE | Live lifecycle notifications persist, read state updates, all seven administrator rules round-trip, the UI edits and persists pacing thresholds with role-aware read-only behavior, malformed rule sets are rejected, and the shell badge derives its unread count from the protected API; hosted scheduling remains a deployment concern. |
| `FIN-01` | Project financial model | BLOCKED | Revenue recognition, supplier liability, currency/FX, taxes, adjustments, and reconciliation rules require a commercial decision. |
| `FIN-02` | Financials UI | BLOCKED | Depends on the approved `FIN-01` model and permission decisions; supplier event cost is already visible operationally. |
| `FIN-03` | Export and reconciliation | BLOCKED | Depends on approved financial rules, required export format, and accounting ownership. |

### M8 - Testing, operations, and deployment

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `TST-01` | Unit/business-rule tests | DONE | Lifecycle, rate-limit, safe CSV, authorization, signatures, mappings, URL validation, auth throttling, disposable password recovery, live idempotency, metrics, fraud, callbacks, directories, and notifications coverage pass; financial tests belong to the blocked financial model. |
| `TST-02` | Database/RLS integration tests | DONE | Live local Supabase test covers three users, two tenants, owner/analyst roles, cross-tenant denial, atomic project creation, and event replay idempotency. |
| `TST-03` | Provider contract tests | BLOCKED | Test-mode adapter fixtures pass; recorded official/sandbox fixtures require vendor contracts and credentials. |
| `TST-04` | Playwright E2E vertical slice | BLOCKED | The authenticated stack and test-user creation are ready, but the supported browser-control runtime cannot initialize its trusted dependency in this environment. |
| `TST-05` | Accessibility and responsive QA | BLOCKED | Static JSX accessibility lint passes; keyboard, focus, contrast, and viewport evidence requires the blocked supported browser-control runtime. |
| `OPS-01` | Structured logging and error tracking | BLOCKED | Request IDs and sanitized structured logs are implemented and verified; selecting and credentialing an external error-tracking sink remains a product/operations decision. |
| `OPS-02` | Backup/recovery procedure | DONE | Procedures are documented and an isolated scoped dump/restore drill validated organizations, projects, sessions, events, audits, fraud, notifications, and migration `015`, then removed all temporary artifacts. |
| `DEP-01` | Cloudflare configuration | DONE | Public/server-only variables, runtime bindings, secret boundaries, staging/promotion gates, named-tunnel requirements, monitoring, rollback, and a working Wrangler tunnel launcher are documented and verified locally. |
| `DEP-02` | Staging deployment | READY | Publicly reachable Sites version 2 is deployed with mandatory ResearchOps authentication, hosted Supabase in `ap-south-1`, migrations `001`-`020`, hosted secrets, and Auth redirects; authenticated browser health/readiness and critical-flow evidence remain gated by the unavailable browser surface. |
| `DEP-03` | Production deployment | BLOCKED | Requires approved staging evidence, production Cloudflare/Supabase access, monitoring sink, backup ownership, and commercial/provider decisions. |
| `DEP-04` | Named Cloudflare Tunnel | BLOCKED | Requires a Cloudflare account, owned domain/hostname, access policy decision, and tunnel credentials; verified Quick Tunnel remains development-only. |

## Milestone exit criteria

| Milestone | Exit criteria | State |
|---|---|---|
| M1 Foundation | All routes render, core prototype flows work, build/type/smoke checks pass. | COMPLETE |
| M2 Persistent core | Real auth, organization tenancy, applied RLS, and persistent project CRUD pass integration tests. | COMPLETE |
| M3 Operational CRUD | Clients, suppliers, markets, quotas, assignments, and state transitions are production-connected. | COMPLETE |
| M4 Events and metrics | Trusted events generate accurate project and supplier metrics. | COMPLETE |
| M5 Providers | CPX, BitLabs, and PureSpectrum work through isolated, tested adapters and callbacks. | NOT STARTED |
| M6 Security | Authorization, signatures, abuse controls, fraud checks, and auditability pass review. | COMPLETE for native controls; Research Defender remains an optional blocked external integration |
| M7 Commercial operations | Notifications and financial workflows are reconciled and permissioned. | BLOCKED - notifications pass; financial decisions are missing |
| M8 Production readiness | E2E, accessibility, observability, staging, backup, deployment, and rollback are verified. | NOT STARTED |

## Environment and credentials checklist

Do not record secret values here. Mark only whether they are available.

| Requirement | State | Notes |
|---|---|---|
| Node.js 22.13+ | AVAILABLE | Node 24.19 was used for the latest verification. |
| npm dependencies | AVAILABLE | Installed in the current workspace. |
| Local Docker/Supabase | AVAILABLE | Minimal local stack is running; API and database are exposed only on loopback. |
| Supabase project URL | AVAILABLE | Local development URL is configured outside source control. |
| Supabase anon key | AVAILABLE | Local public development key is configured outside source control. |
| Supabase service-role key | AVAILABLE | Local server-only development key is passed only to the Worker runtime. |
| CPX sandbox credentials | MISSING | Required for `CPX-01`. |
| BitLabs sandbox credentials | MISSING | Required for `BIT-01`. |
| PureSpectrum sandbox credentials | MISSING | Required for `PURE-01`. |
| Email provider credentials | MISSING | Provider not selected. |
| Research Defender credentials | MISSING | Integration decision and credentials not supplied. |
| Sites deployment access | AVAILABLE | A private ResearchOps Sites project and source repository were created on 2026-08-29. |
| Hosted Supabase access | AVAILABLE | The ResearchOps Free project is deployed in `ap-south-1`; schema, authentication users, and application data were migrated on 2026-08-29. |
| Supported browser-control surface | UNAVAILABLE | Browser discovery returned no connected in-app, Chrome, or Edge surface; required for `TST-04`/`TST-05`. |

## Architecture decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-08-18 | Use React/TypeScript on the Cloudflare-compatible Vinext/Vite starter. | Keeps React routes and Worker deployment in one project while following the available Sites workflow. |
| 2026-08-18 | Use Supabase/PostgreSQL as the system of record. | Provides Auth, relational data, PostgreSQL constraints, and Row Level Security. |
| 2026-08-18 | Keep provider secrets and privileged writes in the Worker. | Browser bundles cannot safely hold secrets or assert trusted completion events. |
| 2026-08-18 | Store append-only survey events and derive operational metrics. | Prevents mutable counters from becoming the only source of truth. |
| 2026-08-18 | Use mock data only for the M1 vertical slice. | Allows UI and interaction work before database credentials are available. |
| 2026-08-18 | Keep one environment-aware application path: authenticated Supabase mode when configured and labeled demo mode otherwise. | Lets development continue without credentials while preventing mock data from being mistaken for live persistence. |
| 2026-08-18 | Forward each user's access token to Supabase and rely on RLS for project operations. | Preserves tenant identity end to end and avoids using a service-role key for ordinary CRUD. |
| 2026-08-18 | Keep provider-specific code behind adapters. | Prevents CPX, BitLabs, or PureSpectrum behavior from leaking into pages and core services. |
| 2026-08-18 | Use Quick Tunnels only for development demonstrations. | Cloudflare documents that random `trycloudflare.com` tunnels have no uptime guarantee and are not production hosting. |
| 2026-08-25 | Keep client/supplier outcome configuration in their directories and project-level configuration limited to the survey/security entry points. | Matches the call workflow, avoids duplicating redirect ownership per project, and keeps opaque callbacks stable across assignments. |
| 2026-08-25 | Scope Project Center to the authenticated PM while keeping Overview organization-wide. | Preserves an operator-focused work queue without hiding portfolio health from authorized workspace readers. |
| 2026-08-25 | Use one signed-in project manager and the existing secure role model until explicit requirements approve broader edit ownership. | Resolves conflicting transcript phrasing without weakening established authorization boundaries. |
| 2026-08-29 | Prefer the repository-native Sites/Cloudflare Worker runtime with Supabase Free over Vercel or Render for initial hosting. | The application already builds as a Cloudflare Worker; Render free services sleep and its free Postgres expires, while Vercel Hobby is personal/non-commercial and would require a runtime adaptation. |
| 2026-08-29 | Make Sites staging publicly reachable while retaining mandatory Supabase authentication and server-side authorization. | Allows external ResearchOps users to reach the login page without granting anonymous access to protected data or APIs. |
| 2026-08-29 | Use PENDING, LIVE, PAUSED, ID_SUBMITTED, INVOICED, and CLOSED as the project lifecycle, with new `ROP-` internal IDs and snapshot manager names. | Matches the transcript's operational workflow while separating fieldwork completion, ID delivery, invoicing, and final closure and preserving historical ownership. |
| 2026-08-29 | Keep client survey URLs on projects, platform callback URLs on client records, and supplier outcome destinations on supplier records. | This is the industry-aligned mediator model described by the conversation and preserves the already verified masked-routing implementation. |

## Known blockers and risks

| ID | Blocker / risk | Resolution |
|---|---|---|
| `BLK-01` | RESOLVED - hosted Supabase staging and Sites runtime credentials are configured. | Keep credentials in Supabase/Sites secret stores and verify authenticated hosted flows when browser control is available. |
| `BLK-02` | No supported browser-control surface is connected for E2E/accessibility evidence. | Connect the in-app browser or supported Chrome/Edge extension, then run authenticated keyboard, responsive, and critical-flow checks against the live tunnel. |
| `BLK-03` | Provider API contracts and credentials are not available. | Obtain current sandbox documentation and credentials before M5 implementation. |
| `BLK-04` | Financial rules and currency requirements are not defined. | Confirm billing, supplier liability, adjustment, tax, and FX rules before M7. |
| `BLK-05` | RESOLVED - Sites staging is publicly reachable and the ResearchOps login remains mandatory. | Keep protected APIs authenticated and verify external-account browser flows when browser control is available. |
| `BLK-06` | RESOLVED - hosted migration `020` and Sites version 2 were explicitly approved and deployed. | Monitor the production workflow and retain migration/rollback procedures. |
| `BLK-07` | PRJ-1125 live routing cannot be activated: the hosted project is PENDING with no client survey URL, and the supplier token copied in the reported link is stale/not present in the hosted supplier directory. | Configure the intended HTTP(S) client survey URL, select or create an active hosted supplier assignment, then move the assignment to ACTIVE and the project to LIVE; suppliers must replace `{{respondent_id}}` with their respondent ID. |
| `BLK-08` | Vercel production deployment requires explicit approval to store the hosted Supabase service-role credential in Vercel's encrypted production environment. | Approve that secret transfer, or authorize a larger backend redesign that removes privileged service-role operations from the Vercel runtime. |
| `BLK-09` | RESOLVED - migration `021` was applied through the authenticated Supabase dashboard. OTP template configuration and deletion of Auth users remain operator dashboard actions because browser control and local CLI execution are unavailable. | Place `{{ .Token }}` in the Magic Link email template and delete users only after confirming project ref `cmrktkzdptmywrtscalu`. |

## Verification record

| Date | Check | Result |
|---|---|---|
| 2026-08-18 | `npm run build` | PASS |
| 2026-08-18 | `tsc --noEmit` | PASS |
| 2026-08-18 | `node --test tests/rendered-html.test.mjs` | PASS - 2 tests |
| 2026-08-18 | `GET /projects` on local dev server | PASS - HTTP 200 |
| 2026-08-18 | `GET /api/health` on local dev server | PASS - healthy |
| 2026-08-18 | Cloudflare Quick Tunnel connection | PASS - tunnel created and registered over QUIC; Cloudflare connectivity pre-checks passed |
| 2026-08-18 | `GET /api/readiness` through production server | PASS - application/API healthy; database correctly reports not configured |
| 2026-08-18 | `npm run lint` after M2 code-ready changes | PASS |
| 2026-08-18 | `npm test` after M2 code-ready changes | PASS - production build and 2 smoke tests, including mock project creation |
| 2026-08-18 | Fresh local production server and Cloudflare Quick Tunnel after M2 changes | PASS - local health/readiness/projects and public health/readiness/projects returned HTTP 200; readiness correctly reports mock data |
| 2026-08-18 | `npm run lint` and `npm test` after `PRJ-04` query controls | PASS - build and smoke tests cover filtering, sorting, exact totals, and pagination |
| 2026-08-18 | Updated `PRJ-04` build through a fresh Cloudflare Quick Tunnel | PASS - public Project Center and combined filter/sort/pagination API returned HTTP 200 |
| 2026-08-18 | `npm run lint` and `npm test` after auth/roles/directories batch | PASS - 5 test groups cover recovery pages, directory pages/APIs, and read-vs-operate role enforcement |
| 2026-08-19 | `npm test` and `npm run lint` after notifications, unit coverage, and API observability | PASS - production build and 7 tests |
| 2026-08-19 | Fresh local production origin and Cloudflare Quick Tunnel | PASS - local/public health healthy and public Project Center HTTP 200; database correctly reports not configured/mock |
| 2026-08-19 | Local Supabase migrations `001`-`015` and seed | PASS - schema, grants, RPC fixes, and seed applied successfully |
| 2026-08-19 | Live Supabase integration test | PASS - tenant isolation, roles, project transaction, event persistence, and replay idempotency verified |
| 2026-08-19 | `npm test` and `npm run lint` after same-origin Supabase gateway | PASS - production build, 8 standard tests, 1 environment-gated integration test, and lint |
| 2026-08-19 | Local Worker plus public Quick Tunnel with Supabase | PASS - readiness reports configured/supabase-ready; auth gateway, signup, workspace creation, and authenticated read succeed publicly |
| 2026-08-19 | Fresh public Quick Tunnel attached to existing local Worker | PASS - public health healthy and readiness reports configured/supabase-ready |
| 2026-08-19 | Live M3 Worker/Supabase operator workflow | PASS - onboarding, client/supplier CRUD, project create/update, markets, quota roll-up, supplier assignment, lifecycle, filtered read, and nine audit action classes |
| 2026-08-19 | Live M4 event/metrics/respondent/analytics workflow | PASS - all seven event types, replay idempotency, project/supplier metrics, respondent timeline, and date-bounded analytics match persisted facts |
| 2026-08-19 | Live provider/fraud workflow | PASS - three signed provider callbacks persist, duplicate IP/device and speeding flags appear, and operator resolution is audited |
| 2026-08-19 | Live notification workflow | PASS - lifecycle inbox, read state, seven rules, and persisted pacing threshold verified |
| 2026-08-19 | Auth gateway throttling | PASS - eleventh password-login request returns 429 with Retry-After after ten upstream attempts |
| 2026-08-19 | Isolated logical backup/restore drill | PASS - application/auth/migration schemas restored; core record counts and migration `015` verified; temporary database and dump removed |
| 2026-08-19 | Final standard verification | PASS - production build, 9 standard tests, 3 environment-gated integration suites, and lint |
| 2026-08-19 | Fresh final Quick Tunnel | PASS - public readiness is configured/supabase-ready; Auth health, login page, signup, and persistent workspace creation return successfully |
| 2026-08-21 | Public UI and authentication regression check | PASS - login and Project Center HTML, all 18 referenced CSS/JavaScript assets, auth health, temporary signup, and password login succeeded through the Quick Tunnel; test account removed |
| 2026-08-21 | Strengthened tunnel launcher verification | PASS - PowerShell parses, lint passes, 9 standard tests pass with 3 environment-gated suites skipped, and a fresh tunnel reports ready/configured/supabase-ready only after public UI/CSS/auth checks succeed |
| 2026-08-21 | Tunnel navigation hardening | PASS - page-to-page controls compile to native anchors, lint and the production build pass, 9 standard tests pass with 3 environment-gated suites skipped, and the replacement tunnel reports ready/configured/supabase-ready |
| 2026-08-22 | Inert-control audit and Project Center export | PASS - safe quoted CSV unit coverage passes; lint passes; production build and 10 standard tests pass with 3 environment-gated suites skipped |
| 2026-08-22 | Migration `016` and workspace settings | PASS - migration applied; owner update, timezone persistence, `ORGANIZATION_SETTINGS_UPDATED` audit record, and restoration verified live; build, 10 standard tests, and lint pass |
| 2026-08-22 | Disposable password recovery lifecycle | PASS - real recovery link generation, recovery-session verification, password update, new-password login, replay rejection, and test-user removal pass against local Supabase |
| 2026-08-22 | Standard suite after recovery coverage | PASS - production build and 10 standard tests pass with 4 environment-gated integration suites skipped; lint passes |
| 2026-08-22 | Migration `017` and project redirect persistence | PASS - migration applied; authenticated create/update/detail round-trip preserves complete, terminate, and quota-full URLs; standard production build, 10 tests, and lint pass |
| 2026-08-22 | Fresh public runtime after migration `017` | PASS - Quick Tunnel readiness reports ready with the local database configured |
| 2026-08-22 | Project-creation validation hardening | PASS - invalid fractional quota, non-positive LOI, out-of-range incidence, malformed date, and unsafe redirect inputs return 400; production build, 10 standard tests, and lint pass |
| 2026-08-22 | Notification rule administration audit | PASS - pacing threshold is exposed in the UI, owner persistence passes live, analyst metadata is read-only and update returns 403, incomplete/out-of-range rule sets return 400; build, 10 standard tests, and lint pass |
| 2026-08-22 | Migration `018` and manager profile fidelity | PASS - migration applied; authenticated profile sync, human-readable detail/facet labels, UUID-backed manager filtering, and tenant-scoped project result pass live; build, 10 standard tests, and lint pass |
| 2026-08-22 | Directory role-aware controls | PASS - owner directory capability passes live; analyst client reads report read-only, mutation controls are omitted by the UI contract, and direct write authorization remains 403; build, 10 standard tests, and lint pass |
| 2026-08-22 | Project Center/create role-aware controls | PASS - owner project capability passes live; analyst list metadata reports read-only and writes remain 403; Project Center omits New Project and creation submission is disabled for non-operators; build, 10 standard tests, and lint pass |
| 2026-08-22 | Project detail role-aware controls | PASS - owner detail capability passes live; analyst capability and 403 mutation boundaries pass; lifecycle, core edit, market, and supplier controls consume the protected capability; build, 10 standard tests, and lint pass |
| 2026-08-22 | Dashboard role-aware project shortcut | PASS - Dashboard consumes protected project capability and replaces New Project with read-only status for non-operators; project capability owner/analyst contracts, build, 10 standard tests, and lint pass |
| 2026-08-22 | Fraud Review role-aware controls | PASS - owner capability and resolution pass live against Supabase; analyst reads report `canOperate: false`, direct resolution returns 403, and the UI replaces decision controls with an awaiting-operator state; production build, 10 standard tests, and lint pass |
| 2026-08-25 | Protected testing owner auto-login | PASS - disabled-by-default and missing-cookie denial tests pass; protected entry cookie issues a real local Supabase OWNER session; service credentials remain server-only; production build, 13 standard tests, lint, PowerShell parsing, local OWNER API access, and public tunnel surface pass |
| 2026-08-25 | Migration `019` call-feature schema/API verification | PASS - contacts/outcomes, redirect tokens/modes, project survey/security URLs, admin-only client writes, v3 project RPCs, and average-duration view applied locally |
| 2026-08-25 | Standard verification after call-feature implementation | PASS - lint and production build pass; 13 standard tests pass with 4 environment-gated suites skipped |
| 2026-08-25 | Live Worker/Supabase workflow after migration `019` | PASS - authenticated directory/project/market/supplier/event/fraud/respondent/analytics/provider/notification workflow passes against local persistence |
| 2026-08-25 | Masked redirect routing | PASS - supplier Live returns 302 to the project survey and the opaque client completion callback returns 302 to the configured supplier destination with events persisted |
| 2026-08-25 | Tunnel launcher active-key refresh | PASS - Windows PowerShell native-stderr handling corrected; launcher reports active service binding refreshed and readiness reports configured/supabase-ready |
| 2026-08-25 | Development tunnel stylesheet validation | PASS - PowerShell parses and lint passes; `npm run tunnel:dev` starts on port 3001, creates a Quick Tunnel, and the public login page and Vite stylesheet return HTTP 200 with `text/css` |
| 2026-08-27 | Protected owner Quick Tunnel restart | PASS - local Supabase and the production Worker started successfully; the Quick Tunnel generated a fresh protected OWNER auto-login link and its public health endpoint returned `healthy` |
| 2026-08-29 | Protected owner Quick Tunnel restart | PASS - replaced the previous verified tunnel process tree, rebuilt the production app, confirmed configured database readiness, and registered a fresh Cloudflare QUIC tunnel; local hostname propagation remained pending during the short verification window |
| 2026-08-29 | Permanent hosting preparation | PASS - production build passes; private Sites project and source repository created; exact validated source committed and pushed without environment files, credentials, or local Supabase state |
| 2026-08-29 | Hosted Supabase migration | PASS - migrations `001`-`019` applied; 14 application-table counts and 77 Auth users exactly match local source; hosted credentials stored only in Sites/Supabase |
| 2026-08-29 | Private Sites staging deployment | PASS - version 1 published owner-only at the permanent staging URL with environment revision 1; unauthenticated access returns HTTP 401 as expected |
| 2026-08-29 | Hosted user provisioning | PASS - requested email account created through the Supabase Admin API with email confirmed; no credential value was written to the repository or tracker |
| 2026-08-29 | Second hosted user provisioning | PASS - second requested email account created through the Supabase Admin API with email confirmed; no credential value was written to the repository or tracker |
| 2026-08-29 | Public Sites access with application auth | PASS - public root and login routes return HTTP 200 while an unauthenticated protected API request returns HTTP 401 |
| 2026-08-29 | Transcript workflow standard suite | PASS - production build, 13 standard tests, and lint pass after status, search/filter, ID, manager-history, project-type, routing-label, and ISO market changes |
| 2026-08-29 | Local migration `020` | PASS - migration applied to local Supabase; new projects receive `ROP-` IDs and PENDING status, controlled transition and project query paths pass live; the event RPC passes directly with current local credentials |
| 2026-08-29 | Production transcript-workflow rollout | PASS - hosted migration `020` applied and Sites version 2 published; production login returns HTTP 200 with ResearchOps content and unauthenticated project API access remains HTTP 401 |
| 2026-08-29 | PRJ-1125 production routing diagnosis | BLOCKED SAFELY - production is bound to the expected hosted Supabase project; PRJ-1125 is PENDING and has no survey URL, the reported supplier token is absent from the hosted directory, and the exact public route currently returns HTTP 404 without starting a respondent session |
| 2026-08-29 | Pre-deployment standard verification after routing diagnosis | PASS - production build, 13 standard tests, and lint pass; 4 credential-gated integration suites skipped as designed |
| 2026-08-29 | Sites version 3 production deployment | PASS - exact pushed commit `19de1c7` packaged and published; the live login returns HTTP 200 with ResearchOps content and unauthenticated project API access remains HTTP 401 |
| 2026-08-30 | Vercel adapter build | PARTIAL PASS - Nitro/Vercel Build Output was generated with frontend and ResearchOps middleware/backend included; Windows preview exposed a platform-specific generated-module resolution issue, so Vercel's Linux remote build remains the deployment verification gate |
| 2026-08-30 | GitHub source security audit | PASS - tracked files and 161 reachable historical blobs contain no high-confidence private-key or provider-token patterns; local environment files and deployment/runtime state remain ignored |
| 2026-08-30 | Vercel React runtime-condition fix | PASS LOCALLY - the Vercel build completes when the parent deployment environment enables `react-server`, while the Vite subprocess runs without that incompatible condition; standard build, 13 tests, and lint pass |
| 2026-08-30 | Vercel Vinext worker packaging | PASS LOCALLY - the generated Vercel handler imports without special Node conditions and returns HTTP 200 for `/api/health` and `/login`; standard build, 13 tests, and lint pass |
| 2026-08-30 | Deterministic Vercel Build Output | PASS LOCALLY - a build launched with Vercel's environment flag emits the complete fetch worker, Build Output API v3 function/static layout, and HTTP 200 responses for `/api/health` and `/login`; lint passes |
| 2026-08-30 | Client redirect separation and email OTP signup | PASS LOCALLY - lint, 14 standard tests, production build, Vercel Build Output, and diff validation pass; 4 credential-gated integration suites skip as designed |
| 2026-08-30 | Password recovery callback handling | PASS LOCALLY - all three supported Supabase recovery callback shapes are covered; lint, 15 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Hosted migration `021` and GitHub rollout | USER-CONFIRMED/PUSHED - migration SQL ran in Supabase and commits `88f0d05` plus `1242abb` were pushed to GitHub main for automatic Vercel deployment |
| 2026-08-30 | Recovery callback race hardening | PASS LOCALLY - an already-established session is accepted when automatic URL detection wins the exchange race; lint, 15 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Email OTP token-type compatibility | PASS LOCALLY - verification accepts unified email, new-user signup, and legacy magic-link token types; lint, 17 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Production Supabase Auth POST proxy transport | PASS LOCALLY - outbound requests use an explicit Supabase header allowlist and preserve JSON bodies; lint, 18 standard tests, production build, Vercel Build Output, and diff validation pass; live rollout remains pending |
| 2026-08-30 | Production Supabase Auth POST proxy rollout | PASS - GitHub commit `c91e1db` reached Vercel and the live password-token endpoint changed from gateway HTTP 502 to the expected Supabase HTTP 400 for invalid credentials |
| 2026-08-30 | Requested replacement Auth account | OPERATOR ACTION - production signup returns `user_already_exists`; Vercel correctly prevents secret export and browser control is unavailable, so the exact existing user must be deleted/recreated in the authenticated Supabase dashboard |

## Session log

### 2026-08-30 - Production Supabase Auth POST proxy fix

- Reproduced production login and signup failures as HTTP 502 responses from the same-origin Supabase gateway while the upstream Auth health request continued to return HTTP 200.
- Replaced deployment-header forwarding with a narrow Supabase-compatible allowlist and normalized non-GET request bodies for the Vercel Node runtime.
- Added built-worker regression coverage proving Auth POST bodies, authorization, and API-key headers reach Supabase without hop-by-hop or Vercel forwarding headers.
- Lint, 18 standard tests, production build, Vercel Build Output, and `git diff --check` pass. Next task is GitHub/Vercel rollout, live POST verification, and creation of the requested replacement account.
- Pushed commit `c91e1db`; live password-token traffic now reaches Supabase and returns the expected HTTP 400 invalid-credential response instead of HTTP 502.
- The requested email is already registered. Public signup correctly refuses to overwrite its password; Vercel did not export the encrypted production service-role secret, the temporary environment file was removed, and browser control was unavailable. The remaining safe action is deleting and recreating that exact user in Supabase Authentication > Users, followed by a password-login check.

### 2026-08-30 - Password recovery redirect-loop fix

- Diagnosed that the reset screen depended on an already-restored session and did not explicitly consume recovery credentials returned by Supabase.
- Added recovery initialization for PKCE `code`, `token_hash` with recovery type, and implicit access/refresh-token links; successful exchange removes sensitive URL material before showing the new-password form.
- Added callback-shape regression coverage. Lint, 15 standard tests, production build, Vercel Build Output, and `git diff --check` pass; live verification requires deployment and a newly generated recovery link.
- After the hosted migration was user-confirmed applied, pushed commits `88f0d05` and `1242abb` to GitHub main to trigger the connected Vercel deployment.
- Hardened recovery initialization against Supabase automatic URL detection consuming the callback first: an exchange error now falls back to the valid session already established by the SDK instead of incorrectly displaying an expired-link state.
- Made email OTP verification compatible with Supabase's template-dependent token types (`email`, `signup`, and `magiclink`) so codes issued from either Confirm signup or Magic Link templates can establish the session; regression tests cover fallback and total rejection.

### 2026-08-30 - Client redirect variables and email OTP signup

- Reworked the client directory so the searchable numbered list stays above create/edit, View opens a detail modal, and client destination URL fields are no longer accepted, stored, or returned.
- Added four copyable same-origin masked outcome links carrying `respondent_id` and `project_id` placeholders plus an isolated, validated redirect-variable editor persisted by migration `021`; supplier redirect configuration remains unchanged.
- Added public email-OTP signup and verification with onboarding handoff, plus a login-to-signup route and server-render coverage.
- Lint, 14 standard tests, the production build, Vercel Build Output, and `git diff --check` pass; 4 credential-gated suites skip as designed.
- Hosted operations are not claimed complete: browser control failed to initialize and Windows Application Control blocked the linked Supabase CLI binary, so migration `021`, OTP-template configuration, the requested Auth-user deletion, deployment, and live verification remain the current task under `BLK-09`.

### 2026-08-30 - Vercel build/runtime condition separated

- Diagnosed the production HTTP 500 as Vercel starting the Vinext server function without React's required `react-server` condition; the failure occurs before Supabase access.
- Confirmed that adding project-level `NODE_OPTIONS=--conditions=react-server` fixes the runtime condition but also applies it to Vite, causing the build-time `createContext` export failure.
- Added a cross-platform Vercel build launcher that removes `NODE_OPTIONS` only from the Vite subprocess, while allowing the deployed function to retain the runtime condition.
- The exact conditioned-parent Vercel build simulation, standard production build, 13 standard tests, and lint pass; the next task is pushing this revision, restoring the Production `NODE_OPTIONS` variable, and verifying the remote Vercel runtime.
- Connected the configured Vercel project to GitHub; its first Git deployment was blocked because historical Codex commits used a local placeholder email, so the repository-local author is being changed to the owner's verified GitHub noreply identity for the next deployment trigger.
- The verified-author Git deployment builds successfully, but Vercel ignored both the dashboard and Nitro-generated function environment setting and the runtime still rejected React Server Components before database access.
- Added the required `react-server` condition to the repository-level Vercel function `env` configuration documented by Vercel; the Vercel build and lint pass, and the next task is remote runtime verification from the automatically triggered production deployment.
- Vercel Node 24 still initialized the function before applying the required React condition; pinned the repository to the supported Node 22 major while retaining the function startup configuration. The Vercel build and lint pass; remote Node 22 runtime verification is next.
- Confirmed that the remaining failure was a Nitro/Vinext packaging mismatch rather than an application, database, or credential fault: Nitro rebundled the RSC service against the client React export before request handling began.
- Replaced the failing Nitro function payload with Vinext's self-contained fetch worker while retaining Vercel Build Output routing and Node 22. The generated handler now imports without `NODE_OPTIONS` and returns HTTP 200 for both `/api/health` and `/login`; standard build, 13 tests, and lint pass. The next task is verifying the automatically triggered Vercel production deployment and then removing the obsolete dashboard `NODE_OPTIONS` variable.
- The first remote worker-package deployment showed that Vercel retained the function entry point but omitted its nested `worker/` payload, producing `ERR_MODULE_NOT_FOUND` before startup. Flattened the Vinext server payload into the `.func` root so its entry and traced server assets follow Vercel's function layout; remote verification is next.
- The flattened deployment then exposed a build-environment path difference: Vercel/Nitro stages Vinext RSC and SSR output under `node_modules/.nitro/vite/services`, while the local Cloudflare-style build uses `dist/server`. Updated packaging to detect both layouts and preserve the sibling SSR service when running under Nitro; conditioned local build and handler verification are required before the next push.
- Testing the staged Nitro RSC service proved it renders `/login` but returns 404 for `/api/health`, because ResearchOps middleware routes live outside that service. Replaced the environment-dependent Nitro packaging path with a deterministic build of the complete Vinext fetch worker and direct Vercel Build Output API v3 emission, retaining UI, APIs, authentication, and Supabase behavior in one function.
- The complete-worker deployment built successfully, then Vercel's isolated `/var/task` parsed Vinext's generated `.js` bundle as CommonJS because the repository-level ESM package metadata was outside the function artifact. Added a function-local `package.json` with `type: module`; the Vercel-environment build, generated handler, `/api/health` 200, `/login` 200, and lint pass. Remote verification is next.
- Removed the disabled testing auto-login probe from production clients by compiling it in only when `DEV_AUTO_LOGIN=true`; production login now performs only normal Supabase session and credential operations while the explicitly enabled local testing workflow remains available. The Vercel-mode client contains no testing-route reference; 13 standard tests, lint, and the Vercel build pass.

### 2026-08-30 - Sanitized GitHub source deployment

- Audited the tracked source and all 161 reachable historical Git blobs for high-confidence private-key, GitHub, AWS, Slack, Stripe, Google API, and JWT credential patterns; no deployable credential was found.
- Confirmed local environment files, Vercel metadata, Wrangler state, generated output, tunnel state, and local Supabase temporary state are excluded by `.gitignore` and no untracked file is eligible for the commit.
- The only current-tree credential-name matches are runtime environment-variable wiring and a short non-JWT test fixture; no server secret value is committed.
- Current task remains the browser-verification and external-integration gates in Current focus; next task remains completing those checks when their recorded dependencies become available.

### 2026-08-30 - Vercel migration prepared, secret approval pending

- Added a conditional Nitro Vercel build while preserving the existing Sites/Cloudflare build path and hosted Supabase architecture.
- Added Vercel project configuration and a Nitro middleware bridge so the current ResearchOps APIs, Supabase proxy, callbacks, and respondent routing can run in the Vercel function.
- Generated Vercel Build Output successfully after enabling Nitro server-directory scanning; the Windows preview surfaced a generated Linux-target module-resolution limitation, so the remote Linux build remains required.
- Authenticated the Vercel CLI and created/linked `researchops-fieldwork`; repository auto-connection failed because the existing Sites remote provider is not supported by Vercel, so deployment will use the CLI.
- The security gate rejected exporting the hosted Supabase service-role key without explicit approval. No hosted secret was transferred and no Vercel production deployment was created.
- Current task is obtaining explicit approval for encrypted Vercel storage of the service-role key (or choosing a backend redesign); next task is configuring production variables, deploying remotely, verifying auth/API/routing, and updating Supabase redirect allowlists. `BLK-08` records this decision.

### 2026-08-29 - Sites version 3 deployed

- Re-ran the production build, 13-test standard suite, and lint successfully before publishing.
- Pushed commit `19de1c7`, saved Sites version 3 from that exact source and verified it is the current live version at the permanent public URL.
- Verified the production login returns HTTP 200 with ResearchOps content and protected project API access remains HTTP 401 without authentication.
- The deployment preserves `BLK-07`: PRJ-1125 routing still requires its intended client survey URL and a valid hosted supplier assignment before traffic can be safely activated.
- Current task remains obtaining that routing configuration; next task is activating the assignment/project and verifying a real-respondent 302 redirect.

### 2026-08-29 - PRJ-1125 routing activation diagnosis

- Verified that the Sites production environment is connected to the expected hosted Supabase project.
- Confirmed PRJ-1125 is PENDING and has no configured client survey URL; activating it in that state would not have a valid destination.
- Confirmed the supplier token from the reported link is stale/not present in the hosted supplier directory and the exact public route now returns HTTP 404 without following a redirect or creating a survey session.
- Did not bypass lifecycle or routing safeguards and did not write incomplete production configuration.
- Current task is obtaining the intended client survey URL and selecting the hosted supplier assignment; next task is activating the assignment/project and verifying a 302 with a real respondent ID. `BLK-07` records this external configuration dependency.

### 2026-08-29 - Transcript workflow deployed to production

- Applied migration `020` to hosted Supabase after explicit approval, normalizing existing DRAFT projects to PENDING and enabling the expanded operational/commercial lifecycle.
- Published Sites version 2 with the new `ROP-` project IDs, multi-status filtering, separate search modes, historical manager names, expanded types, and complete ISO country/language selectors.
- Verified the production login route returns HTTP 200 with ResearchOps content and the unauthenticated projects API remains protected with HTTP 401.
- `PRJ-07` is DONE, `BLK-06` is resolved, and `MKT-02` remains READY only for browser interaction evidence.
- Current task returns to the supported-browser verification gate, followed by the recorded vendor and commercial decisions.

### 2026-08-29 - Transcript-aligned workflow implemented locally

- Treated the supplied transcript as requirements evidence and ignored unrelated conversational material.
- Added separate internal-ID and general project search, multi-status filtering, all saved client choices, a controlled industry project-type catalog, and newest-first results without the unnecessary sort control.
- Replaced the draft-first lifecycle with PENDING, LIVE, PAUSED, ID_SUBMITTED, INVOICED, and CLOSED; new projects use `ROP-` internal IDs while existing `PRJ-` routes remain compatible.
- Added snapshot project-manager names so historical ownership remains visible after an account becomes unavailable.
- Added complete ISO 3166-1 alpha-2 country and ISO 639-1 language choices to project creation and market editing, with server allowlist validation and human-readable labels.
- Preserved the verified industry routing model: the client supplies the project survey URL, ResearchOps supplies masked client outcome callbacks, and supplier records own supplier destinations.
- Production build, the 13-test standard suite, lint, local migration `020`, live project creation/query/transition paths, and direct event ingestion RPC verification pass.
- Hosted migration and deployment were not attempted after the safety gate rejected the DRAFT-to-PENDING data rewrite without explicit user approval. `PRJ-07` remains IN PROGRESS and `BLK-06` records the only new rollout blocker.

### 2026-08-29 - Public visitor access enabled

- Changed the Sites access policy from owner-only to public after explicit user approval.
- Verified the hosted root and login route return HTTP 200 and ResearchOps content, while an unauthenticated protected API request remains denied with HTTP 401.
- Updated the README and deployment checklist to state that the hosting layer is public while Supabase authentication and application authorization remain mandatory.
- Resolved `BLK-05`; `DEP-02` remains READY only because authenticated browser health/readiness and critical-flow evidence is still gated by the unavailable supported browser surface.
- Current task returns to browser verification; external integrations and financial decisions remain next.

### 2026-08-29 - Second hosted ResearchOps user provisioned

- Created and email-confirmed the second requested hosted Supabase Auth account through the administrative API.
- Kept the supplied password out of the repository, tracker, and command output.
- The Sites deployment remains owner-only; both newly provisioned accounts require a separate approved visitor-access change before they can reach the ResearchOps login page.
- No feature status changed. Current task remains the Sites visitor-access decision; browser verification and the recorded external-integration gates remain next.

### 2026-08-29 - Hosted ResearchOps user provisioned

- Created the requested hosted Supabase Auth account and confirmed its email through the administrative API.
- Kept the supplied password out of the repository, tracker, and command output.
- The Sites deployment remains owner-only, so the account cannot reach the ResearchOps login page until a separate visitor-access policy is explicitly approved.
- No feature status changed. Current task is the Sites visitor-access decision; browser verification and the recorded external-integration gates remain next.

### 2026-08-29 - Free hosted staging deployed

- Created the Supabase Free ResearchOps project in `ap-south-1`, applied migrations `001` through `019`, and migrated local Auth plus public application data using temporary ignored exports.
- Verified exact local/hosted counts for 14 application tables and all 77 authentication users.
- Configured public connection values and server-only service, ingestion, callback, and fraud secrets in the Sites environment store; `DEV_AUTO_LOGIN` is disabled in hosted staging.
- Published version 1 to the owner-only permanent Sites URL and confirmed unauthenticated requests receive HTTP 401.
- Configured Supabase Auth site and password-recovery redirects for the permanent hosted URL, then restored local-development values in `supabase/config.toml`.
- `DEP-02` is READY; final owner-authenticated health/readiness, keyboard, responsive, and critical-flow evidence remains gated by the unavailable supported browser-control surface.
- Current task returns to the browser-verification gate, followed by the external provider, email/error-tracking, financial, and production-approval decisions in Current focus.

### 2026-08-29 - Permanent free hosting preparation

- Compared current official free-tier constraints and selected the repository-native Sites/Cloudflare Worker runtime with Supabase Free instead of adapting the Worker application to Vercel or accepting Render's sleep and expiring-database limitations.
- Stopped the temporary Quick Tunnel so it no longer held the production build, then completed a clean production build.
- Created a private ResearchOps Sites project, persisted its opaque project ID in hosting metadata, initialized the source repository, excluded local build/Supabase state, and pushed the validated source using a short-lived credential.
- Supabase browser control remains unavailable and the CLI is not authenticated, so no hosted database, secrets, or production deployment was created. `DEP-02` is now IN PROGRESS and blocked specifically on the user completing `npx supabase login` locally.
- Current task is hosted Supabase creation/schema-data migration and private deployment; browser QA and external integrations remain next.

### 2026-08-29 - Protected owner Quick Tunnel restarted

- Identified and stopped only the verified ResearchOps Worker and Cloudflare child processes from the previous tunnel session so the replacement server would receive a fresh protected-entry token.
- Rebuilt the production application and started a new database-configured Quick Tunnel with the existing local-only `DEV_AUTO_LOGIN` protection.
- Cloudflared environment checks passed for DNS, QUIC, HTTP/2, and Cloudflare API access, and the new tunnel connection registered successfully; this machine's lookup of the new hostname was still propagating during the short public-health retry window.
- No feature status changed. Current and next tasks remain the M8 browser-verification and external-integration gates listed under Current focus.

### 2026-08-27 - Protected owner Quick Tunnel restarted

- Started Docker Desktop and restored the local Supabase services required by the authenticated application.
- Built the current production application and launched a fresh Cloudflare Quick Tunnel with the existing local-only `DEV_AUTO_LOGIN` protection enabled.
- Verified the public health endpoint returns `healthy`; the protected OWNER link was shared only in the active conversation and was not stored in the repository or tracker.
- No feature status changed. Current and next tasks remain the M8 browser-verification and external-integration gates listed under Current focus.

### 2026-08-25 - Development tunnel stylesheet validation

- Reproduced the launcher failure: a direct PowerShell request to Vite's CSS module received the JavaScript hot-reload wrapper even though browser stylesheet requests received valid CSS.
- Updated the local and public stylesheet checks to send browser-style `Accept` and `Sec-Fetch-Dest` request headers while retaining the existing production checks.
- Documented the development-mode behavior in the README.
- PowerShell parsing and lint pass; a complete `npm run tunnel:dev` run created a public Quick Tunnel whose page and stylesheet both returned HTTP 200, with the stylesheet served as `text/css`.
- Stopped the temporary verification tunnel after the checks completed; port 3001 is free for the next run.
- Current and next tasks remain the M8 browser-verification and external-integration gates listed under Current focus.

### 2026-08-25 - Call-derived operations and routing feature set

- Added migration `019_call_feature_updates.sql` for client/supplier contacts and outcomes, opaque redirect tokens, supplier STATIC/DYNAMIC mode, project survey/security URLs, admin-only client writes, v3 project transactions, and average duration.
- Rebuilt client/supplier directories with role-aware contact editing, outcome destinations, masked links, copy controls, and removed the obsolete supplier-type UI.
- Added opaque Test/Live routing that enforces supplier/project/assignment state and quota, records START/REACHED/outcome events, applies fraud/security checks, injects masked client callbacks, and routes final outcomes back to supplier destinations.
- Updated project creation/detail for controlled types/categories, existing clients, signed-in PM, created date, multi-supplier selection, survey/security URLs, and duration metrics.
- Made Project Center PM-scoped and Overview organization-wide with monthly completes; expanded supplier delivery controls/metrics and links.
- Added respondent project filtering, CPI/duration columns, formula-safe CSV export, and analytics source CSV/export diagnostics.
- Fixed nullable directory fields exposed by live integration and corrected the tunnel launcher's Windows PowerShell service-key refresh so service-role event ingestion survives local key rotation.
- Applied migration `019`; lint, production build, 13 standard tests, direct Supabase isolation, live Worker/Supabase workflow, and end-to-end masked routing pass.
- Final Quick Tunnel is running from the verified production build; its hostname remains temporary and local DNS propagation can lag even while Cloudflare has registered it.

### 2026-08-25 - Protected temporary owner auto-login

- Added an explicit `DEV_AUTO_LOGIN` testing switch that preserves the completed normal authentication implementation for later enforcement.
- Rejected an unrestricted public OWNER bypass and replaced it with a new 256-bit protected entry link on every tunnel launch; ordinary tunnel visitors still receive the login page.
- The protected entry sets an HTTP-only, secure, same-site testing cookie before the client requests a short-lived Supabase session for the first local workspace OWNER.
- Kept the service credential outside browser bundles and responses, added disabled/denied/success contract tests, and made the launcher refresh rotating local Supabase service bindings without writing them to disk.
- Production build, 13 standard tests, lint, PowerShell parsing, and a live session-to-protected-workspace check pass. The live tunnel was restarted and verified; its private testing token is intentionally not recorded here.

### 2026-08-22 - Fraud Review permission fidelity and final mutation audit

- Added protected operator-capability metadata to Fraud Review reads and consumed it in the UI.
- Confirm/Dismiss actions are now limited to OWNER, ADMIN, and PM roles; analyst/member views are explicitly read-only and open flags show an awaiting-operator state.
- Added mock owner capability coverage, analyst readable/403-resolution coverage, and live Supabase owner capability verification.
- Production build, 10 standard tests, live Worker/Supabase integration, and lint pass; a final protected-write/UI audit found no additional safely unblocked permission gap.
- Restarted the database-backed local Worker and Quick Tunnel at `https://month-dvds-erik-wallet.trycloudflare.com`; remaining roadmap work is limited to the documented browser, vendor, commercial, and hosted-environment gates.

### 2026-08-18 - M1 vertical slice

- Initialized the Cloudflare-compatible React/Vite project.
- Built dashboard, navigation, Project Center, create form, project detail, supplier comparison, clients, suppliers, respondents, analytics, settings, and mock login.
- Added mock project data and Worker project/health APIs.
- Added Supabase client configuration, core migration, seed, RLS policy definitions, event ledger, and audit schema.
- Added smoke tests, README, responsive styling, and build verification.
- Next session: configure Supabase and begin M2 in the order listed under Current focus.

### 2026-08-18 - Tracker created

- Added this roadmap and resume protocol.
- Added explicit feature IDs, milestone exit criteria, environment requirements, blockers, decisions, and verification history.
- Future sessions must update this tracker before stopping.

### 2026-08-18 - Cloudflare Quick Tunnel readiness

- Installed `cloudflared` 2026.8.2.
- Added `npm run tunnel` for a production build plus temporary public tunnel and `npm run tunnel:dev` for live-reload use.
- Fixed the tunnel origin at `127.0.0.1:3010` for production and the development server at port `3001`.
- Added a narrow `.trycloudflare.com` Vite host allowlist instead of disabling host protection.
- Added `/api/readiness` so application, API, database configuration, and current data source are explicit.
- Verified Cloudflare DNS, QUIC, HTTP/2, API reachability, and tunnel registration.
- Supabase persistence remains blocked by `ENV-01`; the current tunnel intentionally reports and serves mock data until credentials, migration, authentication, and RLS tests are complete.

### 2026-08-18 - M2 authentication and project persistence code-ready

- Replaced the static login with Supabase email/password sign-in, session restoration, sign-out, safe return paths, and client-side product route protection.
- Preserved a clearly labeled demo mode when Supabase variables are absent.
- Routed Project Center reads through the Worker API and forwarded the signed-in user's bearer token to Supabase.
- Connected Create Project to the Worker and added migration `002_create_project_rpc.sql` for an atomic project, first-market, and supplier-assignment transaction under RLS.
- Added the organization membership gate, first-workspace onboarding UI/API, and migration `003_organization_onboarding.sql` to create the OWNER membership and default suppliers atomically.
- Passed Supabase connection values into local Worker development and production tunnel processes without exposing the service-role key.
- Updated API smoke coverage and cleared the repository lint errors.
- Next session: configure Supabase, apply all three migrations, test onboarding and two-tenant isolation, then finish Project API query controls.

### 2026-08-18 - M2 local and tunnel runtime

- Built and started the current M2 implementation at `127.0.0.1:3010`.
- Started a fresh Cloudflare Quick Tunnel and verified the public Project Center, health endpoint, and readiness endpoint.
- The server and tunnel were left running for cross-device testing; Supabase remains unconfigured, so the public site is intentionally serving labeled demo data.

### 2026-08-18 - PRJ-04 project query controls

- Moved Project Center search, client/manager/status/type/date filters, sorting, and pagination behind the Worker API contract.
- Added bounded query parsing, exact result counts, page metadata, facets, and summary counts for both mock and tenant-scoped Supabase modes.
- Added accessible page-size, previous/next, page-number, sorting, and clear-filter controls to the Project Center.
- Added smoke coverage for combined status filtering, deterministic sorting, pagination, and text search.
- `PRJ-04` is code-ready; live two-tenant verification remains blocked by `ENV-01` and `DB-02`.
- Restarted the local production server and Quick Tunnel with the updated build; Cloudflare public DNS and HTTP routing were verified.
- Next unblocked implementation: `AUTH-02` password recovery.

### 2026-08-18 - AUTH-02, ORG-02, CLI-02, and SUP-02 code-ready

- Added generic password-reset requests, dedicated recovery-session password updates, confirmation validation, expired-link handling, and non-enumerating responses.
- Added a reusable Worker membership/role guard and applied read vs operate permissions to project endpoints.
- Added migration `004_role_authorization.sql` so direct PostgREST access cannot bypass Worker role rules.
- Replaced static client and supplier pages with searchable create/edit/activate/deactivate CRUD surfaces backed by tenant APIs.
- Create Project now loads active clients and suppliers from the directory APIs instead of hard-coded options.
- Build, lint, five test groups, mock CRUD behavior, and role rejection checks pass.
- Next autonomous batch: `PRJ-06` project editing, then `PRJ-07` state transitions and audit entries.

### 2026-08-18 - PRJ-06 and PRJ-07 project lifecycle code-ready

- Replaced the static project detail page with API-backed detail loading and an editable core-information form.
- Added operator-protected project update and transition endpoints with consistent mock behavior.
- Added migration `005_project_lifecycle.sql` for transactional project updates, controlled lifecycle transitions, and actor-scoped audit entries.
- Enforced DRAFT → PENDING, PENDING → DRAFT/LIVE, LIVE → PAUSED/CLOSED, and PAUSED → LIVE/CLOSED transitions; CLOSED remains terminal.
- Added API coverage for valid edits, valid/invalid transitions, and ANALYST role denial.
- Production build and all five test groups pass; lint passes after removing the hook dependency warning.
- Next autonomous batch: `MKT-01` and `QTA-01` multi-market/quota editing, followed by `SUP-04` supplier assignment.

### 2026-08-18 - MKT-01 and QTA-01 code-ready

- Added an API-backed project markets editor with add/remove, country/language, target quota, LOI, and incidence controls.
- Added migration `006_project_markets.sql` for validated atomic market replacement, duplicate prevention, overall project quota roll-up, and audit logging.
- Added mock and authorization tests for market reads/writes plus duplicate rejection.
- Production build, five test groups, and lint pass.
- Next autonomous feature: `SUP-04` persistent supplier assignments.

### 2026-08-18 - SUP-04 code-ready

- Replaced the mock supplier comparison on project detail with directory-backed assignment management.
- Added assignment read/replace APIs for supplier project ID, supplier CPI, target quota, and lifecycle status.
- Added migration `007_project_suppliers.sql` for tenant-validated atomic assignment replacement and audit logging.
- Added mock API and ANALYST role-denial coverage; production build, five test groups, and lint pass.
- Next autonomous feature: complete remaining `AUD-01` coverage, then begin trusted event ingestion.

### 2026-08-18 - AUD-01, EVT-02, EVT-03, and callback security code-ready

- Added migration `008_directory_audit.sql` for project creation and client/supplier change audit triggers.
- Added timestamped HMAC-SHA256 callback verification over the raw request body with a five-minute replay window and constant-time comparison.
- Added migration `009_event_ingestion.sql` with a service-role-only atomic ingestion RPC, session upsert, event validation, supplier-project validation, and replay-safe idempotency index.
- Kept service-role and callback secrets server-only and extended local/tunnel environment loading without printing secret values.
- Added signed/unsigned callback tests; production build, five test groups, and lint pass.
- Next autonomous features: `MET-01`, `MET-02`, and `MET-03` event-derived metrics.

### 2026-08-18 - MET-01, MET-02, and MET-03 code-ready

- Added migration `010_event_metrics.sql` with tenant-safe project and supplier aggregation views.
- Derived starts, reached-client, last-24-hour completes, terminal outcomes, abandon/incidence/conversion rates, last complete, and supplier cost from the append-only event ledger.
- Connected Supabase Project Center/detail responses and supplier delivery tables to the derived metrics.
- Production build, five test groups, and lint pass.
- Next autonomous feature: `RSP-01` respondent/session explorer.

### 2026-08-18 - RSP-01 code-ready

- Replaced the Respondents placeholder with an authenticated, debounced session search surface.
- Added a tenant-scoped session API that returns project, supplier, disposition, timestamps, and nested immutable events.
- Added a chronological event timeline and clear empty/error states, with representative demo data when Supabase is absent.
- Production build, five test groups, and lint pass.
- Next autonomous feature: provider adapter contracts and callback mapping.

### 2026-08-18 - Provider foundation and callback controls

- Added a shared provider adapter contract and isolated CPX, BitLabs, and PureSpectrum test-mode adapters for launch URL and callback normalization.
- Added dedicated signed callback routes with provider-scoped server secrets and idempotent event processing.
- Added per-origin callback/event throttling, Retry-After responses, generated request IDs, latency/outcome logs, and secret/respondent-safe structured logging.
- Added contract-style callback coverage for all three test adapters; production build, five test groups, and lint pass.
- Live vendor compatibility remains blocked on official sandbox contracts and credentials; next unblocked features are fraud rules and review.

### 2026-08-18 - FRD-01, FRD-02, and FRD-04 code-ready

- Added migration `011_fraud_controls.sql` with project policies, explainable fraud flags, tenant RLS, indexes, event risk evaluation, and audited resolution.
- Added server-only HMAC fingerprints for IP/device duplicate checks without persisting raw identifiers.
- Added duplicate IP/device, speeding, and trusted quality-violation rules linked to immutable events.
- Added a Fraud Review workspace with tenant-scoped loading and operator-only confirm/dismiss actions.
- Production build, fraud route/API smoke coverage, five test groups, and lint pass.
- Research Defender remains blocked on a product decision and credentials; next autonomous feature is persistent analytics.

### 2026-08-18 - ANA-01 and ANA-02 code-ready

- Added migration `012_analytics.sql` with a tenant-scoped, date-bounded analytics snapshot for portfolio, client, market, and supplier rollups.
- Replaced static analytics with API-backed date controls, operational metrics, client/market comparisons, and supplier IR/cost delivery.
- Added valid/invalid date-range API coverage; production build, five test groups, and lint pass.
- Next autonomous feature: notification configuration and operational alert rules independent of an external email vendor.

### 2026-08-18 - NOT-02 notification foundation code-ready

- Added migration `013_notifications.sql` with tenant-scoped alert rules, user/global inbox records, read state, RLS, indexes, and audited administrator configuration.
- Added automatic project lifecycle and fraud/quality notifications without coupling core behavior to an email vendor.
- Added a Notifications workspace for unread messages and configurable in-app/email channel preferences.
- Added notification page/API coverage; production build, five test groups, and lint pass.
- External email delivery is blocked on provider selection; financial features remain blocked on commercial/currency rules. Next autonomous work is stronger unit coverage and broader observability.

### 2026-08-19 - Business-rule tests and API observability

- Extracted the project lifecycle state machine into a directly tested domain module.
- Added direct fixed-window throttling tests and expanded the default test command to run business-rule plus rendered/API suites.
- Added sanitized structured request logs and response request IDs consistently across Worker APIs.
- Production build, seven tests, and lint pass.
- Next autonomous work: backup/recovery and deployment configuration documentation, followed by a full remaining-scope audit.

### 2026-08-19 - Current build hosted for cross-device testing

- Built the latest implementation and started the production origin at `127.0.0.1:3010`.
- Replaced an unresolvable temporary hostname with a fresh Cloudflare Quick Tunnel and verified public health and Project Center responses.
- The tunnel is intentionally serving labeled mock data because Supabase credentials and migrations remain unavailable.
- Quick Tunnel availability is temporary and depends on this computer, origin process, and tunnel process remaining online.

### 2026-08-19 - Local Supabase and public authenticated tunnel

- Started a minimal Docker-backed Supabase stack and applied migrations `001` through `015` plus the development seed.
- Added explicit API grants and corrected the project-creation RPC conflict target after live integration testing exposed both issues.
- Added a same-origin Supabase Auth gateway so phones and other remote devices use the laptop's local database through the tunnel instead of their own loopback address.
- Corrected the production tunnel launcher to serve the Worker build through Wrangler with runtime bindings, which preserves database access after future rebuilds/restarts.
- Live-tested two-tenant RLS, analyst restrictions, persistent project creation, event idempotency, and metrics.
- Restarted the latest build under the Wrangler Worker runtime at `127.0.0.1:3010`; the existing Quick Tunnel now reports `configured` / `supabase-ready`.
- Public signup, organization creation, and authenticated organization read passed through `https://depot-tokyo-cable-satisfactory.trycloudflare.com`.

### 2026-08-19 - Live roadmap verification and remaining external gates

- Added live Worker/Supabase integration suites for the complete operator CRUD/lifecycle/audit path, all seven event types, idempotent replay, project/supplier metrics, respondent timelines, analytics, native fraud controls, three signed provider callback paths, notifications, and administrator rule persistence.
- Corrected respondent event normalization and deterministic timeline ordering.
- Prevented local Worker upstream exhaustion by consuming token-check and same-origin Supabase gateway responses before returning.
- Added per-origin password-login, signup, and recovery throttling with Retry-After coverage; native security milestone checks now pass.
- Ran a scoped logical backup/restore drill in an isolated temporary database, validated core record counts and migration `015`, and removed the database and dump.
- Restored Docker/Supabase after the runtime interruption, rebuilt the final source, reran standard/live checks, and started a fresh database-backed Quick Tunnel at `https://opportunities-smooth-strictly-observed.trycloudflare.com`.
- Browser E2E/accessibility remains blocked because browser discovery returned no connected supported browser. Vendor adapters, email delivery, Research Defender, financials, external error tracking, named tunnel/staging, and production deployment remain blocked on the recorded external credentials or decisions.

### 2026-08-19 - Fresh Quick Tunnel for testing

- Confirmed the existing local Worker at `127.0.0.1:3010` is healthy and reports Supabase `configured` / `supabase-ready`.
- Started a fresh Cloudflare Quick Tunnel against the existing origin after the full tunnel script was blocked by the running Worker holding `dist`.
- Verified public health and readiness through `https://reached-oak-reflection-sponsorship.trycloudflare.com`.
- Next task remains browser-driven authenticated, keyboard, and responsive verification for `TST-04`/`TST-05`.

### 2026-08-19 - Formal remaining-scope blocker audit

- Re-read the complete tracker and README and confirmed the local Worker still reports `ready`, `configured`, and `supabase-ready`.
- Reattempted the supported browser connection; no usable browser-control surface was available, so authenticated E2E and visual/accessibility evidence cannot proceed in this environment.
- Audited every non-DONE feature: all UI READY items depend on that browser gate, while all BLOCKED items require recorded vendor contracts/credentials, email or error-tracking provider selection, financial rules, or Cloudflare/hosted-Supabase deployment access.
- No safely unblocked implementation or verification item remains. Resume from Current focus when any recorded external input becomes available.

### 2026-08-21 - Tunnel UI and login recovery

- Reproduced the reported cross-device failure state and found that the previously shared Quick Tunnel had expired while Docker, the Worker, and local Supabase were no longer running.
- Restarted the local Supabase stack and production Worker, then verified the public login and Project Center HTML, every referenced CSS/JavaScript asset, the same-origin Auth health route, and a complete temporary signup/login cycle.
- Updated the tunnel launcher so `Tunnel verified` now requires rendered login HTML, a publicly loadable CSS asset, API health, and the authentication gateway when Supabase is configured.
- Passed PowerShell parsing, lint, the production build, and the standard test suite; browser-controlled visual evidence remains blocked because the supported browser connection could not initialize in this environment.
- Started a fresh database-backed Quick Tunnel at `https://mind-furnishings-continued-style.trycloudflare.com`; it remains temporary and depends on this laptop, Docker, the Worker, and cloudflared staying online.

### 2026-08-21 - Local demo login provisioned

- Provisioned a confirmed local-only demo Auth user for cross-device testing without storing its password or credentials in the repository or tracker.
- Verified that the demo user receives a valid session through the current public tunnel login endpoint.
- The account belongs only to this laptop's local Supabase stack; first login continues through the normal workspace-onboarding flow.

### 2026-08-21 - Public navigation hardening

- Correlated the reported inert navigation with public Worker logs: login, onboarding, session restoration, and data APIs succeeded, but affected clicks produced no route request.
- Replaced framework-intercepted page links with an accessible shared native-anchor component so sidebar, New Project, project detail, directory, dashboard, and authentication navigation perform dependable full document requests through Quick Tunnels.
- Kept stateful controls, form submissions, filtering, pagination, and authenticated API interactions client-side.
- Lint, production build, and the standard suite pass; the deployed client bundle contains native anchors and the fresh public tunnel reports configured/supabase-ready.
- Started the corrected build at `https://crest-focal-head-reason.trycloudflare.com`; browser-controlled click evidence remains pending the recorded browser availability gate.

### 2026-08-22 - Local and tunnel run commands documented

- Updated the README with copy-paste commands for starting the complete local application and the Cloudflare Quick Tunnel with local Supabase.
- Documented the Docker requirement, first-time dependency installation, live-reload tunnel option, temporary URL behavior, shutdown behavior, and the Supabase stop command.
- No implementation or feature status changed in this documentation-only session.

### 2026-08-22 - Inert-control audit and operational export

- Audited visible buttons and found three controls without meaningful behavior: Project Center export, the top-bar notification counter, and the initial create-project Add Market affordance.
- Implemented a safe CSV export for the currently displayed Project Center page, including spreadsheet-formula neutralization and unit coverage.
- Connected the top-bar notification counter to the Notifications workspace.
- Replaced the unsupported initial Add Market action with accurate guidance; multi-market editing remains available after project creation through the completed market editor.
- Lint passes; the production build and 10 standard tests pass with 3 credential-gated integration suites skipped.
- Started and publicly verified the updated database-backed build at `https://smithsonian-producer-download-prices.trycloudflare.com`.
- `PRJ-01` remains READY until supported browser download/click evidence is available; next safely unblocked work remains browser verification of the READY UI set.

### 2026-08-22 - Persistent workspace settings and live unread badge

- Added migration `016_organization_settings.sql` with a constrained organization timezone and an owner/admin-only audited settings RPC.
- Replaced the inert Settings form with protected API loading, role-aware organization name/timezone editing, save feedback, and accurate enforced-security descriptions.
- Replaced the hard-coded top-bar notification count with the unread total from the protected Notifications API.
- Added mock API validation, analyst-denial coverage, and live integration coverage for settings persistence and its audit action.
- Applied migration `016` locally and live-verified update, audit visibility, and restoration against the existing demo workspace.
- Production build, 10 standard tests, and lint pass; `ORG-03` is DONE. Browser visual evidence for the remaining READY UI items remains the next unblocked gate.

### 2026-08-22 - Disposable password recovery verification

- Added an environment-gated local Supabase integration test for the complete password recovery contract.
- The test creates a disposable confirmed user, generates a real recovery link, verifies its hashed token into a recovery session, updates the password, signs in with the replacement password, rejects token replay, and removes the user in cleanup.
- The live recovery lifecycle passes without retaining credentials or test accounts; production outbound email delivery remains correctly blocked on provider selection.
- Production build and 10 standard tests pass with 4 environment-gated integration suites skipped; lint passes.
- `AUTH-02` remains READY only for production email-delivery and browser UI evidence; its local backend recovery contract is now live-verified.

### 2026-08-22 - Project manager and redirect persistence

- Audited the creation form and found that its hard-coded manager choices were ignored while complete, terminate, and quota-full URLs were collected but discarded.
- Replaced the fictitious manager selection with the actual rule: the authenticated operator is assigned by the database transaction.
- Added migration `017_project_redirects.sql`, URL constraints, create/update RPCs, protected API mapping, and project-detail editing for all three redirect destinations.
- Applied migration `017` and passed an authenticated create/update/read persistence cycle against local Supabase.
- Production build, 10 standard tests, and lint pass; the rebuilt Quick Tunnel reports ready with the database configured.
- Remaining work is unchanged: supported browser evidence for READY UI items and the external decisions, credentials, and hosted environments listed in Current focus and Blockers.
- Retried the supported browser-control workflow against the fresh public URL; initialization failed at its trusted runtime dependency, so `TST-04`/`TST-05` remain genuine environment blockers and no unsupported browser fallback was used.

### 2026-08-22 - Project setup validation audit

- Made mandatory duplicate-prevention and callback-signature protections visibly enforced instead of presenting ignored editable checkboxes.
- Tightened project-creation validation for integer quotas, positive LOI, bounded incidence, valid ISO calendar dates, country/language codes, and safe HTTP(S) redirect URLs.
- Added API regression coverage proving five malformed creation payload classes return HTTP 400 before database access.
- Production build, 10 standard tests, and lint pass; the updated local and tunnel runtime was restarted.
- No additional safely unblocked implementation gap was found in this audit; remaining READY evidence and BLOCKED integrations still depend on the recorded browser runtime, vendor, commercial, or hosted-environment inputs.

### 2026-08-22 - Notification administration completion audit

- Found that pacing thresholds were supported and integration-tested by the API but could not be viewed or edited in the Notifications UI.
- Added a bounded pacing-percentage control, API-provided administrator capability metadata, read-only analyst behavior, save progress, and persisted response reconciliation.
- Hardened replacement validation to require exactly one valid rule for every supported event, boolean channel settings, a 1-100 pacing threshold, and no unsupported thresholds.
- Live Supabase notification/rule persistence passes; mock/API coverage proves incomplete and invalid thresholds return 400 and analyst updates return 403.
- Production build, 10 standard tests, focused role/API tests, and lint pass; the current runtime was rebuilt and restarted.

### 2026-08-22 - Project manager profile fidelity

- Found that Project Center manager filters displayed shortened database UUIDs and project rows/details replaced the real assignee with the generic label `Workspace team`.
- Added migration `018_user_profiles.sql` with Auth profile synchronization, existing-user backfill, shared-workspace read isolation, and manager referential integrity.
- Changed project list/detail APIs to return human-readable manager names and value/label facets, keeping internal identifiers out of visible labels while preserving exact filtering.
- Applied migration `018`; live verification proves profile creation, detail and facet labels, and manager-filtered project reads for a disposable authenticated operator.
- Production build, 10 standard tests, live Worker/Supabase workflow, and lint pass; `ORG-04` is DONE and `PRJ-01` remains READY only for the recorded browser evidence gate.

### 2026-08-22 - Role-aware directory controls

- Found that analyst/member users could read client and supplier directories but were still shown create, edit, activate, and deactivate controls that the protected API correctly rejected.
- Added `canOperate` capability metadata to client/supplier reads and made both directory UIs explicitly read-only when the workspace role lacks operator permission.
- Owner capability passes in the live Supabase workflow; analyst mock authorization proves readable data with `canOperate: false`, while direct writes remain forbidden.
- Production build, 10 standard tests, focused authorization coverage, live Worker/Supabase workflow, and lint pass; `CLI-01`/`SUP-01` remain READY only for browser evidence.

### 2026-08-22 - Project Center and creation role awareness

- Extended protected project list/detail metadata with the authenticated workspace operator capability.
- Project Center now replaces New Project with an explicit read-only state for analysts/members, and the creation form disables submission with a clear permission explanation derived from directory capabilities.
- Mock/API authorization proves `canOperate: false` for analysts while direct project mutations remain 403; the owner capability passes in the live Supabase workflow.
- Production build, 10 standard tests, live Worker/Supabase workflow, and lint pass.
- Next safely unblocked task is applying the same capability to project detail lifecycle, core edit, market, and supplier-assignment controls.

### 2026-08-22 - Project detail role awareness

- Applied protected project-detail capability metadata to lifecycle transitions, core project editing, market/quota editing, and supplier-assignment management.
- Non-operator roles now receive an explicit read-only project workspace with every mutation affordance omitted; operators retain the existing validated workflows.
- Reworked the three detail components without changing their API behavior and removed a misleading hard-coded quality-rate note while preserving event-derived metrics.
- Owner detail capability passes live; analyst list capability and direct lifecycle/core/market/supplier 403 boundaries pass automated authorization coverage.
- Production build, 10 standard tests, live Worker/Supabase workflow, and lint pass.
- Next safely unblocked task is removing the Dashboard New Project shortcut for read-only roles using the existing project-list capability.

### 2026-08-22 - Dashboard project permission fidelity

- Connected Dashboard to the protected project-list operator capability already used by Project Center and project creation.
- New Project is now available only to OWNER, ADMIN, and PM roles; analyst/member users receive the same explicit read-only state used across project surfaces.
- Production build, 10 standard tests, project capability authorization coverage, and lint pass; the runtime was rebuilt and restarted.
- A new remaining-scope audit found the next safely unblocked gap: Fraud Review still shows Confirm/Dismiss actions to read-only roles even though its API correctly returns 403.
