# Hosted verification report - 2026-09-16

Production target: `https://www.asrv.co.in` (Vercel auto-deploy from GitHub `main`).
All checks ran through public APIs and the same-origin gateway; no service-role key was stored or committed.

## Proven today (PASS)

| Check | Proof |
|---|---|
| Worker health / readiness | `/api/health` -> `healthy`; `/api/readiness` -> `database configured, supabase-ready` |
| Vercel auto-deploy | Push of `bc73e3f` became a Production deployment within ~1 minute; `?diagnose=1` checklist + `fix:` hints live on routing error pages |
| Tool-only routing | `worker/domain/routing-links.ts` templates live; every routing error page now returns the 8-step new-project checklist with `?diagnose=1` JSON |
| End-to-end two-ID routing (`ROP-1141`) | Fresh signup -> client + DYNAMIC supplier + project -> assignment ACTIVE -> LIVE. Supplier live hit: 302 to survey with fresh session UUID in `RID` plus 4 per-session outcome URLs. Client complete return: 302 to supplier complete URL with original ref `QA-SUP-REF-1` restored in `rid`/`respondent_id`/`transaction_id`. Session row: `COMPLETE`, duration 3s. Outcome replay: idempotent (no duplicate event). |
| Migration `039` activation | Capability RPC `supplier_scoped_ref_ready` returned `200 true` on hosted Supabase |
| Equal-reference isolation (`ROP-1143`) | Two suppliers posted the same external ref `SAME-REF-777` on one project; each received a distinct ResearchOps session UUID with correct supplier-scoped return routing |
| Authenticated Project Center API | Signed-in `/api/projects` returned `200` with project data |
| Public frontend serving | `/login`, `/projects`, `/dashboard`, `/clients`, `/suppliers` + CSS bundle all `200` |

## Automated checks

- `tests/routing-links.test.mjs` 3/3 pass (includes CSV routing columns)
- `tests/respondent-id-routing.test.mjs` 4/4 pass
- `npm run lint` clean; `node --check scripts/qa-routing-flow.mjs` clean
- Pre-existing 2 failures in `tests/rendered-html.test.mjs` (directory pages) date back before this work; tracked separately

## How to re-run

```bash
node scripts/qa-routing-flow.mjs   # full E2E: signup -> org -> client -> supplier -> project -> LIVE -> routing -> client-back -> replay -> equal-ref
node scripts/check-route.mjs "<routing-url>"   # diagnose any routing link without a browser
```

## The 4 routing gates for any new project (UI checklist)

1. Supplier directory: supplier **ACTIVE** with all 4 return URLs set
2. Project details -> Supplier delivery: assignment **ACTIVE** + Save
3. Project details -> Survey routing setup: live survey URL (https)
4. Project: **Launch -> LIVE**

If any gate is missing, the routing error page itself names the missing step (or `?diagnose=1` for JSON).

## Remaining work (next sessions)

1. `039` leftover live checks: concurrent-quota reservation, terminal-outcome distribution, assignment-history protection
2. `038` proofs: ownership constraints, audit records, role permissions, tenant isolation
3. Response capture, retention, review; workbook + multi-role browser verification
4. External gates (need owner decisions/credentials): CPX/BitLabs/PureSpectrum sandbox contracts, email + error-tracking provider selection, financial/FX/tax rules, Research Defender contract
