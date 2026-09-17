# ResearchOps Development Tracker

> This file is the single source of truth for project progress. Read it before making changes and update it before ending every development session.

Last updated: 2026-09-16
Current milestone: Fieldwork intelligence and operational workbook
Overall state: GitHub `main` contains the screenshot-aligned Project Center, two-ID client/supplier handoff, commit `fa1fee3` (centralized routing links, `?diagnose=1` help, `node scripts/check-route.mjs`, routing columns in the Project Center CSV), and the QA routing scripts. Vercel CLI access was recovered: the `researchops-fieldwork` project is reachable, production serves `https://www.asrv.co.in` with health and readiness OK. A full hosted end-to-end routing proof ran against production using a fresh anonymous signup, its own client/supplier/project (`ROP-1141`): supplier live hit returned 302 to the survey with a new session UUID as `RID` plus per-session outcome URLs, the client complete return resolved the UUID and sent the supplier's original reference back in its own redirect parameters, the respondent row reached `COMPLETE` with duration captured, and a replayed outcome callback stayed idempotent. Hosted routing is therefore independently proven. Migration `038` ownership proofs and the `039` capability RPC probe remain pending. Local `docker` is not resolvable on PATH, so local database verification is unavailable.

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

## Directory UI checkpoint — 2026-09-16

- Change: moved the Clients/Suppliers Clear filters action below the filter grid, matching the Project Center action-row structure. No routing or other page behavior changed.
- Verification: TypeScript `--noEmit` and DirectoryPage ESLint passed (exit 0). Targeted Playwright run: client handoff passed; supplier directory failed because the existing test expects two links but the current UI renders three. Full directory browser verification is not marked passed.
- Current task: commit and push this bounded layout checkpoint.
- Next task/blocker: reconcile the supplier browser expectation with the already-existing short-link contract, then verify directory filtering/reset. Broader UI alignment remains unfinished.
- Session log: completed the pending single-component layout change; deliberately deferred unrelated changes and recorded the failing browser check rather than claiming full success.


## Current focus

### Now - restore hosted Project Center and verify the release

1. Confirm the remaining `039` live checks. Hosted activation is now independently confirmed: the `supplier_scoped_ref_ready` capability RPC returned `200 true`, and the live equal-reference test passed (`ROP-1143` run — two suppliers posted the same external ref `SAME-REF-777` on the same project and each received a distinct ResearchOps session UUID with correct supplier-scoped return routing). Concurrent-quota, terminal-outcome distribution, and assignment-history checks remain.
2. Prove the remaining release checks now that hosted two-ID routing is verified end-to-end (`ROP-1141` production run) and authenticated hosted `/api/projects` returned `200` with project data; public frontend pages (`/login`, `/projects`, `/dashboard`, `/clients`, `/suppliers`) and CSS all return `200`. Remaining: `038` ownership constraints, audit records, role permissions, and tenant isolation proofs.
3. Prove fieldwork response capture, retention, review, and tenant isolation; browser-verify the workbook and hosted multi-role flows, then continue provider certification.

### Next - external decision and credential gates

- Obtain official CPX, BitLabs, and PureSpectrum sandbox contracts and credentials.
- Select an email delivery provider and error-tracking sink.
- Approve financial, currency/FX, tax, reconciliation, and permission rules.
- Supply Cloudflare and hosted Supabase staging credentials for deployment verification.

### Browser verification gate

- Playwright Chromium is installed; local desktop/mobile shell and the supplier Test/Live link dialog plus hosted health/readiness checks pass. Hosted authentication credentials are still required for the protected routing and respondent-outcome vertical slice.

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
| `ORG-05` | Project-scoped collaborator access | READY | Migration `027` adds EDITOR/REVIEWER/VIEWER grants beneath workspace roles, scoped RLS/capabilities, audited replacement, a project-team editor, and fraud-review enforcement; hosted migration and multi-user RLS proof remain. |
| `AUD-01` | Privileged action audit trail | DONE | Live integration verifies project creation/update/transitions, directory changes, market/quota changes, supplier assignments, fraud resolution, and rule administration audit records. |

### M3 - Projects, clients, suppliers, and markets

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `PRJ-01` | Project Center table UI | READY | Browser-reviewed dense reference-style view now has the top navigation, compact two-row filters, display ID with market suffix, CC/PO, ST/RC/L24, CO/target, TE/OQ/QT, AB/IR/CO percentages, CPI, status, PM/SPM, LU date, last complete, CSV/XLSX/search/Analytics-cost/refresh controls, and responsive horizontal scrolling. Hosted authenticated proof remains. |
| `PRJ-11` | Portfolio visibility by profile | READY | Migration `036` is present in linked Supabase and grants OWNER/ADMIN/PM read visibility across the organization portfolio while ANALYST/MEMBER remain limited to explicit project grants. The UI hides manager, commercial, client-code/PO, and recency administration columns from scoped profiles. Multi-role browser proof remains. |
| `PRJ-12` | Secondary PM and sales ownership | READY | Migration `038` adds existing-workspace-member foreign keys, same-workspace/role constraints, audited assignment RPC, secondary PM operating/review access, and no new sales permission. The user applied `038` and hosted PostgREST confirms its ownership columns and joins; authenticated list/assignment and multi-role RLS/audit proof remain. |
| `PRJ-13` | Screenshot-style Project Center navigation | READY | Home/Project Center/Supplier Center/Client/Flamingo Tool/Setting/Exit appear across the Project Center desktop header; the existing shell remains available elsewhere and mobile navigation remains usable. Hosted browser proof remains. |
| `FLM-01` | Flamingo Tool entry point | PROTOTYPE | A clearly labeled integration placeholder exists. URL, API contract, authentication, and user actions are undecided; no external tool is connected. |
| `PRJ-02` | Project summary metrics | READY | Status counts, event outcomes, monthly Overview completes, and average respondent duration are connected in Supabase mode with demo fallback. |
| `PRJ-03` | Demo project API | DONE | The explicit no-credentials fallback covers list/detail/create/update, transitions, markets, and assignments for local demonstrations. |
| `PRJ-04` | Persistent project read API | DONE | Live Worker integration proves authenticated tenant-scoped detail and filtered/paginated list reads from Supabase. |
| `PRJ-05` | Persistent project creation | DONE | Live Worker integration proves existing-client-only atomic creation with controlled type/category, current created date, signed-in PM, first market, multiple saved suppliers, survey URL, and security URL; malformed quota, LOI, incidence, and URL inputs are rejected. |
| `PRJ-06` | Project update API | DONE | Live Worker integration proves validated atomic persistence and the corresponding audit record. |
| `PRJ-07` | Project state transitions | DONE | Hosted migration and automated rules implement PENDING, LIVE, PAUSED, ID_SUBMITTED, INVOICED, and CLOSED with audited controlled transitions; existing DRAFT records were normalized to PENDING. |
| `PRJ-08` | Project detail UI | READY | API-backed detail loading/editing, created date, survey/security URLs, average duration, lifecycle actions, markets, and expanded supplier comparison render in mock/Supabase modes; non-operators remain read-only. |
| `PRJ-09` | Project manager and survey configuration | DONE | Creation assigns the authenticated operator; audited create/read/update flows persist validated project survey and security-termination URLs while directory records own outcome routing. |
| `PRJ-10` | Test/live survey routing and URL parameters | READY | Migration `028` is recorded in linked production history and stores separate test/live survey destinations plus up to 30 open-ended parameter templates; creation, editing, routing, and full-specification CSV export are connected. Hosted end-to-end parameter proof remains. |
| `MKT-01` | Multi-market editor | DONE | Live Worker integration replaces two unique country-language rows atomically and verifies the audit record. |
| `MKT-02` | ISO market option catalog | READY | Hosted creation and market editing expose the complete ISO 3166-1 alpha-2 country and ISO 639-1 language catalogs with API allowlist validation; browser interaction evidence remains pending. |
| `QTA-01` | Quota management | DONE | Live Worker integration proves positive market quotas and the 150-response project quota roll-up. |
| `QTA-02` | Atomic interlocked quota cells | READY | Operators configure prioritized multi-condition cells and see filled/reserved/remaining capacity. Migration `026` is recorded in linked production history and atomically reserves project, supplier, and matching cell capacity for live respondents; hosted concurrency and lifecycle proof remain. |
| `ELG-01` | Project eligibility rules | READY | Operators can manage up to 30 URL-variable rules using categorical and numeric operators; migration `025` is recorded in linked production history. Hosted eligible/ineligible routing and metric proof remain. |
| `CLI-01` | Client directory UI | READY | Searchable numbered list remains above create/edit; View opens a compact modal with four same-origin outcome links carrying respondent/project placeholders and individual/copy-all actions; browser evidence passes. |
| `CLI-02` | Client CRUD | READY | Client destination URLs are excluded while validated redirect-variable definitions persist through migration `021`; local API coverage passes and hosted migration/live verification remain. |
| `SUP-01` | Supplier directory UI | READY | Create/edit UI includes contacts, STATIC/DYNAMIC metadata, and four supplier-return destinations. The View links modal now identifies the two supplier-level base routes and copies exactly those two; project-specific respondent Test/Live launches remain in Project details. Hosted uptake remains. |
| `SUP-02` | Supplier CRUD | DONE | Live Worker integration proves tenant-scoped contact/redirect create/update, persistent reads, opaque token generation, constraints, and audit records. |
| `SUP-03` | Project supplier assignment UI | READY | Operators manage supplier ID, CPI, quota, and traffic state while viewing separate TST plus production ST/RC/CO/TE/OQ/QT, IR, cost, and redirect mode. A bordered dialog presents Test and Live links in separate cards with dedicated copy/open actions; PAUSED/CLOSED stops live routing. |
| `SUP-04` | Persistent supplier assignment | DONE | Live Worker integration proves atomic assignment replacement for supplier project ID, CPI, quota, status, tenant authorization, and audit history. |
| `SUP-05` | Distinct supplier and ResearchOps attempt IDs | READY | Routing code keeps the supplier's launch reference for events and supplier outcomes and sends the stable survey-session UUID as the client-facing respondent ID. Client returns resolve the UUID to the stored supplier reference; pre-change returns can still resolve the reference. Respondents UI/CSV shows both IDs, and a duplicate reference from another assignment is rejected. Local routing tests pass; hosted rollout and provider-specific parameter certification remain. |
| `SUP-06` | Supplier-scoped references and assignment history | READY | Migration `039` changes session/reservation keys to `(project,assignment,external reference)`, updates event ingestion and quota terminal behavior, preserves supplier assignment IDs across edits, and adds a database delete guard for historical assignments. Routing checks database capability so pre-`039` collisions remain blocked, and legacy client returns reject ambiguous references. Four local routing tests pass; SQL lint/live integration and hosted rollout remain. |

