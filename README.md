# ResearchOps

A working research fieldwork operations application: organization overview, PM-scoped Project Center, controlled project creation, ISO country/language markets, contact directories, supplier traffic controls, masked respondent routing, event metrics, respondent/analytics exports, and a Cloudflare Worker API.

## Development status

Read [PROJECT_TRACKER.md](PROJECT_TRACKER.md) before continuing development. It is the source of truth for implemented features, the complete roadmap, acceptance criteria, blockers, required credentials, verification history, and the exact next task. Update it before ending every development session.

## Hosted staging

The publicly reachable hosted staging environment is available at:

```text
https://researchops-fieldwork.rav9912.chatgpt.site
```

It runs the Cloudflare Worker-compatible Vinext build through Sites and uses a hosted Supabase Free project in `ap-south-1`. The ResearchOps login remains mandatory and unauthenticated API requests are rejected. Migrations `001` through `020` and the local authentication/application records were migrated on 2026-08-29. Runtime credentials are managed by the hosting secret store and are not committed to this repository.

## Run locally

Requirements: Node.js 22.13 or newer and Docker Desktop running.

From the project folder, use these commands each time you want the complete local application with login and database support:

```powershell
npx supabase start
npm run dev
```

Open the local URL printed by Vite. When Supabase is not configured, the product runs in clearly labeled demo mode with realistic mock data. When credentials are present, `/login` uses Supabase email/password authentication and product routes require a valid session.

Run `npm install` once after first downloading the project or whenever dependencies change.

## Cloudflare Quick Tunnel

Quick Tunnels expose the local application at a temporary public `trycloudflare.com` URL. They are intended for development and demonstrations, not production.

Install `cloudflared` once on Windows:

```powershell
winget install --id Cloudflare.cloudflared
```

With Docker Desktop running, use these commands from the project folder to start the database, production application, health checks, and public tunnel:

```powershell
npx supabase start
npm run tunnel
```

Keep this terminal open. The command prints a fresh `https://...trycloudflare.com` address after the UI, API, database, and authentication checks pass. Press `Ctrl+C` to close the tunnel.

For development with live reload:

```powershell
npx supabase start
npm run tunnel:dev
```

Development mode runs on `http://127.0.0.1:3001` by default and keeps Vite hot reload active. The tunnel launcher validates the CSS using browser-style request headers because Vite otherwise returns its JavaScript hot-reload wrapper for a direct PowerShell request to a CSS module.

The script prints application, API, and database readiness before printing the public URL. It only reports the tunnel as verified after the public login page, stylesheet, API, and—when configured—the same-origin Supabase authentication gateway all respond correctly. The UI, Worker APIs, and local Supabase gateway use the same tunneled origin, so another device never tries to connect to the laptop's loopback address directly.

Every Quick Tunnel URL is temporary. If the tunnel process, Worker, Docker, or laptop stops, discard the old URL and run `npm run tunnel` again to get a fresh verified address.

### Temporary owner auto-login for testing

When `.env.testing` contains `DEV_AUTO_LOGIN=true`, the tunnel launcher prints a separate **Protected owner testing link**. Open that private link to enter the local workspace directly as its OWNER without using the login form. The normal tunnel URL still requires authentication, and the generated testing link changes whenever the tunnel workflow restarts.

Treat the protected link like a password and do not publish it. The service credential and generated browser session remain server-side/runtime-only and are not embedded in the frontend bundle. To restore normal login enforcement, delete `.env.testing` or change its setting to:

```text
DEV_AUTO_LOGIN=false
```

Never enable this testing switch in staging or production.

To stop the local Supabase containers when you are finished:

```powershell
npx supabase stop
```

## Supabase

Copy `.env.example` to `.env.local`, then supply your public Supabase URL and anon key. Never expose the service-role or provider secrets through a `VITE_` variable.

Apply the SQL files in `supabase/migrations/` in filename order. Migration `001_core_schema.sql` creates the tenant data model and Row Level Security policies. Later migrations add atomic onboarding and project creation, role-aware policies, audited lifecycle changes, multi-market quota replacement, persistent supplier assignments, workspace settings, opaque redirect tokens, contact and outcome configuration, survey routing, duration metrics, tenant-visible member profiles, commercial workflow states, durable project-manager display history, respondent outcome tracking, test/live traffic separation, versioned eligibility rules, and atomic project/supplier/interlocked quota reservations. Always apply through the highest numbered migration (currently `026`) before live verification.

Add your local and deployed `/reset-password` URLs to the Supabase Auth redirect allowlist before testing password recovery.

For a local Supabase stack:

```powershell
npm install supabase --save-dev
npx supabase init
npx supabase start
```

## Worker endpoints

- `GET /api/health`
- `GET /api/readiness`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET/PUT /api/projects/:projectId/eligibility`
- `GET/PUT /api/projects/:projectId/quota-cells`
- `POST /api/projects`
- `GET /api/organizations/current`
- `POST /api/organizations`
- `GET/POST /api/clients`
- `PATCH /api/clients/:clientId`
- `GET/POST /api/suppliers`
- `PATCH /api/suppliers/:supplierId`
- `POST /api/events`
- `POST /api/callbacks/:provider`
- `GET /api/respondents`
- `GET/PATCH /api/fraud-flags/:flagId`
- `GET /api/analytics`
- `GET/PATCH /api/notifications/:notificationId`
- `GET/PUT /api/notification-rules`
- `GET /r/supplier/:token/test`
- `GET /r/supplier/:token/live?project=PRJ-...&respondent=...`
- `GET /r/client/:token/:outcome`

Without Supabase configuration, these endpoints return demo data. With `SUPABASE_URL` and `SUPABASE_ANON_KEY` configured, project endpoints require the browser's bearer token and read/write through tenant-scoped Supabase policies. No service-role key is used for normal project operations.

`GET /api/projects` supports `q`, `client`, `manager`, `status`, `type`, `from`, `to`, `page`, `pageSize`, `sortBy`, `sortDirection`, and `scope`. Project Center uses `scope=mine`; Overview uses organization-wide `scope=all`. Responses include total results, total pages, filter options, and portfolio status counts.

Client records are administered by OWNER/ADMIN roles and contain contact and outcome configuration. Supplier records contain contacts, STATIC/DYNAMIC redirect mode, outcome destinations, and opaque Test/Live links. Live links enforce project/supplier state, atomically reserve project/supplier and matching interlocked quota capacity, apply eligibility and fraud controls, record events, inject masked client callbacks, and return terminal outcomes to the supplier. Test links are counted separately and never reserve production quota.

The Respondents page supports project filtering and CSV export with respondent duration and supplier CPI. Analytics supports date-scoped CSV export across portfolio, supplier, client, and market sources.

## Structure

- `app/` — product routes and React UI
- `src/features/projects/` — project domain types and mock records
- `src/lib/` — API and Supabase clients
- `worker/` — Cloudflare Worker entry point and API routing
- `supabase/` — PostgreSQL migration and development seed
- `tests/` — server-render and API smoke tests

## Verify

```powershell
npm run build
npm test
npm run test:e2e
```

Complete product and technical behavior is documented in [docs/PRODUCT_AND_TECHNICAL_GUIDE.md](docs/PRODUCT_AND_TECHNICAL_GUIDE.md). The target user hierarchy and prioritized market-research gap analysis are in [docs/ROLE_HIERARCHY_AND_GAP_ANALYSIS.md](docs/ROLE_HIERARCHY_AND_GAP_ANALYSIS.md). Operational procedures are documented in [docs/OPERATIONS.md](docs/OPERATIONS.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
