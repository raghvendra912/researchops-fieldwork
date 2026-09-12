# ResearchOps product and technical guide

Last reviewed: 2026-09-12  
Implementation baseline: Git `main`, database migrations `001` through `022`

## 1. Product purpose

ResearchOps is a multi-tenant fieldwork operations system for quantitative market research. It coordinates clients, projects, markets, sample suppliers, respondent traffic, outcomes, quality review, notifications, and operational analytics.

It is an operations platform, not yet a complete survey-authoring, panel-management, accounting, or research-reporting suite. The external questionnaire remains hosted by the client or survey platform; ResearchOps controls and observes the respondent journey around it.

## 2. Primary business workflow

```text
Organization onboarding
  -> client and supplier setup
  -> project creation
  -> market/quota configuration
  -> supplier assignment and pricing
  -> project launch
  -> respondent routing
  -> immutable event ingestion
  -> terminal outcome and supplier redirect
  -> fraud review and operational monitoring
  -> ID submission -> invoicing -> closure
```

### Project lifecycle

| State | Meaning | Allowed next states |
|---|---|---|
| `PENDING` | Configuration/pre-launch | `LIVE` |
| `LIVE` | Accepting active supplier traffic | `PAUSED`, `ID_SUBMITTED` |
| `PAUSED` | New traffic stopped temporarily | `LIVE`, `ID_SUBMITTED` |
| `ID_SUBMITTED` | Respondent IDs submitted for reconciliation | `INVOICED`, `LIVE` |
| `INVOICED` | Operational invoice milestone reached | `CLOSED` |
| `CLOSED` | Final operational state | None |

Transitions are validated in the database and recorded in the audit log.

## 3. User-facing modules

| Module | Current capability |
|---|---|
| Overview | Organization-level project count, respondent funnel, supplier delivery/cost, and notifications |
| Project Center | PM-scoped project listing, filters, pagination, status summary, CSV export, and create access |
| Project workspace | Core configuration, lifecycle, funnel/outcomes, markets, supplier assignments, routing links, and respondent ledger link |
| Clients | Search, create/edit, contact data, status, and clean same-origin outcome links |
| Suppliers | Search, create/edit, contacts, redirect mode, outcome destinations, and opaque routing links |
| Respondents | Project/search filters, session status, immutable timeline, duration, supplier CPI, and CSV export |
| Fraud review | Duplicate, speeding, and quality flags with explainable evidence and operator decisions |
| Notifications | Operational inbox plus administrator-controlled event and pacing rules |
| Analytics | Date-scoped portfolio, supplier, client, and market summaries with CSV export |
| Settings | Organization name, timezone, and presentation of enforced security controls |

## 4. Respondent routing model

Supplier live links use an opaque supplier token plus project code and a supplier-provided respondent reference.

```text
GET /r/supplier/{supplier-token}/live?project=ROP-123&respondent=ABC-123
```

The router:

1. validates the supplier, project, assignment, status, quota, and rate limit;
2. creates or reuses a respondent session through the event-ingestion RPC;
3. records `START` and evaluates server-side duplicate/device/speed rules;
4. creates opaque per-session outcome callback URLs;
5. injects respondent, project, and outcome variables into the survey URL;
6. records `REACHED_CLIENT` and redirects to the questionnaire;
7. accepts a terminal outcome and redirects to the supplier destination.

Every supplier return redirect now preserves configured custom query values and guarantees four portable fields: `respondent_id`, `project_id`, `transaction_id`, and normalized `status` (`complete`, `terminate`, `quota-full`, or `quality-terminate`). Existing `{{respondent_id}}` and `{{project_id}}` templates remain backward-compatible.

Client handoff displays four compact outcome URLs with `rid={{respondent_id}}` and `project={{project_id}}`. The survey platform must replace both placeholders when returning each respondent, allowing ResearchOps to resolve the unique session and project. Client outcome routes also accept `respondent_id`, `transaction_id`, `respondent`, or `uid` for the respondent and `project_id` or `survey_id` for the project. Per-session `/r/outcome/{session-token}/{outcome}` callbacks remain the preferred live-flow mechanism because ResearchOps injects them automatically.

Supported events are `START`, `REACHED_CLIENT`, `COMPLETE`, `TERMINATE`, `QUOTA_FULL`, `QUALITY_TERMINATE`, and `ABANDON`. The first terminal outcome wins. Replays with the same provider transaction ID are idempotent.