### M4 - Sessions, events, and operational metrics

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `EVT-01` | Survey session schema | DONE | Live Worker integration persists five respondent sessions and all seven planned immutable event types. |
| `EVT-02` | Append-only event ingestion service | DONE | Live timestamped HMAC requests invoke the service-role-only RPC for every planned event type. |
| `EVT-03` | Duplicate transaction handling | DONE | Live replay returns the original event with `created: false`; metrics remain single-counted. |
| `MET-01` | Metrics aggregation service | DONE | Live views aggregate starts, reached-client, in-progress, complete, terminate, over-quota, quality terminate, abandon/conversion/drop-off rates, last activity, supplier cost, and average respondent duration. |
| `MET-02` | Live Project Center metrics | DONE | Live tenant-scoped list/detail responses return the persisted five starts and one complete. |
| `MET-03` | Supplier comparison metrics | DONE | Live assignment delivery returns five starts, one complete, and the expected 8.75 supplier cost. |
| `RSP-01` | Respondent/session explorer | DONE | Project filter/search returns normalized chronological timelines with supplier CPI and duration; a formula-safe per-project/all-project CSV export supports up to 1,000 rows. |
| `RSP-02` | Fieldwork session intelligence | READY | Migration `035` is present in the linked database and routing/API code adds market snapshots, coarse device class, normalized termination reasons, and explainable risk summaries without exporting raw IP or fingerprint hashes; live traffic and browser proof remain. |
| `RSP-03` | Controlled response variables | READY | The linked schema contains the audited 30-field allowlist and retained response-value tables; routing captures only allowlisted values and the service-role cleanup function enforces expiry. Multi-role/RLS and browser proof remain. |
| `RSP-04` | Respondent approval and vendor reconciliation | READY | Separate audited internal and vendor decision states, review RPC authorization, Respondents controls, and workbook fields are code-ready; persistent multi-role proof remains. |
| `EXP-01` | Multi-sheet fieldwork workbook | READY | Project Center retains CSV and generates a formula-safe XLSX with Project Summary, Survey Logs, Screen Conditions, Quota Table, Vendor Survey Links, and Response Variables. Filtered browser download and Excel visual proof remain. |
| `ANA-01` | Analytics UI | READY | Date controls, source comparisons, supplier conversion/IR/cost indicators, and formula-safe portfolio/supplier/client/market CSV export are implemented with demo fallback. |
| `ANA-02` | Persistent analytics API | DONE | Date-bounded tenant analytics returns the respondent funnel, terminal outcomes, in-progress/abandonment totals, last activity, and supplier cost from persisted data. |

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
| `RDR-01` | Opaque live respondent routing | DONE | Opaque supplier links enforce active state/quota, record events, apply fraud/security checks, issue unique per-session outcome callbacks, preserve the first terminal outcome, and return it to the supplier destination. Proven live on production `www.asrv.co.in` (`ROP-1141` run): 302 with `RID` session UUID and per-session outcome URLs, client-back redirect carried the supplier's original reference, session reached `COMPLETE` with duration, and the replayed outcome stayed idempotent. |

### M6 - Security and fraud controls

| ID | Feature | Status | Acceptance criteria / next action |
|---|---|---|---|
| `SEC-01` | Provider signature verification | DONE | Timestamp-plus-raw-body HMAC, expiry rejection, constant-time comparison, unsigned rejection, and live signed callbacks are verified. |
| `SEC-02` | API authorization middleware | DONE | PostgREST validates bearer JWTs while the shared guard enforces tenant membership and role; owner, analyst, and cross-tenant behavior is live-tested. |
| `SEC-03` | Rate limiting | READY | Callback, generic event, password login, signup, and recovery endpoints have tested fixed-window limits and Retry-After responses, but counters live in an unbounded process-memory `Map`; Vercel instances do not share this state, so a durable distributed limiter and cleanup policy remain required. |
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
| `TST-04` | Playwright E2E vertical slice | READY | Playwright/Chromium is installed and hosted health/readiness pass, but the latest local 10-test run did not complete: desktop navigation and client handoff timed out, and the suite exceeded five minutes. Protected project/routing/outcome coverage also needs hosted test credentials. |
| `TST-05` | Accessibility and responsive QA | READY | Static JSX accessibility lint plus Playwright desktop sidebar and 390×844 mobile navigation checks pass; full authenticated keyboard, focus, and contrast evidence remains. |
| `OPS-01` | Structured logging and error tracking | BLOCKED | Request IDs and sanitized structured logs are implemented and verified; selecting and credentialing an external error-tracking sink remains a product/operations decision. |
| `OPS-02` | Backup/recovery procedure | DONE | Procedures are documented and an isolated scoped dump/restore drill validated organizations, projects, sessions, events, audits, fraud, notifications, and migration `015`, then removed all temporary artifacts. |
| `DEP-01` | Cloudflare configuration | DONE | Public/server-only variables, runtime bindings, secret boundaries, staging/promotion gates, named-tunnel requirements, monitoring, rollback, and a working Wrangler tunnel launcher are documented and verified locally. |
| `DEP-02` | Staging deployment | READY | The active Vercel site at `www.asrv.co.in` returns healthy/ready with Supabase configured and linked migration history through `028`; exact build identity, authenticated browser behavior, routing metrics, and critical-flow evidence remain unverified. Legacy Sites documentation is stale. |
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
| Local Docker/Supabase | UNAVAILABLE | `docker` is not resolvable on PATH on the current workstation (`docker ps` raises `CommandNotFoundException`), so a local Supabase stack cannot be started or reached. This contradicts the previous `AVAILABLE` marking and supersedes `BLK-16`'s separate claim, which happened to agree that local access was unavailable. Local database verification is therefore not currently possible; hosted verification or a repaired local Docker install is required. |
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
| Supported browser-control surface | PARTIAL | Playwright Chromium 153 is installed and operational; protected hosted flows remain gated by test credentials rather than browser availability. |

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
| 2026-09-14 | Keep the project CSV as a stable summary and add a separate normalized multi-sheet fieldwork workbook. | Project rows and respondent rows have different cardinality; separate worksheets preserve usable Excel data without duplicating or flattening unrelated records into one CSV. |
| 2026-09-14 | Never export raw IP addresses or fingerprint hashes; expose only coarse device class and explainable risk outcomes. | Supports operational fraud review while minimizing sensitive respondent data and preventing reusable identifiers from leaving the protected system. |
| 2026-09-14 | Capture response variables only through a per-project allowlist with classification and retention. | Prevents arbitrary URL parameters from silently becoming durable respondent data and gives operators an explicit privacy control. |
| 2026-09-15 | Assign secondary PM only to a different PM in the same workspace and sales ownership to a workspace member, without adding sales permissions. | Uses the current role taxonomy and preserves existing authorization until a separate sales role is specified. |
| 2026-09-15 | Route the Project Center `$` control to the existing Analytics supplier-cost view. | Reuses verified operational cost data while the financial model remains undefined. |
| 2026-09-15 | Display a market-country suffix on Project IDs while keeping canonical codes for links and APIs; keep Flamingo Tool as a labeled placeholder. | Matches the reference without changing identifiers or claiming an integration contract that has not been supplied. |
| 2026-09-15 | Label supplier directory URLs as a synthetic return check and launch-route base, and keep project-specific respondent Test/Live links in Project details. | Prevents suppliers from treating incomplete base URLs as production survey launches and separates supplier setup from the client's four outcome returns. |
| 2026-09-15 | Use the existing survey-session UUID as ResearchOps' stable client-facing attempt ID while retaining the supplier launch reference for supplier-side events and returns. | Separates identifier ownership without a new migration, keeps already-started client surveys returnable by their legacy reference, and makes the operational mapping visible. |
| 2026-09-15 | Scope supplier-owned references and quota reservations to stable supplier-assignment IDs in migration `039`; preserve assignment rows with respondent history on editor saves. | Lets suppliers reuse external values safely without merging attempts, and retains the mapping needed by delayed outcomes and reconciliation. |

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
| `BLK-08` | RESOLVED - the hosted Supabase service-role credential is stored as a sensitive Vercel Production environment variable. | Keep server credentials confined to encrypted host storage and rotate the legacy key after a replacement secret is proven valid. |
| `BLK-09` | RESOLVED - migration `021` was applied through the authenticated Supabase dashboard. OTP template configuration and deletion of Auth users remain operator dashboard actions because browser control and local CLI execution are unavailable. | Place `{{ .Token }}` in the Magic Link email template and delete users only after confirming project ref `cmrktkzdptmywrtscalu`. |
| `BLK-10` | RESOLVED - Vercel was linked, the invalid production server credential was replaced with the verified Supabase legacy `service_role` credential, and ROP-1137 Test routing now returns HTTP 302 to the configured survey. | Rotate the legacy credential later through a controlled Supabase/Vercel secret replacement; never store or print either credential in the repository. |
| `BLK-11` | RESOLVED - migration `035` objects are present in linked Supabase, its manually applied migration-history entry was repaired, local/remote history matches through `035`, and linked database lint reports no schema errors. | Complete authenticated multi-role integration and browser proof, then deploy the matching application revision. |
| `BLK-12` | Linked CLI access token and local Docker/Podman are unavailable; `037` has not been verified. The user applied `038` and its columns/joins are visible, but functions, triggers, grants, and migration history have not been inspected through an authorized database session. Regular index builds in `037` can block writes on busy event/session tables. | Restore an authorized database session, verify `037` status and `038` objects/history, assess table size/write traffic, and run authenticated multi-role/RLS/audit checks. |
| `BLK-13` | Flamingo Tool contract and workflow are not defined. | Keep the labeled placeholder until URL/API, auth, and user actions are supplied. |
| `BLK-14` | Hosted Project Center previously reported a data-load failure; `038` ownership fields/joins are now visible but an authenticated `/api/projects` response and hosted uptake of commit `be7a0bc` cannot be proven. Vercel CLI reports logged out. | Test a signed-in Project Center read, restore Vercel deployment access or GitHub-to-Vercel uptake if needed, and verify the browser UI after rollout. |
| `BLK-15` | Supplier STATIC/DYNAMIC is stored but does not change return URL construction; generic outcome/status query parameters have not been certified against CPX, BitLabs, or PureSpectrum contracts. | Obtain each provider's official integration contract, map its launch/return IDs and statuses, and test provider-specific callback/return behavior before external production traffic. |
| `BLK-16` | The user's first SQL-editor run of `039` failed at an eight-argument GRANT for the nine-argument `ingest_survey_event` function. The corrected, retry-guarded file was then re-run and reported to complete without error, so the schema change is believed applied to hosted; however the capability RPC has not been re-probed and no live integration test has run against it, so the schema cannot yet be treated as confirmed. Local PostgreSQL/Docker is unavailable on the current workstation, removing the local fallback for verification. | Confirm hosted activation by probing `supplier_scoped_ref_ready`, verify `037` status, then run the live equal-reference, concurrent-quota, terminal-outcome, replay, and assignment-history integration tests and prove hosted routing. |

## Verification record

| Date | Check | Result |
|---|---|---|
| 2026-09-16 | Hosted end-to-end two-ID routing proof on production | PASS - Vercel CLI access recovered for `researchops-fieldwork`; production `https://www.asrv.co.in` returns health `healthy` and readiness `supabase-ready`. New `scripts/qa-routing-flow.mjs` signed up a fresh user, created client/supplier/project `ROP-1141`, activated the assignment, transitioned to `LIVE`, and fetched tool-generated links. Live supplier hit returned 302 to the survey with a fresh session UUID as `RID` plus per-session outcome URLs; the client complete return resolved the UUID and 302'd to the supplier URL carrying the original reference `QA-SUP-REF-1` in `rid`/`respondent_id`/`transaction_id`; the respondent row reached `COMPLETE` with `durationSeconds` captured; replaying the outcome callback stayed idempotent. |
| 2026-09-16 | Tool-only routing simplification and CSV routing proof | PUSHED - commit `fa1fee3` is on `github/main`. Centralized supplier/client link templates and parsers in `worker/domain/routing-links.ts`, added `?diagnose=1` JSON help in `worker/routes/redirects.ts`, fixed vendor alias params, added `node scripts/check-route.mjs`, and added routing test/live links plus supplier names/statuses to the Project Center CSV. New test file passes 3/3 plus existing 4/4 routing tests; lint passes. The 2 failing `rendered-html` directory tests pre-date this work. Hosted probe still returns Worker error pages for dummy tokens, proving routing is deployed; user's `test` project needs supplier ACTIVE/return URLs, assignment ACTIVE, survey URL, and LIVE status. |
| 2026-09-16 | Hosted `039` capability RPC probe and live equal-reference test | PASS - `supplier_scoped_ref_ready` RPC returned `200 true` on hosted Supabase, independently confirming migration `039` activation. Live equal-reference run (`ROP-1143`): two suppliers each posted the same external ref `SAME-REF-777` against the same project; each launch received a distinct ResearchOps session UUID with correct supplier-scoped return routing, proving the assignment-scoped namespace works in production. Concurrent-quota, terminal-outcome distribution, and assignment-history checks remain unrun. |
| 2026-09-16 | Hosted frontend page serving | PASS - public `/login`, `/projects`, `/dashboard`, `/clients`, `/suppliers` and the CSS bundle all return HTTP 200 on `https://www.asrv.co.in`; Vercel auto-deployed commit `bc73e3f` within minutes of push and the `?diagnose=1` checklist/fix output is live on routing error pages. |
| 2026-09-16 | Authenticated hosted `/api/projects` read | PASS - signed-in session received `200` with project data from the hosted Project Center API. |
| 2026-09-15 | Migration `039` SQL-editor failure diagnosis | SOURCE FIX PASS / DATABASE RETRY PENDING - the GRANT omitted one `text` argument even though CREATE/REVOKE named the nine-argument function. Corrected it and guarded the constraint/index/trigger steps for a possible partial run. Two migration-signature/retry regression tests pass; standard build/test passes 41 with 6 environment skips, lint, TypeScript, and diff checks pass. The hosted capability RPC still returns `404 PGRST202`; database transaction/partial state and full SQL lint remain unverified. |
| 2026-09-15 | End-to-end supplier reference isolation | SOURCE PUSHED / LIVE PENDING - commit `6d5c903` is on `github/main`. Migration `039` scopes session and quota keys to assignments, revises ingestion/terminal reservation logic, adds capability detection, and preserves assignment IDs. Four mocked route tests pass for normal two-ID flow, pre-migration collision guard, post-migration equal supplier refs, and ambiguous legacy rejection. The public hosted gateway returns expected pre-migration `404 PGRST202` for the capability RPC. A conditional live Supabase integration test covers two same-ref sessions/reservations, replay, one-sided quota consumption, stable assignment IDs, and historical removal denial; it was skipped without local database credentials. Build/test passes 39 with 6 environment skips; lint, TypeScript, and diff checks pass. |
| 2026-09-15 | Two-ID respondent routing implementation | LOCAL PASS / GITHUB PUSHED - commit `1e28819` is on `github/main`. Launch/client-return test proves the client receives the existing ResearchOps session UUID in RID/rid and the supplier return retains the original supplier reference; pre-change reference return remains accepted. Duplicate assignment reference receives HTTP 409. Build/test passes 37 tests with 5 environment skips; lint, TypeScript, and diff checks pass. Ten public hosted assets lack the new UI label, so Vercel uptake is not proven; authenticated provider traffic remains unverified. |
| 2026-09-15 | User-applied hosted migration `038` schema check | PARTIAL PASS - public hosted Supabase REST probes return HTTP 200 for baseline and ownership columns, existing project joins, and both new ownership profile joins. `/api/health` and `/api/readiness` return 200; no-session `/api/projects` returns expected 401. This proves PostgREST schema visibility, not migration `037`, all `038` functions/triggers, an authenticated dashboard read, or deployment of the latest UI bundle. |
| 2026-09-15 | Hosted Project Center schema and supplier-link review | DIAGNOSED / LOCAL FIX PASS - hosted public Supabase gateway returns HTTP 200 for legacy project columns/joins, HTTP 400 `42703` for ownership columns, and HTTP 400 `PGRST200` for ownership joins. Vercel CLI is logged out and the follow-up client marker is absent from 10 public assets; exact hosted fallback identity remains unproved. Supplier modal labels/copy-all bug is corrected locally; focused Edge interaction passes 1/1, standard build/test passes 35 with 5 environment skips, lint and TypeScript pass. Project Center now shows the safe API failure reason. |
| 2026-09-15 | GitHub main push and pre-`038` hosted compatibility | PUSHED / PARTIAL HOSTED PROOF - `f1a5c67` pushed to `github/main`. Hosted `/flamingo`, `/api/health`, and `/api/readiness` return HTTP 200; the placeholder copy is present. The follow-up compatibility build/test passes 35 tests with 5 environment skips, lint and TypeScript pass, and a simulated pre-`038` Supabase test proves list/detail reads fall back to the existing schema. Authenticated hosted project reads and migrations remain unverified. |
| 2026-09-15 | Screenshot-aligned Project Center and ownership code | PASS LOCALLY - `npm test` builds and passes 34 tests with 5 environment skips; ESLint, `tsc --noEmit`, and `git diff --check` pass. Edge/Playwright demo browser suite passes 13/13 including filters, both metric views, CSV, ownership editing, Flamingo placeholder, and country selection. Desktop/mobile screenshots were reviewed. Linked migrations `037`/`038`, persistent RLS/audit, hosted auth, and deployment remain unverified. |
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
| 2026-08-30 | Existing account recovery dispatch | PASS - the live same-origin Supabase recovery endpoint accepted a fresh request for the existing requested account with HTTP 200; user completion of the newly issued email link and password-login verification remain |
| 2026-08-30 | Recovery callback single-consumer fix | PASS LOCALLY - disabled Supabase SDK automatic URL detection because AuthProvider explicitly redeems every supported recovery callback; lint, 19 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Password-login session adoption | PASS LOCALLY - the client immediately adopts the session returned by a successful password-token response instead of depending solely on the asynchronous Auth event; lint, 19 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Dashboard password-recovery fallback | PASS LOCALLY - recovery credentials delivered to the configured Site URL root are preserved and moved to `/reset-password` before the protected dashboard redirect; lint, 20 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Password-login full navigation fallback | PASS LOCALLY - after a successful Supabase password-token response, login performs a full dashboard navigation so a stale client-router tree cannot block the saved session; lint, 20 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Password-login full navigation production rollout | PASS - Vercel production deployment `dpl_29wsXoHFJnvBhrbQsQAdQbb2kzx7` is Ready and aliased to `www.asrv.co.in`; the live login bundle uses `location.replace` and the root recovery route returns HTTP 200 |
| 2026-08-30 | Password-login client error visibility | PASS LOCALLY - non-credential browser session failures now display a bounded safe error description rather than masking the source after a successful Auth HTTP response; lint, 20 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Supabase gateway decoded-body headers | PASS LOCALLY - strips stale compression, length, and connection headers after reading a decoded upstream Auth response; regression coverage proves a browser will not double-decode an HTTP 200 JSON body; lint, 20 standard tests, production build, Vercel Build Output, and diff validation pass |
| 2026-08-30 | Supabase gateway decoded-body production rollout | PASS - direct Vercel production deployment `dpl_2vy7vHKyGrjyzosnDoYTypi7VYNy` is Ready and aliased to `www.asrv.co.in`; live Auth response inspection confirms stale compression headers are absent |
| 2026-09-13 | Advanced quota code-ready verification | PASS LOCALLY - lint passes; production build passes; quota/eligibility business rules pass 7/7; focused Worker API passes 1/1 including quota CRUD validation; Chromium confirms the new quota editor. The full 7-test browser run has two pre-existing/flaky shell/eligibility readiness failures while 5/7, including the new quota test, pass; database migration/concurrency proof remains environment-gated. |
| 2026-09-13 | Commit `3bf16d7` push and hosted uptake check | PUSHED / NOT DEPLOYED - `origin/main` accepted the atomic-quota revision. Public health and readiness return HTTP 200 with Supabase configured, but none of nine referenced JavaScript assets contains the quota API/reservation build markers; the Sites host has not consumed this revision. |
| 2026-09-13 | Supplier link dialog and current branch regression | PASS LOCALLY - lint and production build pass; 19 business/server-rendered tests pass; focused Chromium passes against a fresh production server and visual evidence confirms separate bordered Test/Live cards with copy actions. The first two dev-server attempts failed from stale/cold navigation and were not counted as product failures. |
| 2026-09-13 | Routing vertical-slice integration harness and resumed regression | PASS LOCALLY / ENVIRONMENT-GATED - added a persistent-data test covering Test isolation, eligibility, one-slot concurrent quota admission, terminal completion, supplier return, metrics, quota consumption, specifications, and audit evidence. Lint, production build, and 27 standard tests pass; 5 Supabase/Docker-gated tests skip because Docker is unavailable in this environment. A stale long-running Vinext server prevented a reliable fresh full Chromium rerun; the already-recorded focused Chromium checks remain valid. |
| 2026-09-13 | Commits `6073014` and `42c0451` push / hosted uptake | PUSHED / NOT DEPLOYED - `origin/main` accepted both revisions. Hosted health and readiness return HTTP 200 and Supabase-ready, but all nine referenced JavaScript assets lack the new survey-setup, project-access, supplier-dialog, and quota markers; the Sites host still has not consumed current Git main. |
| 2026-09-13 | Hosted migration report and direct Sites deployment attempt | MIGRATIONS USER-CONFIRMED / DEPLOYMENT BLOCKED - user reports migrations `023`-`028` completed. Direct `get_site` for the exact repository project ID returns `project_not_found`; the current Sites workspace lists only Survey Redirect Tester, so this session cannot save or deploy a ResearchOps version. Public readiness remains Supabase-ready while all nine live assets still lack current markers. |
| 2026-09-13 | Linked production migration reconciliation | PASS - Supabase CLI linked to project `cmrktkzdptmywrtscalu`. Remote history initially stopped at `022`; `023` and `024` applied normally, existing manually-created `025`-`027` schemas were reconciled into migration history without deleting data, and `028` applied normally. A final linked check reports local/remote parity for every migration `001`-`028`; Vercel health returns HTTP 200. |
| 2026-09-13 | Full-project evidence audit | MIXED - production build and standard suite pass (27 passed, 5 environment-gated skips); lint passes but takes about 146 seconds; production dependency audit reports zero known vulnerabilities. The 10-test Chromium suite times out after five minutes with at least two 30-second failures. Vercel health/readiness return HTTP 200, while authenticated routing/build identity remain unproved. |
| 2026-09-13 | Production project-creation failure response | FIX DEPLOYED TO DATABASE / APP PUSH PENDING - migration `029` explicitly reloaded the PostgREST schema cache after RPC changes from `028`. The Worker now retains safe Supabase status/code/detail diagnostics instead of reducing every database rejection to one generic 502. Production build and standard tests pass: 27 passed, 5 environment-gated skips. |
| 2026-09-13 | Project INSERT RLS repair and market catalog audit | DATABASE FIX APPLIED / RETEST PENDING - the improved production diagnostic identified `42501: new row violates row-level security policy for table projects`. Migration `030` narrowly recreates the intended OWNER/ADMIN/PM project INSERT policy and reloads PostgREST; linked history matches `001`-`030`. The market catalog contains 249 ISO countries/territories and 184 languages; build and standard tests pass with 27 passed and 5 environment-gated skips. |
| 2026-09-13 | Production schema repair through `033` | PASS / UI RETEST PENDING - migration `031` removes the scoped SELECT-RLS conflict caused by `INSERT ... RETURNING *`; `032` repairs eligibility/quota JSON ordinality syntax and the ambiguous quota reservation column; `033` corrects project-access UUID array initialization. Linked migration parity is exact through `033`, and `supabase db lint --linked --level warning` reports no schema errors. |
| 2026-09-13 | ROP-1137 production Test-route verification | PASS - Vercel Production was redeployed with the verified Supabase service-role credential. Health and readiness return HTTP 200; a fresh concrete Test respondent returns HTTP 302 to the configured survey with session-specific outcome callbacks. The reusable Live template still requires the supplier to replace `{{respondent_id}}`. |
| 2026-09-13 | Missing supplier return handling for Test traffic | PASS IN PRODUCTION - CPX Research is intentionally/temporarily configured with no supplier outcome destinations. Test sessions now show a successful recorded-outcome page after COMPLETE/TERMINATE/QUOTA_FULL/QUALITY_TERMINATE instead of a misleading routing error; live sessions continue to require configured supplier return URLs. Production build and 10 focused business-rule tests pass; a fresh hosted route returned 302 and its generated COMPLETE callback returned the expected green HTTP 200 confirmation page. |
| 2026-09-13 | Complete outcome/metrics/CSV standardization | PASS IN PRODUCTION - migration `034` is applied and linked history matches through `034`; database lint reports no schema errors. IR is `CO / (CO + TE) * 100`, conversion is `CO / RC * 100`, and zero denominators return 0. Live and Test COMPLETE/TERMINATE/QUOTA_FULL/QUALITY_TERMINATE remain separately counted; project/supplier/analytics views and CSV exports expose the applicable counts and rates. Build, lint, 10 business-rule tests, and 19 rendered/API tests pass. All four hosted outcome pages passed and ROP-1137 metrics persisted their exact statuses. |