The Project Supplier `Test` action creates a unique `ROP-TEST-*` respondent reference and opens a countable test-mode path. Test mode requires a real supplier assignment but may run before the project is LIVE, bypasses production quota enforcement, and records `START` before validating the onward survey URL. Migration `023` persists this as `is_test`; the Supplier delivery table exposes a separate `TST` count while production ST/RC/outcomes, incidence, conversion, quota, and cost exclude test sessions. A valid survey handoff records `REACHED_CLIENT`; a missing survey URL returns a branded test-result page while retaining the counted test start. `Live` copies the reusable production supplier template containing `{{respondent_id}}` and continues to enforce active project, assignment, and quota gates.

## 5. Architecture

```text
React 19 + Vinext routes/components
              |
              | same-origin JSON + Supabase bearer token
              v
Cloudflare-compatible Worker router
              |
              | PostgREST / RPC
              v
Supabase Auth + PostgreSQL + RLS
```

### Frontend

- `app/` contains public authentication routes and protected product routes.
- `app/components/` contains the operational screens.
- `src/features/auth/` owns session restoration, sign-in, signup OTP, recovery, and sign-out behavior.
- `src/features/projects/` owns project types, mock data, and safe CSV generation.
- `src/lib/api.ts` is the shared same-origin JSON request wrapper.
- `src/lib/supabase.ts` configures the browser authentication client.

The application supports a clearly identified demo mode when Supabase is not configured. Demo behavior is not proof of production persistence.

### Worker/API

- `worker/index.ts` dispatches API, routing, authentication-proxy, image, and application requests.
- `worker/routes/` contains domain handlers.
- `worker/lib/authorization.ts` enforces workspace capability groups.
- `worker/lib/supabase.ts` performs PostgREST/RPC calls.
- `worker/lib/rate-limit.ts`, `fraud.ts`, and `observability.ts` provide cross-cutting controls.
- `worker/providers/` normalizes provider-specific callback data.

### Database

Supabase PostgreSQL is the system of record. Main entities are:

| Entity | Purpose |
|---|---|
| `organizations` | Tenant/workspace boundary |
| `organization_members` | User membership and role |
| `user_profiles` | Tenant-visible display identity |
| `clients` | Client directory and opaque routing identity |
| `suppliers` | Sample supplier configuration and outcome destinations |
| `projects` | Commercial/operational project record and lifecycle |
| `project_markets` | Country/language quota and expected LOI/IR |
| `project_suppliers` | Supplier project ID, CPI, target, and traffic status |
| `survey_sessions` | One project/respondent session and current outcome |
| `survey_events` | Append-only respondent event ledger |
| `project_quality_policies` | Project-level quality rule configuration |
| `fraud_flags` | Explainable quality/fraud review queue |
| `notification_rules` | Tenant alert preferences and thresholds |
| `notifications` | Operational alert inbox |
| `audit_logs` | Privileged-action history |

Derived views/functions provide project metrics, supplier metrics, analytics snapshots, atomic configuration changes, risk evaluation, and abandonment reconciliation.

## 6. API catalogue

### Platform and authentication

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Process health |
| `GET /api/readiness` | Application/API/database configuration state |
| `/supabase/auth/v1/*` | Restricted same-origin Supabase Auth proxy |
| `/api/testing/*` | Explicit local-only protected owner auto-login workflow |

### Protected workspace APIs

| Endpoint | Methods | Purpose |
|---|---|---|
| `/api/organizations/current` | `GET`, `PATCH` | Current workspace and settings |
| `/api/organizations` | `POST` | Initial organization onboarding |
| `/api/projects` | `GET`, `POST` | Project listing/export and creation |
| `/api/projects/{code}` | `GET`, `PATCH` | Project detail and core update |
| `/api/projects/{code}/transitions` | `POST` | Controlled lifecycle transition |
| `/api/projects/{code}/markets` | `GET`, `PUT` | Atomic market/quota replacement |
| `/api/projects/{code}/suppliers` | `GET`, `PUT` | Atomic supplier assignment replacement |
| `/api/clients` | `GET`, `POST` | Client directory |
| `/api/clients/{id}` | `PATCH` | Client/status/redirect-variable update |
| `/api/suppliers` | `GET`, `POST` | Supplier directory |
| `/api/suppliers/{id}` | `PATCH` | Supplier/status/destination update |
| `/api/respondents` | `GET` | Session explorer and export |
| `/api/fraud-flags` | `GET` | Tenant fraud queue |
| `/api/fraud-flags/{id}` | `PATCH` | Confirm/dismiss a flag |
| `/api/analytics` | `GET` | Date-scoped analytics snapshot |
| `/api/notifications` | `GET` | Notification inbox |
| `/api/notifications/{id}` | `PATCH` | Mark notification read |
| `/api/notification-rules` | `GET`, `PUT` | Read/replace alert rules |