| 2026-09-14 | Fieldwork workbook and respondent-intelligence code-ready verification | PARTIAL PASS - production build and lint pass; focused business/API rules pass 17/17, covering XLSX structure/safety, response-variable configuration validation, respondent export metadata, and separate review actions. Full standard suite retains two documented auth-loading SSR failures. Migration/RLS proof is gated by unavailable Docker/Podman. |
| 2026-09-14 | Linked migration `035` verification | PASS FOR SCHEMA / INTEGRATION PENDING - remote inspection confirms `project_response_variables` and `survey_response_values`; migration history was repaired after manual SQL application and now matches local `001`-`035`; `supabase db lint --linked --level warning` reports no schema errors. Authenticated RLS, capture, cleanup, review, browser, and deployment proof remain. |
| 2026-09-14 | Fieldwork release deployment | BLOCKED SAFELY - verified feature revision is committed locally as `0668533`. GitHub push was not authorized for the unverified remote destination, and the linked Vercel CLI reports logged out; no source or credentials were uploaded. |
| 2026-09-14 | Approved fieldwork GitHub rollout | SOURCE PUSHED / PRODUCTION UPTAKE BLOCKED - user explicitly approved the GitHub destination; `main` advanced through `0668533` and `f6394f5`. Production health/readiness return HTTP 200 and Supabase-ready, but none of the 10 referenced JavaScript assets contains `Download Fieldwork Workbook`; Vercel CLI remains logged out. |
| 2026-09-14 | Screenshot-aligned Project Center | PASS LOCALLY / MIGRATION PENDING - production build and lint pass; 17 focused business/API tests pass. Migration `036` defines full OWNER/ADMIN/PM portfolio reads and scoped ANALYST/MEMBER reads; browser and hosted proof remain. |
| 2026-09-14 | Linked migration `036` verification | PASS FOR SCHEMA HISTORY/LINT - user confirmed manual SQL execution; migration history was repaired and now matches local/remote `001`-`036`; linked database lint reports no schema errors. Multi-role browser proof remains. |
| 2026-09-14 | Screenshot-aligned dashboard GitHub rollout | SOURCE PUSHED / PRODUCTION UPTAKE BLOCKED - commit `e282d44` is on approved GitHub `main`; a delayed production scan still references 10 old assets and contains neither the create-date-order marker nor the fieldwork-workbook marker. Direct Vercel authentication remains required. |

## Session log

### 2026-09-16 - Industry-standard short links (Cint/Toluna style)

- Added `/s/<8-hex-short-code>` supplier routes as clean aliases of `/r/supplier/<uuid>/...`: `supplierShortTemplate`, `parseSupplierShortRoute`, prefix `ilike` resolution in the supplier redirect flow (exact-token query first, then 8-hex prefix fallback, capped at 2 candidates), and `/s/` dispatch in `worker/index.ts`.
- Added standard status-code aliases (`C`=complete, `T`=terminate, `Q`=quota-full, `S`=security-terminate) alongside the existing word outcomes, so supplier return URLs can use either convention.
- Exposed `shortLink` end to end: directories supplier links response, project supplier assignment links (`/api/projects` spec rows), the `supplierAssignments` type, and the Project Center Links dialog (new clean-link card with copy).
- Old `/r/...` links remain fully valid (back-compat); short links share the same routing engine, session IDs, and metrics.
- Verified: `tsc --noEmit` exit 0, `node --test` routing suites 3+4 pass / 0 fail, `npm run lint` clean. Pending: live hosted probe of `/s/` route and Links dialog after Vercel deploy; then user's urgent project launch.
- Current task: hosted `/s/` probe + urgent project launch support. Next: remaining `039` live checks, `038` proofs, provider gates.

### 2026-09-16 - `039` confirmed live and equal-ref proven

- Probed the hosted `supplier_scoped_ref_ready` capability RPC: returned `200 true`, independently confirming migration `039` is active on hosted Supabase.
- Extended `scripts/qa-routing-flow.mjs` with a live equal-reference stage and ran it against production: created two suppliers on the same project (`ROP-1143`), sent the identical external ref `SAME-REF-777` from both, and confirmed each launch received a distinct ResearchOps session UUID with supplier-scoped return routing — the migration's core collision fix is proven live.
- Verified the authenticated hosted `/api/projects` read returns `200` with project data, and public frontend pages (`/login`, `/projects`, `/dashboard`, `/clients`, `/suppliers`) plus CSS all return `200`.
- Confirmed Vercel auto-deploys pushes to `main` (commit `bc73e3f` was production-ready within minutes) and the `?diagnose=1` checklist/fix output is live on routing error pages.
- Remaining `039` checks: concurrent-quota, terminal-outcome distribution, and assignment-history. Remaining release checks: `038` ownership/RLS/audit/tenant-isolation proofs.
- Current task: the remaining `039` live checks, then `038` proofs. Next: fieldwork response capture/retention/review and workbook browser verification, then provider certification gates (CPX/BitLabs/PureSpectrum sandboxes, email/error-tracking selection, financial rules).

### 2026-09-16 - Vercel access recovery and hosted routing proof

- Recovered Vercel CLI access: logged in, confirmed the `researchops-fieldwork` project, and pulled its environment list. Pulled env values arrived masked as sensitive, so database access for diagnosis instead used the production client bundle's public anon key (same-origin gateway ref, saved only to gitignored `anon-key.txt`).
- Probed production `https://www.asrv.co.in`: `/api/health` healthy, `/api/readiness` `supabase-ready`. `DEV_AUTO_LOGIN` remains disabled on hosted, as intended.
- Built `scripts/qa-routing-flow.mjs`, which runs the whole workflow through public APIs only: anonymous signup, organization, client with return URLs, DYNAMIC supplier with `{{respondent_id}}` tokens, project with survey URL and `RID` parameter, ACTIVE supplier assignment, LIVE transition, and tool-generated test/live links.
- Ran it against production and proved the two-ID handoff end-to-end on project `ROP-1141`: supplier live hit created a session and 302'd to the survey with the session UUID in `RID`; `/r/client/<token>/complete?rid=<uuid>` resolved the UUID and redirected to the supplier's complete URL with the supplier's original reference `QA-SUP-REF-1` restored; the respondent row became `COMPLETE` with duration 3 seconds; replaying the per-session outcome callback still redirected without duplicating the event.
- Cleaned up diagnostics, gitignored local credential caches (`anon-key.txt`, `.env.vercel`), committed the QA scripts, and pushed to GitHub `main`.
- Current task: authenticated hosted `/api/projects` read and Project Center load, then `038` ownership/RLS/audit proofs. Next: probe the `039` capability RPC and its live integration tests. The user's own `test` project still needs the four routing gates set in the UI (supplier ACTIVE with return URLs, assignment ACTIVE, survey URL, LIVE status).

### 2026-09-16 - Hosted `039` re-run and environment recheck

- The user re-ran the corrected `039` file in the Supabase SQL editor. The result returned the file's final `select pg_notify('pgrst','reload schema')` statement as a blank row, which is the expected `void` result. Reaching the last statement indicates the file executed to completion, including the line-73 GRANT that failed on the first attempt.
- Reviewed the retry mechanics: every destructive or additive step in `039` is guarded (`drop ... if exists`, `create ... if not exists`, `if not exists(pg_constraint)`), so a re-run converges from any partial state left by the failed attempt rather than erroring. The end state is therefore correct regardless of what the first run committed.
- Rechecked the local environment and found `docker` is not resolvable on PATH, contradicting the credentials table's `AVAILABLE` marking for Local Docker/Supabase. Local database verification is not currently possible, so verification must run against hosted or wait on a repaired local install.
- Not verified: the capability RPC probe, and every live integration check. Hosted activation is user-reported, not independently confirmed. No repository files were changed in this session.
- Current task: obtain an independent hosted confirmation of `039`, then prove two-ID routing and the authenticated Project Center read. Next: fix the local Docker gap or supply hosted credentials so the integration suite can run.

### 2026-09-15 - Migration `039` signature repair

- The user reported SQL error `42883` naming an eight-argument `ingest_survey_event` function. Found the migration's GRANT omitted the provider-transaction-ID `text` argument; CREATE and REVOKE correctly named all nine arguments.
- Corrected the GRANT and made the migration's initial constraint/index changes and delete-guard trigger retryable if the SQL editor retained earlier statements. Added automated checks that every GRANT/REVOKE matches its CREATE FUNCTION signature and that retry guards remain present.
- Verification: two focused migration checks pass; standard build/test passes 41 with 6 environment skips; lint, TypeScript, and diff checks pass. The hosted capability RPC still returns `404 PGRST202`, showing `039` is not fully active; the exact earlier statement persistence and SQL execution cannot be established without an authorized database session.
- Current task: finish checks and push the corrected migration, then retry and verify `039` in Supabase. Next: hosted two-ID routing and authenticated Project Center proof.

### 2026-09-15 - Supplier-scoped routing completion

- Implemented migration `039` to key supplier sessions and live quota reservations by project plus stable supplier assignment plus external attempt ID. Updated the event-ingestion and quota RPCs and the terminal quota trigger to use that namespace. Added a database capability marker so production code keeps the old collision guard until migration `039` is actually present.
- Corrected assignment replacement to upsert rows without changing their IDs; attempted removal of an assignment with sessions or reservations now fails with a close-instead message. A database trigger also blocks direct deletion of historical assignments. Legacy client returns with an external ID matching more than one attempt now fail rather than choose the newest supplier; Respondents search accepts either ID. The existing two-ID launch/return and outcome-token route remain in use.
- Verification: four mocked routing cases pass. Added a conditional live Supabase regression for equal external refs from two suppliers, distinct session/reservation IDs, replay, one-sided quota consumption, stable assignment IDs, and protected history. The hosted capability endpoint currently returns expected `404 PGRST202`. Standard build/test passes 39 with 6 environment skips; lint, TypeScript, and diff checks pass. Local PostgreSQL/Docker/psql and linked CLI are unavailable, so SQL lint and live integration cannot run here.
- Commit `6d5c903` was pushed to GitHub `main`; migration `039` was not applied to the hosted database. Current task: apply and verify `039` in a controlled database window after confirming `037` status. Next: hosted two-ID supplier/client flow and authenticated Project Center, followed by provider-specific contract certification.

### 2026-09-15 - Distinct respondent attempt IDs

- Traced the supplier launch, client survey, client outcome, supplier return, event RPC, and session data. The project already had a stable, random per-session UUID but previously sent the supplier reference onward to the client; both ID owners were collapsed in survey URL parameters.
- Changed the client survey handoff to use the session UUID for `{{respondent_id}}` and `rid`. The client directory return resolves that UUID to the stored supplier reference for event recording and supplier redirect, with a legacy lookup for surveys already started. Respondents detail/CSV now expose both IDs. A route-level duplicate check rejects an external reference already attached to another supplier assignment.
- New limitation: existing project-wide reference uniqueness and quota-reservation keys need an atomic supplier namespace migration if overlapping supplier references must be accepted; generic vendor return parameter contracts still need certification.
- Verification: mocked launch/return and duplicate-assignment regression tests pass; standard build/test passes 37 with 5 environment skips; lint, TypeScript, and diff checks pass. Commit `1e28819` was pushed to GitHub `main`; a public check of ten hosted `/respondents` assets did not find the new label and cannot prove Vercel uptake.
- Current task: release and prove the two-ID routing change on the hosted site. Next: prove authenticated Project Center, then design supplier-namespace migration and verify `037`/`038` behavior.

### 2026-09-15 - User-applied ownership migration verification

- After the user reported applying `038`, repeated read-only hosted Supabase probes: both ownership columns and both new profile joins now return HTTP 200, replacing the earlier `42703` and `PGRST200` failures.
- Hosted health/readiness return 200 and an unauthenticated project-list request returns the expected 401. Authenticated project-list loading, `038` function/trigger behavior, migration history, and `037` indexes remain unverified; public asset inspection did not prove Vercel uptake of the latest UI revision.
- Verification: four hosted PostgREST selects pass; protected route authentication gate passes. No new application code or tests were required for this schema-only change.
- Current task: prove signed-in hosted Project Center loading and latest deployment uptake. Next: verify `037` separately and run authenticated `038` ownership/RLS/audit checks, then fieldwork-intelligence proof.

### 2026-09-15 - Hosted data-load diagnosis and supplier-link semantics

- The reported Project Center banner is the generic UI response to a failed `/api/projects` request. Public hosted Supabase probes confirm the new `038` fields and FK joins are missing, while existing project reads work. The tested fallback is on GitHub `main`, but a public asset check cannot confirm hosted uptake; Vercel CLI reports logged out. Protected API evidence still requires an authenticated hosted session.
- Reviewed the supplier directory and respondent route: its two visible URLs are a synthetic return-destination check and a launch-route base, not four client survey outcomes. The shared modal falsely said Client handoff and Copy all 4 links; its copy-all function only read client outcome keys and copied no supplier routes. Corrected the modal's purpose, labels, count, and clipboard contents, and documented where project-specific respondent launches live. Project Center now surfaces the API error reason rather than discarding it for a generic configuration banner.
- Compared primary BitLabs and PureSpectrum integration documents: outcome callbacks/returns and respondent identifiers are standard, but the exact count, parameters, and provider handling vary. The current STATIC/DYNAMIC selector is metadata only; official vendor contract certification remains a separate blocker.
- Verification: focused Edge supplier-modal flow 1/1, standard build/test 35 passed with 5 environment skips, lint and TypeScript pass; no live migration or protected hosted read was performed.
- Current task: deploy and prove the pre-`038` compatibility revision on Vercel, then schedule and verify `037`/`038`. Next: provider-specific returns and fieldwork-intelligence proof.

### 2026-09-15 - GitHub main rollout and pre-migration compatibility

- Fetched approved GitHub `main`, confirmed local/remote parity, staged only project files and tracker, and pushed commit `f1a5c67` with the reference Project Center, ownership schema/editor, and Flamingo placeholder.
- The hosted site returns HTTP 200 for health, readiness, and the new Flamingo route with its placeholder copy. This confirms a matching site build is visible, while authenticated Project Center/ownership behavior cannot be claimed before migration `038` and multi-role checks.
- Added a narrow API fallback for project list and detail when optional ownership columns or FK joins are absent in the pre-`038` schema; the ownership editor reports that the migration is pending. The standard build/test passes 35 tests with 5 environment skips, lint/TypeScript pass, and a simulated old-schema regression proves both reads.
- Current task: apply and verify migrations `037`/`038` in a controlled database window, then run authenticated ownership, RLS, audit, and Project Center tests. Next: fieldwork-intelligence proof and full hosted multi-role browser verification.

### 2026-09-15 - Qlabs reference Project Center implementation

- Refined the Project Center with a screenshot-style top nav, compact filters and toolbar, dense grid, market-suffixed display IDs, completion percentage, PM/SPM, update/complete dates, sales filter, CSV/XLSX fields, and responsive horizontal scrolling. The `$` control opens existing Analytics supplier cost.
- Added migration `038` for audited secondary-PM/sales assignments, same-workspace role validation, and secondary-PM operating/review capability; added an ownership API/editor and demo behavior. No new sales permission was granted. The invariant is also checked when the primary manager or organization changes.
- Added a clearly labeled Flamingo Tool placeholder because the separate integration contract and workflow have not been provided. Replaced runtime `Intl.DisplayNames` market labels with static English data after a server/browser hydration mismatch appeared in Edge.
- Verification: standard build/test 34 passed, 5 environment skips; lint, TypeScript, and diff checks pass; full Edge browser suite 13/13 passes and desktop/mobile visual screenshots were reviewed. CLI authentication and Docker/Podman are unavailable, so no live migration, authenticated RLS/audit, or hosted deployment is claimed.
- Current task: apply and verify `037`/`038` in a controlled database window, then run linked multi-role Project Center and fieldwork-intelligence proof. Next: deploy the matching revision and complete hosted browser/health checks.

### 2026-09-14 - Screenshot-aligned Project Center dashboard

- Reworked Project Center into the dense reference-style operational grid with Project ID/name, client code and PO, ST/RC/L24, CO/target, TE/OQ/QT, AB/IR/CV percentages, CPI, status, PM, last-update date, relative last-complete time, action, create-date ordering, sticky identity columns, and existing CSV/XLSX/refresh/search controls.
- Added client-code delivery from the existing client directory rather than deriving unreliable initials.
- Added explicit API view metadata and UI redaction: OWNER/ADMIN/PM receive the complete portfolio/column set, while ANALYST/MEMBER see only RLS-authorized projects and the operational core. Migration `036` makes PM organization-wide read access database-enforced without widening PM update privileges.
- Identified SPM and Sales Person as genuinely new ownership concepts. They remain a separate TODO requiring approved role semantics, persisted user references/history, editing, filtering, auditing, and exports; no fake values were introduced.
- Verification: production build and ESLint pass; focused business/API tests pass 17/17. Current task is applying migration `036`, then multi-role and browser verification before deployment.
- Migration follow-up: user confirmed SQL-editor execution; linked database lint passes with no schema errors, and repaired migration history now has exact local/remote parity through `036`. Current task is multi-role browser verification before deployment.
- Git/deployment follow-up: committed and pushed the matching dashboard revision as `e282d44`. Production asset inspection after the push confirms no automatic Vercel uptake; next action remains authenticating Vercel CLI, deploying production, then running multi-role browser verification.

### 2026-09-14 - Fieldwork workbook and respondent intelligence foundation

- Added a browser-compatible, formula-safe XLSX generator and a Project Center “Download Fieldwork Workbook” action. The workbook contains Project Summary, Survey Logs, Screen Conditions, Quota Table, Vendor Survey Links, and Response Variables with frozen/filterable headers and normalized rows.
- Expanded project CSV dates/audit context and enriched respondent API/CSV data with client, market, traffic, reached/terminal times, supplier project ID, provider transaction, reason, coarse device type, risk summary, and separate review states.
- Added migration `035_fieldwork_session_intelligence.sql` for market/device session context, normalized termination reasons, allowlisted classified response variables, retention cleanup, and independently audited internal/vendor reviews. Raw IP and device hashes remain excluded from user-facing data and exports.
- Added the response-variable configuration API/UI and respondent review API/UI. Routing now attaches privacy-safe context, captures only allowlisted values, and records explicit eligibility/quota/security/client reason codes.
- Restricted supplier Test/Live link materialization in project specification and assignment APIs to operators; read-only exports retain assignment metadata without usable opaque routing links.
- Verification: production build passes; ESLint passes; focused business/API tests pass 17/17 including XLSX package structure, all six sheet names, formula-injection safety, absence of IP/device hash labels, response-variable normalization/validation, respondent export metadata, and separate vendor review; `git diff --check` passes. The complete standard suite builds and runs but retains two previously documented auth-loading SSR assertion failures. Supabase CLI validation is environment-gated because Docker/Podman is unavailable.
- Current task is applying and integration-testing migration `035`. Next task is compiled-browser workbook download/review/configuration proof, followed by deployment and explicit business definitions for external Survey ID/TOID/User Number/Vendor Parameter/Account Score.

### 2026-09-14 - Linked migration 035 confirmation

- Confirmed the migration SQL had been applied manually: remote table inspection contains `project_response_variables` and `survey_response_values`, and linked database lint reports no schema errors.
- The Supabase migration ledger initially showed local `035` with no remote version. Repaired only that history entry as applied; final linked migration history has exact local/remote parity through `035`.
- Current task is authenticated persistent/RLS and browser verification of response capture, retention, reviews, redaction, and XLSX download. Deployment follows that proof.

### 2026-09-14 - Fieldwork release deployment attempt

- Created local release commit `0668533` containing the fieldwork workbook, respondent intelligence, response-variable controls, review workflows, migration `035`, documentation, and tests.
- GitHub source upload did not proceed because the destination requires explicit approval. Direct deployment also stopped safely because Vercel CLI is logged out, although `.vercel/project.json` still identifies the linked `researchops-fieldwork` project.
- No source or credentials were sent externally. Current task is obtaining explicit approval for the GitHub `github` remote or restoring Vercel CLI authentication, then deploying `0668533` and running hosted health/readiness and asset checks.

### 2026-09-14 - Approved GitHub push and production uptake check

- After explicit user approval, pushed local `main` through `f6394f5` to `https://github.com/raghvendra912/researchops-fieldwork.git`.
- Production `/api/health` and `/api/readiness` return HTTP 200 with Supabase configured. A delayed inspection of all 10 JavaScript assets referenced by `/projects` found no `Download Fieldwork Workbook` marker, proving the host has not consumed the new revision.
- Direct deployment remains blocked only on Vercel CLI authentication. Next action is `npx vercel login`, followed by `npx vercel --prod --yes` and repeat health/readiness/asset verification.

### 2026-09-13 - Outcome pages, metric formulas, and export consistency

- Added dedicated respondent end-page copy for COMPLETE, TERMINATE, QUOTA_FULL, and QUALITY_TERMINATE whenever a supplier return destination is not configured. Configured supplier URLs still receive the standard respondent/project/transaction/status redirect.
- Added migration `034_outcome_metrics_and_rates.sql`. IR now consistently equals `complete / (complete + terminate) * 100`; conversion equals `complete / reached client * 100`. Both return 0 for an empty denominator. Test outcomes remain visible but isolated from live quota, cost, IR, and conversion.
- Added test complete/terminate/quota-full/quality counters to project and supplier delivery, added supplier conversion, exposed formulas in project and analytics UI, and expanded project/analytics exports with raw denominator counts and calculated rates.
- Respondent API/UI/CSV now identifies TEST versus LIVE traffic and preserves the exact final database status alongside completion time and duration.
- Formula decision is based on Cint's published distinction between conversion (completes divided by respondents reaching the client survey) and system conversion (completes divided by all entrants), while the completion/IR denominator follows completed plus disqualified/terminated responses used by common survey reporting.
- Verification: migration `034` applied to linked production; local/remote history is exact through `034`; linked database lint reports no errors; production build and ESLint pass; focused suites pass 10/10 and 19/19; `git diff --check` passes. Commit `d356d98` is deployed at `www.asrv.co.in`. Fresh isolated callbacks verified the Complete, Terminate, Quota Full, and Quality Terminate pages. ROP-1137 reported live `ST=1, RC=1, CO=1, IR=100%, conversion=100%` and test `ST=8, CO=3, TE=1, OQ=1, QT=1`, proving terminal persistence and formula output. Current task is complete; next operational task is configuring real supplier return destinations before external live traffic.

### 2026-09-13 - Test outcome confirmation without supplier return URLs

- Confirmed the screenshot occurs after a successful test survey completion: the outcome event is recorded, but CPX Research has `STATIC` redirect mode with all four supplier return destinations blank.
- Added test-session awareness to opaque and legacy outcome routes. When a test outcome has no supplier return URL, ResearchOps now returns a green HTTP 200 confirmation page; production traffic retains the HTTP 422 configuration safeguard.
- Verification: production build passes, 10 focused business-rule tests pass, and `git diff --check` passes. Commit `99bc903` is deployed at `www.asrv.co.in`; a fresh hosted Test route returned HTTP 302 and its generated COMPLETE callback returned the expected green HTTP 200 confirmation page. The next operational task is configuring real CPX outcome URLs before accepting live supplier traffic.