### Service and routing APIs

| Endpoint | Purpose |
|---|---|
| `POST /api/events` | Timestamped HMAC event ingestion |
| `POST /api/callbacks/{provider}` | Signed CPX/BitLabs/PureSpectrum callback normalization |
| `GET /r/supplier/{token}/test` | Redirect-configuration check (legacy/API-level behavior) |
| `GET /r/supplier/{token}/live` | Validated respondent launch |
| `GET /r/outcome/{session-token}/{outcome}` | Per-session terminal outcome |
| `GET /r/client/{token}/{outcome}` | Legacy client outcome route |

## 7. Authorization and tenancy

All production workspace reads require a Supabase bearer session. PostgreSQL Row Level Security restricts records to organization membership. The Worker adds role checks before protected operations.

| Capability | Roles |
|---|---|
| Read workspace data | OWNER, ADMIN, PM, ANALYST, MEMBER |
| Operate projects/suppliers/fraud | OWNER, ADMIN, PM |
| Administer clients/settings/rules | OWNER, ADMIN |
| Ownership-only authority | OWNER (defined, but very few dedicated owner operations exist) |

Current limitation: membership invitation, role assignment, deactivation, transfer of ownership, and project-specific access are not implemented.

## 8. Security and data integrity

Implemented controls include tenant RLS, role authorization, server-only service secrets, HMAC callback verification, timestamp expiry, constant-time comparison, per-origin rate limits, opaque redirect tokens, append-only events, terminal-outcome protection, safe structured logs, audit records, formula-safe CSV, raw identifier hashing, duplicate checks, speeding checks, and quality review.

Operational dependencies still include a hosted error-tracking sink, formal incident ownership, provider secret rotation procedures in the hosting platform, browser verification, and official provider contracts.

## 9. Metrics definitions

| Metric | Current definition |
|---|---|
| Starts (`ST`) | Distinct sessions with a `START` event |
| Reached (`RC`) | Distinct sessions with `REACHED_CLIENT` |
| Completes (`CO`) | Distinct sessions with `COMPLETE` |
| Terminates (`TE`) | Distinct sessions with `TERMINATE` |
| Over quota (`OQ`) | Distinct sessions with `QUOTA_FULL` |
| Quality terminate (`QT`) | Distinct sessions with `QUALITY_TERMINATE` |
| In progress | Session status is `START` or `REACHED_CLIENT` |
| Abandoned | `ABANDON`, normally reconciled after 24 hours inactivity |
| Conversion | Completes / starts |
| Current incidence rate | Completes / (`COMPLETE` + `TERMINATE`) |
| Supplier cost | Supplier CPI × completes |
| Duration | Terminal timestamp − start timestamp |

Business owners should approve these definitions before using them for contractual reconciliation. In particular, industry and individual clients may define incidence, billable completes, reconciliation, and over-quota treatment differently.

## 10. Development and deployment

Requirements: Node.js 22.x, npm, Docker Desktop, and Supabase CLI.

```powershell
npm install
npx supabase start
npm run dev
```

Verification:

```powershell
npm run lint
npm run build
npm test
npm run test:e2e
```

Apply migrations in filename order through `025`. Runtime secrets belong only in the hosting secret manager. The visible sidebar build badge uses `VERCEL_GIT_COMMIT_SHA`, `CF_PAGES_COMMIT_SHA`, or `GITHUB_SHA`, with `VITE_APP_VERSION`/`dev` as fallback.

The repository is pushed to GitHub, but the current Sites URL has not consistently consumed Git pushes automatically. A green Git push is therefore not deployment proof; verify the visible version, `/api/health`, `/api/readiness`, authentication, project reads, and an end-to-end respondent outcome.

## 11. Related documents

- `PROJECT_TRACKER.md`: delivery status and next task (source of truth)
- `README.md`: setup and route overview
- `docs/ROLE_HIERARCHY_AND_GAP_ANALYSIS.md`: target organization model and prioritized gaps
- `docs/OPERATIONS.md`: backup, recovery, incidents, and secret rotation
- `docs/DEPLOYMENT.md`: environment and promotion checklist