### 2026-09-13 - Vercel routing credential repair and production proof

- Linked the local workspace to the correct Vercel `researchops-fieldwork` project and confirmed `www.asrv.co.in` is its production alias.
- Stage-aware diagnostics isolated the reported ROP-1137 failure to the first service-role supplier lookup. Status-only direct checks proved the configured new secret-key entry returned HTTP 401 while the hosted project's legacy service-role credential returned HTTP 200.
- Replaced `SUPABASE_SERVICE_ROLE_KEY` in Vercel Production through an in-memory transfer, marked it sensitive, and forced a clean production deployment. No credential value was stored in or committed to the repository.
- Verification: Vercel remote build completed and aliased to `www.asrv.co.in`; `/api/health` and `/api/readiness` return HTTP 200; a fresh ROP-1137 Test hit returns HTTP 302 to the configured survey URL with unique complete, terminate, quota-full, and security-terminate callbacks.
- Current task is complete for project creation and supplier Test routing. Next task is authenticated UI confirmation that TST increments and a controlled rotation from the legacy service-role credential to a newly issued, independently validated server secret.

### 2026-09-13 - Stage-aware routing diagnosis

- Reproduced the supplied ROP-1137 Test-mode URL against production with a concrete respondent ID; Vercel returned an uncached HTTP 502, proving the remaining fault is inside the runtime routing chain rather than the literal `{{respondent_id}}` placeholder alone.
- Added bounded routing-stage diagnostics for supplier lookup, assignment lookup, eligibility, respondent start, fraud, outcome-token lookup, and reached-client ingestion. Public errors retain a request reference without exposing secrets or respondent metadata.
- Deployed diagnostics isolate the failure to the first service-role supplier lookup. With linked migrations through `033` and zero database-lint findings, the remaining external correction is the encrypted Vercel `SUPABASE_SERVICE_ROLE_KEY`/project pairing; this workspace cannot inspect or mutate that Vercel account setting.
- Verification: production build passes and repeated production requests identify supplier lookup as the failing stage. Current task is correcting the Vercel production service-role secret, then rerunning the route; no further database migration is indicated.

### 2026-09-13 - Complete production function lint repair

- Reworked `create_project_with_market_v4` in migration `031` to pre-generate and return project identifiers without `INSERT ... RETURNING *`, preserving scoped RLS while removing the new-row SELECT-policy conflict.
- Ran linked production database lint and repaired every reported issue: eligibility/quota `WITH ORDINALITY` syntax, quota reservation column ambiguity, and typed empty arrays in quota/access functions through migrations `032` and `033`.
- Verification: production migrations `001`-`033` match local history and linked database lint returns `No schema errors found`. Existing application build and standard suite remain green; authenticated UI project creation and routing are the remaining runtime proof.

### 2026-09-13 - Project creation RLS repair and catalog verification

- Used the deployed bounded Supabase diagnostic to identify the exact project-creation failure: PostgreSQL `42501`, new project rows rejected by the `projects` RLS policy.
- Applied migration `030_restore_project_insert_policy.sql`, recreating only the intended authenticated project INSERT policy with `can_operate_organization`; no broad RLS bypass or multi-table permission rewrite was applied.
- Verified linked migration parity through `030`, production build, and the standard suite (27 passed, 5 environment-gated skips). A post-deployment authenticated Create Project retry remains required.
- Audited market options: source data contains all 249 ISO 3166 countries/territories and 184 ISO 639-1 languages, sorted by display name. Client and supplier choices intentionally come from ACTIVE records saved within the current workspace rather than an undefined global company directory.

### 2026-09-13 - Project creation database failure diagnosis

- Traced the reported Create Project banner to the authenticated `create_project_with_market_v4` RPC; client-side validation had passed, while the previous Worker catch discarded the actionable Supabase response.
- Added migration `029_reload_postgrest_schema.sql` and applied it to linked production to explicitly refresh PostgREST after migration `028` introduced the v4 RPC.
- Extended the shared Supabase request error with bounded status/code/detail diagnostics and made the project API return an authenticated operator-safe actionable message while logging structured database context.
- Verification: migration `029` applied successfully; production build and standard tests pass with 27 passed and 5 environment-gated skips. Current task is deploying this Worker revision and retrying the same project creation to confirm success or capture the now-specific database rejection.

### 2026-09-13 - Full-project readiness review

- Cross-checked the feature board, implementation, migrations, tests, runtime configuration, deployment documents, and live unauthenticated endpoints. No application feature code changed.
- Confirmed build plus the standard test suite pass with 27 tests and 5 environment-gated skips; lint passes in approximately 146 seconds; the production dependency audit reports no known vulnerabilities.
- The latest Playwright run did not complete within five minutes and recorded desktop navigation plus client handoff timeouts. Hosted authenticated routing, TST/live metrics, multi-user project RLS, recovery/OTP delivery, and full accessibility evidence remain open.
- Corrected tracker drift: migrations `025`-`028` are recorded in linked production history, Vercel is the active host, and the process-local unbounded rate limiter is not sufficient as a production distributed control. README and deployment/product guides still require a separate Vercel/`028` documentation refresh.
- Current task remains the hosted authenticated routing vertical slice. Next is deterministic build identity, durable rate limiting/monitoring, and the remaining external provider, email, finance, reconciliation, and operational ownership decisions.

### 2026-09-13 - Production migration reconciliation and routing diagnosis

- Diagnosed the generic Routing Unavailable page and absent Test metric against the linked production database. Remote migration history was at `022`, explaining the current Worker/schema mismatch.
- Applied migrations `023` and `024`. Migrations `025`-`027` already had their leading tables from prior manual execution, so their history entries were safely repaired as applied without dropping or replacing production data. Applied migration `028` normally.
- Verification: linked Supabase history reports exact local/remote parity for `001`-`028`; `https://www.asrv.co.in/api/health` returns HTTP 200 and healthy. Current task is a fresh production Test-link/TST-metric proof; next is live reservation/outcome proof and deterministic Vercel build identity.

### 2026-09-13 - Vercel production target clarification

- User clarified that the active production site is Vercel at `www.asrv.co.in`, not the legacy Sites host; corrected the deployment gate accordingly.
- Confirmed local `main` and `origin/main` are synchronized at `85671a9`. Vercel production health/readiness return healthy and Supabase-ready, but eight loaded JavaScript assets contain none of the current survey setup, project access, supplier dialog, or quota markers after repeated polling.
- Attempted Vercel CLI discovery/login, but no local Vercel project link or credential exists and the CLI download/account check timed out. Automatic deployment therefore depends on repairing the Vercel Git integration or manually redeploying current `main` from the Vercel account.

### 2026-09-13 - User-confirmed migrations and Sites ownership check

- Recorded the user's confirmation that hosted migrations `023`-`028` completed; independent schema/vertical-slice proof remains pending because no hosted authenticated test credential is available in this session.
- Used the Sites connector directly with `.openai/hosting.json` project `appgprj_6a928169a84c8191b3f330591bd308cd`; it returned `project_not_found` and the selected Sites workspace lists only Survey Redirect Tester.
- Public readiness remains healthy/Supabase-ready, but all nine referenced live JavaScript assets still lack the new routing/access/quota markers. The next action is switching Codex to the Sites owner workspace, then saving/deploying exact Git commit `0c8673f` and executing the authenticated routing test.

### 2026-09-13 - Resumed migration 027-028 and routing proof

- Preserved commit `6073014` containing project-scoped access, configurable Test/Live survey destinations and parameters, supplier link separation, authorization updates, and migrations `027`-`028`.
- Added an environment-gated persistent routing test that creates its own tenant/client/supplier/project and proves Test traffic remains TST-only, eligibility terminates mismatches, concurrent one-slot quota admission is atomic, completion returns to the supplier, and final metrics/capacity are correct.
- Hardened the new-project country/language controls against pre-hydration input and retained deterministic India-time rendering for build and created-date labels.
- Verification: `npm run lint` PASS; `npm run build` PASS; standard Node suite 27/27 PASS with 5 environment-gated tests skipped; `git diff --check` PASS. Local Supabase proof cannot run because Docker/Podman is unavailable, and hosted migrations/deployment still require the owning Sites/Supabase context described in `BLK-10`.
- Current task is commit/push followed by hosted build-identity inspection. Next remains applying migrations `023`-`028` and executing the new authenticated routing test against persistent hosted data.
- Push result: commits `6073014` and `42c0451` reached `origin/main`. Public health/readiness remain healthy and Supabase-ready, but inspection of all nine live JavaScript assets found none of the new revision markers, so deployment uptake and hosted migration/application verification remain gated by the owning Sites/Supabase context in `BLK-10`.

### 2026-09-13 - Separated supplier Test/Live link dialog

- Replaced ambiguous inline supplier routing actions with one Links control that opens a centered bordered dialog containing distinct Test and Live cards.
- Test generates a unique `ROP-TEST-*` respondent link and offers separate Copy test and Open test actions; Live copies the reusable supplier template containing `{{respondent_id}}`.
- Added a staged-schema compatibility fallback so Supplier delivery can still load production metrics when the Worker revision arrives before migration `023`; TST remains zero/unavailable until that migration is applied.
- Preserved and verified the in-progress migration `027` project-scoped access and migration `028` test/live survey URL plus open-ended parameter work already present in the branch.
- Verification: `npm run lint` PASS; `npm run build` PASS; business/server-rendered suite 19/19 PASS; focused Chromium supplier-link dialog PASS on a fresh production server; visual screenshot reviewed; `git diff --check` PASS. No credentials or secrets were added.
- Current task is push/deployment uptake verification. Next is applying migrations `023`-`028` in order and proving authenticated Test → TST-only metrics and Live → reservation → outcome → supplier return against persistent hosted data.

### 2026-09-13 - Atomic interlocked quota reservation

- Added migration `026_advanced_quota_reservations.sql` with tenant-scoped quota cells, project/supplier/cell capacity indexes, a service-only atomic reservation RPC, release/expiry/consume lifecycle, and filled/reserved/remaining metrics.
- Added protected `GET/PUT /api/projects/{code}/quota-cells`, strict validation, demo behavior, and a project-workspace editor for prioritized multi-variable interlocks.
- Live supplier routing now evaluates eligibility, selects matching cells, atomically reserves all applicable hard-capacity scopes, releases failed launches, and keeps Test traffic outside quota. Terminal completes consume reservations; terminate, quota-full, quality-reject, and abandon release them.
- Updated README and product/gap documentation through migration `026`. Verification: lint PASS; production build PASS; focused business rules 7/7 PASS; focused Worker/API 1/1 PASS; new Chromium quota editor test PASS. Local Supabase status timed out because no Docker/Supabase process was available, so SQL execution/concurrency and hosted end-to-end proof are not claimed.
- Committed the milestone as `3bf16d7` and pushed it to `origin/main`. The subsequent public smoke check returned healthy/ready with Supabase configured, but inspected nine loaded JavaScript assets and found no `quota-cells` or reservation marker. Deployment uptake remains external under `BLK-10`; the running public version is still older than this commit.
- Attempted the explicit Sites deployment path after reading `.openai/hosting.json`. The exact ResearchOps project ID returned `not found`; listing the selected personal account showed only the unrelated `survey-redirect-test` site. No substitute project was created and no access policy was changed. ResearchOps deployment requires its owning `rav9912` Sites account/workspace context.
- Current task is applying migrations `023`-`026` and deploying the matching Worker revision. Next task is persistent concurrent reservation proof plus authenticated Test/Live routing and metric verification, followed by scoped authorization/UAT/monitoring/reconciliation gaps.

### 2026-08-30 - Production Supabase Auth POST proxy fix

- Reproduced production login and signup failures as HTTP 502 responses from the same-origin Supabase gateway while the upstream Auth health request continued to return HTTP 200.
- Replaced deployment-header forwarding with a narrow Supabase-compatible allowlist and normalized non-GET request bodies for the Vercel Node runtime.
- Added built-worker regression coverage proving Auth POST bodies, authorization, and API-key headers reach Supabase without hop-by-hop or Vercel forwarding headers.
- Lint, 18 standard tests, production build, Vercel Build Output, and `git diff --check` pass. Next task is GitHub/Vercel rollout, live POST verification, and creation of the requested replacement account.
- Pushed commit `c91e1db`; live password-token traffic now reaches Supabase and returns the expected HTTP 400 invalid-credential response instead of HTTP 502.
- The requested email is already registered. Public signup correctly refuses to overwrite its password; Vercel did not export the encrypted production service-role secret, the temporary environment file was removed, and browser control was unavailable. The remaining safe action is deleting and recreating that exact user in Supabase Authentication > Users, followed by a password-login check.
- Verified the supplied password is not the existing account's current password. Supabase accepted a new recovery-email request through the production proxy with HTTP 200; only the newest recovery email should be used because issuing it invalidates earlier links. Complete the recovery flow and then verify password login.
- Root-cause investigation found two one-time recovery-code consumers in the browser: the SDK default `detectSessionInUrl` handler and the explicit AuthProvider callback exchange. Either could redeem the code first, leaving the other to show the generic expired state. Disabled the automatic SDK handler so AuthProvider is the sole consumer; a regression test protects this configuration. The deployed bundle was confirmed to use the same-origin gateway, and the recovery request itself returns HTTP 200, so the remaining live check is a newly generated link after rollout. Secondary external risks remain: requesting another reset invalidates earlier links, and some email-security scanners can consume one-time links before a person opens them.
- Investigated a live password-token HTTP 200 paired with the generic login error. A 200 confirms Supabase accepted the credentials; strengthened the client to use the returned session immediately, rather than relying only on the asynchronous Auth event, and added a specific user-facing diagnosis for browser session-storage blocks. Full local validation passes; live browser confirmation remains next.
- Diagnosed Supabase Dashboard's administrative password-recovery button landing at login: it uses the project Site URL fallback, while the root page previously redirected straight to protected Dashboard and discarded the recovery callback. The root now detects valid recovery PKCE/implicit credentials and makes a full navigation to `/reset-password` before any workspace route guard runs. Regression coverage preserves the credentials intact; full local validation passes.
- Confirmed matching Vercel and Supabase password-token HTTP 200 records, which proves the server accepts the credentials. Replaced the remaining client-router handoff with a full navigation after successful login so the dashboard initializes from the persisted session. The first concurrent local rebuild briefly locked `dist`; the subsequent full suite passes (20 tests, 4 credential-gated skips), as do lint and Vercel Build Output validation.
- Directly deployed the password-login navigation correction after the Git-triggered rollout remained queued. Vercel reports the production deployment Ready and aliased to the permanent domain; live bundle inspection confirms the full-navigation handoff is active.
- Live screenshot confirmed a deliberate wrong-password HTTP 400 followed by an accepted password HTTP 200, but no dashboard request. The currently deployed client bundle already includes the full navigation path, so added bounded safe visibility for the exact post-response client error; credentials and tokens remain excluded. Full local validation passes; live retry after deployment is the next diagnostic gate.
- The safe client error identified the exact root cause as `Failed to fetch` after a Vercel/Supabase HTTP 200. The same-origin gateway was forwarding upstream `content-encoding` and length headers after the runtime had already decoded the response body; browsers then attempted a second gzip decode and rejected valid JSON. The gateway now removes invalid transport headers and has focused regression coverage for this failure mode.
- Directly deployed the decoded-body header correction. Vercel reports production Ready on the permanent aliases, and a live Auth response no longer forwards `content-encoding`; full browser login is now the final live acceptance check.

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

### 2026-08-30 - Project Center filtering and export controls

- Replaced the keyboard-dependent multi-select status field with click-toggle status controls, so several statuses can be chosen directly without Ctrl/Command or Shift.
- Added explicit Search and Refresh controls. Search immediately applies the entered project name/client PO and internal project ID values; Refresh re-fetches the current result set.
- Replaced the visible-page-only export with Download CSV, which downloads every project in the currently filtered result set using the existing spreadsheet-safe CSV generator.
- Verification: lint passes; production build passes; automated suite passes (20 passed, 4 environment-gated tests skipped). No credentials or secrets were added.
- Current task is deployment of these verified Project Center UX improvements to production.

### 2026-08-30 - Project Center filter layout follow-up

- Kept the complete fixed status catalogue visible after every filter refresh, so a selected status no longer disappears when its result set has no remaining records.
- Rebalanced the filter grid, widened the status control area, and aligned the decorative search icon inside the search input below its label.
- Verification: lint and the automated suite pass (20 passed, 4 environment-gated tests skipped). Current task is deployment of this Project Center layout correction to production.

### 2026-09-09 - Respondent outcome tracking and live dashboard funnel

- Added migration `022_survey_session_tracking.sql` with per-session opaque outcome tokens, activity and terminal timestamps, first-terminal-outcome protection, and service-role abandonment reconciliation after 24 hours of inactivity.
- Expanded project and portfolio aggregation with reached-survey, in-progress, terminate, quota-full, quality-reject, abandoned, conversion, drop-off, and last-event measures.
- Replaced shared client outcome callbacks in newly launched survey sessions with unique session callbacks while keeping the legacy callback route for existing live links.
- Added 30-second and manual refresh to Overview and project detail, a visible respondent funnel/outcome breakdown, and direct project-filtered access to the respondent ledger.
- Added common provider outcome aliases and PureSpectrum numeric status normalization; official CPX, BitLabs, and PureSpectrum sandbox certification remains dependent on vendor specifications and credentials.
- Applied production migrations `021` and `022` through the linked Supabase migration history. No credentials or secret values were added to the repository.
- Verification: `git diff --check`, lint, production build, and automated suite pass (21 passed, 4 environment-gated tests skipped); the focused provider normalization suite passes 4/4.
- Current task is the Vercel production rollout and hosted smoke test. Next task is official provider sandbox certification when vendor access is supplied.

### 2026-09-10 - Dashboard 502 isolation and fail-open maintenance fix

- Confirmed the new dashboard assets are live, while authenticated `/api/projects` and `/api/analytics` calls return HTTP 502 together.
- Isolated the common new failure boundary: the optional service-role abandonment reconciliation request could throw before either primary read was attempted.
- Made reconciliation fail open with a status-only warning so maintenance failure cannot interrupt project or analytics reads, and added secret-safe error diagnostics for the primary Supabase operations.
- Verification: lint, production build, `git diff --check`, and the standard suite pass (21 passed, 4 environment-gated tests skipped).
- Current task is deploying the fix and confirming authenticated project and analytics requests return HTTP 200. If either remains 502, the new production diagnostic identifies the exact Supabase operation/status without exposing credentials.

### 2026-09-12 - Visible deployment version and timestamp

- Moved deployment metadata directly below the ResearchOps sidebar logo in the compact format `v.0.048 (12-09-26,5:47pm)`.
- The release number is generated from the Git commit count and advances with each committed release; the build timestamp is generated during deployment and displayed in India Standard Time.
- Preserved the collapsed and mobile navigation layouts by hiding the metadata where the logo itself is condensed or omitted.
- Corrected two lint regressions present after synchronizing the latest Git changes: deferred sidebar preference restoration and replaced render-sensitive timestamp generation in test respondent IDs with a UUID.
- Verification: production build, lint, and the standard suite pass (22 passed, 4 environment-gated tests skipped).
- Current task is deploying the visible release metadata. Next task remains hosted authenticated verification and the external provider certification gates.

### 2026-09-12 - Countable supplier live-test links and metric refresh

- Changed the Project Supplier `Live` copy action to materialize a unique test respondent ID instead of copying an unresolved `{{respondent_id}}` placeholder, so opening each copied link creates a distinct countable live session.
- Follow-up corrected the routing labels: `Test` now copies the unique countable live-flow URL, while `Live` retains the reusable supplier template containing `{{respondent_id}}`; the old redirect-only test URL did not create sessions or metrics.
- `Test` now generates a ResearchOps-owned `ROP-TEST-*` respondent reference and immediately opens the countable route in a new tab (also copying it), causing the backend to create the internal survey session on a successful active live route.
- Connected project-detail manual and 30-second refreshes to the supplier-delivery query, allowing ST, RC, outcomes, IR, and cost to update without leaving the page.
- Live routing still intentionally requires both project `LIVE` and supplier assignment `ACTIVE`; `PENDING`, `PAUSED`, and `CLOSED` traffic remains blocked.
- Verification is environment-blocked: `npm run lint` could not find ESLint because dependencies were absent, and two approved `npm install` attempts timed out in the current environment. No credentials or secrets were added.
- Current task remains deploying the dashboard 502 fix together with this supplier-link usability change, then smoke-testing authenticated project/analytics reads and a live supplier hit. Next task remains official provider sandbox certification when vendor access is supplied.
- Deployment attempt: commit `c29a467` was pushed to `origin/main`; hosted health/readiness return HTTP 200, but the Sites project route still serves the previous client bundle and does not contain the new `ROP-TEST` behavior. The Git-to-Sites deployment connection/queue requires external inspection before the live smoke test can proceed.

### 2026-09-12 - Collapsible sidebar and visible build identity

- Added a compact sidebar collapse/expand control with the preference retained in browser storage; the existing mobile bottom navigation remains unchanged.
- Added a sidebar build badge showing the deployed Git commit prefix and build date, with the full local build timestamp available on hover. Vercel, Cloudflare Pages, and GitHub build SHA variables are supported, with an explicit `dev` fallback.
- Verification: `git diff --check` passes. The production build transformed 273 modules successfully but final packaging exceeded the five-minute environment timeout; ESLint likewise started successfully but exceeded the timeout without producing a diagnostic.
- Current task is pushing this UI/build-identification revision and verifying that the hosting platform consumes the new commit. Hosted authenticated/browser verification remains externally gated.
- Deployment result: revision `9120187` was pushed to `origin/main`; hosted `/api/health` remains HTTP 200, but repeated client-asset inspection still does not find the collapse control. The Sites project is not consuming Git pushes automatically, and no hosting credential/CLI binding is available in this workspace; manual Sites deployment remains the blocker.

### 2026-09-12 - Complete product documentation and role-based gap analysis

- Added `docs/PRODUCT_AND_TECHNICAL_GUIDE.md` covering product scope, workflows, lifecycle, modules, respondent routing, architecture, schema, API catalogue, authorization, security, metrics, development, and deployment truth.
- Added `docs/ROLE_HIERARCHY_AND_GAP_ANALYSIS.md` with the current and target OWNER/ADMIN/PM/ANALYST/MEMBER hierarchy, capability matrix, stakeholder definitions of done, and a P0/P1/P2 market-research roadmap.
- Benchmarked gaps against current official ISO 20252, ICC/ESOMAR, Insights Association, participant-rights, and European Commission GDPR guidance; documentation explicitly avoids claiming certification or legal advice.
- Corrected documentation drift by recording migration `022` as the current highest hosted/application migration and linking the new guides from README.
- Verification: source links and repository-relative document links were reviewed, `git diff --check` passes, and documentation claims were reconciled against Worker authorization/routes and migrations `001` through `022`. No runtime code or secrets changed in this documentation session.
- Current task remains restoring deterministic Sites deployment from Git and completing hosted authenticated/browser smoke tests. The next product-design task should be P0 membership/scoped authorization and privacy/reconciliation rules before expanding finance or research analytics.

### 2026-09-12 - Provider-neutral supplier return redirects

- Normalized every configured supplier outcome destination to carry `respondent_id`, `project_id`, `transaction_id`, and a portable status value while preserving existing custom query parameters and placeholder templates.
- Applied the same behavior to complete, terminate, quota-full, quality-reject, inactive-traffic, and redirect-configuration test paths; immutable event ingestion and first-terminal-outcome behavior are unchanged.
- The baseline follows common provider patterns documented by BitLabs and PureSpectrum, while provider-specific status codes/signatures remain gated on official sandbox certification.
- Verification: focused business-rule suite passes 5/5, including parameter preservation and `QUALITY_TERMINATE` normalization; `git diff --check` passes. No schema migration or secret change is required.
- Current task is deployment and a hosted end-to-end respondent return smoke test. Deterministic Sites deployment and official provider sandbox credentials remain external blockers.

### 2026-09-12 - Playwright Chromium browser coverage

- Installed `@playwright/test` and Chromium 153, added a reusable Playwright configuration, and added desktop/mobile shell plus health/readiness browser tests under `tests/e2e`.
- Browser evidence exposed a real hydration race: the sidebar toggle could appear before its React handler was ready, losing an early click. The control now remains disabled until stored sidebar state has loaded and hydration is ready.
- Verification: focused redirect business rules pass 5/5; the full local Playwright suite passes 3/3 (health/readiness, desktop collapse/version/persistence, and 390×844 mobile navigation); hosted Playwright health/readiness passes 1/1.
- `TST-04` and `TST-05` move from BLOCKED to READY because the browser runtime now works. Hosted authenticated project/routing/outcome, full keyboard/focus, and contrast evidence still require protected test credentials.

### 2026-09-12 - Complete test-routing and clean client redirects

- Replaced client handoff URLs containing visible `{{respondent_id}}` and `{{project_id}}` query templates with four clean fixed same-origin outcome endpoints.
- Expanded legacy client outcome compatibility to accept respondent aliases `respondent_id`, `transaction_id`, `respondent`, `rid`, and `uid`, plus project aliases `project_id`, `project`, and `survey_id`.
- Preserved `mode=test` from the Project Supplier Test button through the backend. Test mode now uses a real unique `ROP-TEST-*` respondent, requires a valid supplier/project assignment, bypasses production lifecycle/quota gates, and records `START` before onward-survey validation.
- When a test has no configured survey URL, its ST metric remains counted and the browser receives a branded successful test-result page explaining that RC needs a valid survey URL. Routing failures now use a professional no-index page and emit a sanitized `redirect_failed` log instead of exposing the raw fallback HTML.
- Verification: production build passes; business rules pass 5/5; focused Worker/API regression passes 1/1; local Chromium suite passes 4/4 including clean client handoff URLs; `git diff --check` passes. The full Node suite still has three pre-existing SSR expectation failures caused by authenticated/demo rendering differing from stale assertions; the redirect/API-focused case passes.
- Deployment result: commit `fd2b203` is pushed to `origin/main`; hosted health and readiness both return HTTP 200 with Supabase configured, but hosted JavaScript asset inspection does not contain the new redirect copy or `mode=test`. The Sites host has not consumed this Git revision, so live authenticated ST/RC verification remains blocked on its external deployment trigger. Next task is deploying `fd2b203`, then running an authenticated Test click through ST, RC, outcome, and supplier return.

### 2026-09-12 - Simplify the client redirect modal

- Removed the complete Redirect variables editor from the client handoff modal, including Add variable, source/default/required controls, Remove, and Save variables.
- Kept the four clean outcome URLs and their individual/copy-all actions. Existing backend redirect alias compatibility remains intact for integrations already sending respondent and project identifiers.
- Verification: production build passes; Chromium suite passes 4/4; focused Worker/API suite passes 1/1 with the exact respondent/project placeholder URL shape; `git diff --check` passes. Current task is commit and push. Next task remains hosted deployment uptake and authenticated respondent-flow verification.
- Clarification applied during verification: the editable variable-management form remains removed, while every copied outcome URL now carries `rid={{respondent_id}}` and `project={{project_id}}` so the survey platform can return each unique respondent to the correct ResearchOps session and project.

### 2026-09-12 - Separate UAT traffic from production delivery

- Added migration `023_test_traffic_separation.sql` with a durable `survey_sessions.is_test` dimension and a backward-compatible nine-argument event-ingestion RPC.
- Project and supplier metric views now expose `test_starts` separately and exclude test sessions from production starts, reached, outcomes, incidence, conversion, abandonment, quota consumption, duration, and supplier cost.
- Routing propagates `mode=test` into START and REACHED_CLIENT event ingestion; a session remains test-scoped for its full lifecycle. Supplier delivery now shows a dedicated `TST` column and explains that it is excluded from live delivery and cost.
- Verification: production build passes; lint passes; focused business/security tests pass 8/8; focused Worker/API regression passes 1/1; Chromium suite passes 5/5 including the visible TST separation; `git diff --check` passes. Current task is commit/push and staging migration application. Next task is excluding test sessions from the portfolio analytics snapshot, proving the full hosted test/live outcome flow, then implementing eligibility and advanced quota cells.

### 2026-09-12 - Production-only portfolio analytics

- Added migration `024_production_analytics_scope.sql`; `analytics_snapshot` now builds portfolio, supplier, client, market, in-progress, conversion, drop-off, and cost results exclusively from non-test sessions.
- The analytics response exposes `portfolio.testStarts` separately so UAT activity remains observable without contaminating contractual delivery.
- Verification: production build passes; focused Worker/API regression passes 1/1 and asserts the separate test-start response; `git diff --check` passes. Current task is commit and push. Applying migrations `023` and `024` plus authenticated hosted routing remains the deployment gate; eligibility and advanced quota cells follow this invariant work.

### 2026-09-13 - Eligibility rule engine and project editor

- Added a deterministic eligibility engine supporting equals/not-equals, inclusion/exclusion, minimum/maximum, and inclusive numeric range rules with required-value failure reasons.
- Added migration `025_eligibility_rules.sql` with tenant RLS, operator-only replacement RPC, validation, rule ordering, and a 30-rule project limit.
- Added protected `GET/PUT /api/projects/{code}/eligibility`, a project-workspace rule editor, and live/test routing enforcement using supplier URL variables before client survey handoff.
- Ineligible respondents receive START then TERMINATE for an auditable incidence trail and return through the supplier terminate destination; qualifying respondents continue to the existing secure per-session outcome flow.
- Verification: eligibility business rules pass as part of 6/6 focused rules; production build passes; focused Worker/API test passes 1/1 including valid/invalid CRUD; Chromium passes 6/6 including editor interaction; `git diff --check` passes.
- Current task is commit/push. Next task is atomic advanced/interlocking quota cells and reservation, followed by migrations `023`-`025` and authenticated hosted vertical-slice proof.
- Current task is deployment followed by authenticated supplier Test → session → metrics → outcome verification on the hosted revision.

### 2026-09-13 - Migration 023 view compatibility fix

- Corrected migration `023_test_traffic_separation.sql` after PostgreSQL rejected an in-place view column rename from `starts` to `test_starts`.
- Preserved every existing `project_event_metrics` and `project_supplier_event_metrics` column in its original ordinal position and appended `test_starts` at the end, which is supported by `CREATE OR REPLACE VIEW` and avoids dropping dependent views or APIs.
- Verification: production build, lint, and `git diff --check` pass.
- Current task is rerunning migration `023`, followed by migrations `024` onward in order. Next task remains authenticated hosted routing and metrics verification.

### 2026-09-13 - Migration 027 fraud resolver syntax fix

- Corrected `resolve_fraud_flag` in migration `027_project_scoped_access.sql`: PostgreSQL does not allow a `%rowtype` record variable and a scalar variable in the same multi-item `SELECT INTO` target list.
- The function now locks and loads the authorized fraud flag into its row variable, then reads the related session project ID separately for the audit record; review authorization and update behavior are unchanged.
- Scanned all migrations for the same pattern; remaining multi-item `INTO` statements target scalar variables and are valid.
- Verification: lint and `git diff --check` pass. Current task is rerunning migration `027`, then continuing with `028`.

### 2026-09-13 - Transient Supabase routing recovery

- Fixed the production failure where a single Supabase `429`, `502`, `503`, or `504` during supplier, assignment, eligibility, quota, fraud, or callback lookup immediately sent a respondent to Routing unavailable.
- Read-only routing requests now make up to three bounded attempts with short backoff. Mutation RPCs remain single-attempt so quota reservations and outcome writes cannot be duplicated by transport retries.
- Added regression coverage proving a first-attempt `504` recovers on the next successful response and that permanent client/configuration statuses are not retryable.
- Verification: focused business rules pass 12/12; the complete standard suite passes 29 tests with 5 environment-gated tests skipped; production build, lint, and `git diff --check` pass. Commit `703d187` was deployed to Vercel production; hosted health/readiness return HTTP 200 and 10/10 fresh ROP-1137 test respondents returned the expected HTTP 302 survey redirect with no routing failure.
- Current task returns to reliability monitoring and the external provider certification gates.

### 2026-09-14 - Clear traffic metrics, outcome pages, and project controls

- Added an explicit Live metrics/Test metrics switch to Project Center. Live retains ST/RC/L24/CO/TE/OQ/QT, production IR (`CO / (CO + TE)`), conversion (`CO / RC`), and CPI; Test displays its separately stored ST/CO/TE/OQ/QT plus test IR without contaminating live delivery, quota, conversion, or cost.
- Replaced generic terminal-result content with four clean ResearchOps-branded respondent pages for Complete, Terminate, Quota Full, and Quality/Security Terminate. Each page contains only the brand, outcome identity, and a short respondent-facing message; technical test/live and workspace instructions were removed.
- Made text search explicitly apply through Search or Enter, made Clear filters clear both visible and applied values immediately, retained forced API Refresh, and verified filtered full-project CSV download including live/test outcome data and project specifications.
- Verification: targeted lint passes; production build and the standard suite pass (29 passed, 5 environment-gated tests skipped); rendered HTML coverage includes both metric views and CSV control; compiled-production Chromium interaction passes 1/1 for Search, Live/Test switching, Refresh, Clear filters, and CSV download; `git diff --check` passes.
- Production deployment: commit `cb5e597` was pushed and deployed to Vercel at `www.asrv.co.in`; hosted health returns HTTP 200, the deployed hashed Project Center JavaScript contains Live/Test metric controls and CSV download behavior, the deployed stylesheet contains the traffic switch, and a fresh ROP-1137 test respondent still returns the expected survey redirect. Outcome-page code was included in the same immutable Worker build; the configured supplier may redirect terminal traffic onward, so its ResearchOps fallback page is shown only when that outcome destination is blank.
- Current task returns to reliability monitoring and external provider certification.

### 2026-09-14 - Remove Project Center summary cards

- Removed the Live projects, Pending launch, Paused, and Total completes summary-card strip from Project Center while retaining filters, Live/Test metric tables, refresh, export, and project controls.
- Added rendered-page regression coverage confirming the removed summary-card copy is absent.
- Verification: production build passes; rendered HTML suite passes 9/9. Current task remains reliability monitoring and external provider certification.

### 2026-09-14 - Workspace-wide Project Center overview

- Changed Project Center from the signed-in manager's assigned-only scope to the complete workspace portfolio, including filtering, pagination, displayed totals, Live/Test metrics, and CSV export.
- Updated the page copy and product documentation to state that the view contains all workspace studies; role-aware project controls remain unchanged.
- Verification: production build passes and the rendered HTML suite passes 9/9. The existing local Playwright server on port 3001 served a stale build; a clean-port retry reached the interaction test but exceeded the command window in the slow local environment. Commit `aa561fe` was pushed to `origin/main` and directly deployed through the linked Vercel project. Production health returns HTTP 200; the exact hosted Project Center asset returns HTTP 200, contains the workspace-wide copy and `scope=all`, and excludes the removed summary-card copy. Current task returns to reliability monitoring and external provider certification.
