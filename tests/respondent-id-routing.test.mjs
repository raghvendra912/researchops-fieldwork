import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Resolve extensionless Worker imports when running source TypeScript in Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { handleRedirectApi } = await import("../worker/routes/redirects.ts");

const token = "00000000-0000-4000-8000-000000000001";
const clientToken = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const outcomeToken = "00000000-0000-4000-8000-000000000004";
const supplierRef = "SUP-ATTEMPT-17";
const supplier = { id: "supplier-1", organization_id: "org-1", status: "ACTIVE", redirect_mode: "STATIC", complete_url: "https://supplier.example/complete?uid={{respondent_id}}", terminate_url: null, quota_full_url: null, security_terminate_url: null };
const session = { respondent_ref: supplierRef, is_test: false, status: "REACHED_CLIENT", projects: { project_code: "ROP-42", client_id: "client-1" }, project_suppliers: { suppliers: supplier } };
const env = { SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "local-test-key" };

test("supplier launch sends our attempt ID to the client and returns the supplier ID", async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const lookups = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const path = url.pathname;
    lookups.push(`${path}${url.search}`);
    if (path.endsWith("/rpc/supplier_scoped_ref_ready")) return Response.json({ code: "PGRST202" }, { status: 404 });
    if (path.endsWith("/rpc/ingest_survey_event")) {
      const body = JSON.parse(init.body);
      events.push(body);
      return Response.json([{ session_id: attemptId, event_id: crypto.randomUUID(), created: true }]);
    }
    if (path.endsWith("/rpc/reserve_project_quota")) return Response.json([{ allowed: true, reservation_id: "reservation-1" }]);
    if (path.endsWith("/suppliers")) return Response.json([supplier]);
    if (path.endsWith("/project_suppliers")) return Response.json([{ id: "assignment-1", supplier_id: supplier.id, status: "ACTIVE", projects: { id: "project-1", project_code: "ROP-42", status: "LIVE", survey_url: "https://survey.example/start", test_survey_url: null, survey_parameters: [{ name: "RID", value: "{{respondent_id}}" }], clients: { redirect_token: clientToken }, project_markets: [{ country_code: "IN", language_code: "en" }] } }]);
    if (path.endsWith("/project_eligibility_rules") || path.endsWith("/project_quota_cells") || path.endsWith("/fraud_flags")) return Response.json([]);
    if (path.endsWith("/clients")) return Response.json([{ id: "client-1" }]);
    if (path.endsWith("/survey_sessions")) {
      if (url.searchParams.get("select") === "project_supplier_id") return Response.json([]);
      if (url.searchParams.has("outcome_token")) return Response.json([{ ...session, projects: { project_code: "ROP-42" } }]);
      if (url.searchParams.get("select") === "outcome_token") return Response.json([{ outcome_token: outcomeToken }]);
      if (url.searchParams.get("id") === `eq.${attemptId}`) return Response.json([session]);
      if (url.searchParams.get("respondent_ref") === `eq.${supplierRef}`) return Response.json([session]);
      return Response.json([{ outcome_token: outcomeToken }]);
    }
    throw new Error(`Unexpected mocked route: ${path}`);
  };
  try {
    const launchPath = `/r/supplier/${token}/live`;
    const launch = await handleRedirectApi(new Request(`https://router.example${launchPath}?project=ROP-42&respondent=${supplierRef}`), launchPath, env);
    assert.equal(launch?.status, 302, `${await launch?.text()}\n${lookups.join("\n")}`);
    const survey = new URL(launch.headers.get("location"));
    assert.equal(survey.searchParams.get("RID"), attemptId);
    assert.equal(survey.searchParams.get("rid"), attemptId);
    assert.equal(survey.searchParams.has("uid"), false);
    assert.equal(events[0].p_respondent_ref, supplierRef);

    const returnPath = `/r/client/${clientToken}/complete`;
    const outcome = await handleRedirectApi(new Request(`https://router.example${returnPath}?rid=${attemptId}&project=ROP-42`), returnPath, env);
    assert.equal(outcome?.status, 302);
    const supplierReturn = new URL(outcome.headers.get("location"));
    assert.equal(supplierReturn.searchParams.get("uid"), supplierRef);
    assert.equal(supplierReturn.searchParams.get("respondent_id"), supplierRef);
    assert.equal(events.at(-1).p_respondent_ref, supplierRef);
    assert.ok(lookups.some((query) => query.includes(`id=eq.${attemptId}`)));

    const legacy = await handleRedirectApi(new Request(`https://router.example${returnPath}?rid=${supplierRef}&project=ROP-42`), returnPath, env);
    assert.equal(legacy?.status, 302);
    assert.ok(lookups.some((query) => query.includes(`respondent_ref=eq.${supplierRef}`)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a duplicate supplier reference from another assignment cannot hijack an existing attempt", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/rpc/supplier_scoped_ref_ready")) return Response.json({ code: "PGRST202" }, { status: 404 });
    if (url.pathname.endsWith("/suppliers")) return Response.json([supplier]);
    if (url.pathname.endsWith("/project_suppliers")) return Response.json([{ id: "assignment-1", status: "ACTIVE", projects: { id: "project-1", project_code: "ROP-42", status: "LIVE" } }]);
    if (url.pathname.endsWith("/survey_sessions")) return Response.json([{ project_supplier_id: "different-assignment" }]);
    throw new Error(`Unexpected route ${url.pathname}`);
  };
  try {
    const path = `/r/supplier/${token}/live`;
    const response = await handleRedirectApi(new Request(`https://router.example${path}?project=ROP-42&respondent=${supplierRef}`), path, env);
    assert.equal(response?.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("supplier-scoped routing permits the same external reference from two suppliers", async () => {
  const originalFetch = globalThis.fetch;
  const secondToken = "00000000-0000-4000-8000-000000000005";
  const secondAttempt = "00000000-0000-4000-8000-000000000006";
  const attempts = [attemptId, secondAttempt];
  let current = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/rpc/supplier_scoped_ref_ready")) return Response.json(true);
    if (url.pathname.endsWith("/suppliers")) return Response.json([{ ...supplier, id: url.searchParams.get("redirect_token")?.includes(secondToken) ? "supplier-2" : "supplier-1" }]);
    if (url.pathname.endsWith("/project_suppliers")) return Response.json([{ id: `assignment-${current + 1}`, status: "ACTIVE", projects: { id: "project-1", project_code: "ROP-42", status: "LIVE", survey_url: "https://survey.example/start", survey_parameters: [{ name: "RID", value: "{{respondent_id}}" }], project_markets: [] } }]);
    if (url.pathname.endsWith("/project_eligibility_rules") || url.pathname.endsWith("/project_quota_cells") || url.pathname.endsWith("/fraud_flags")) return Response.json([]);
    if (url.pathname.endsWith("/rpc/reserve_project_quota")) return Response.json([{ allowed: true, reservation_id: `reservation-${current + 1}` }]);
    if (url.pathname.endsWith("/rpc/ingest_survey_event")) return Response.json([{ session_id: attempts[current], event_id: crypto.randomUUID(), created: true }]);
    if (url.pathname.endsWith("/survey_sessions")) return Response.json([{ outcome_token: outcomeToken }]);
    throw new Error(`Unexpected route ${url.pathname}`);
  };
  try {
    for (const routeToken of [token, secondToken]) {
      const path = `/r/supplier/${routeToken}/live`;
      const response = await handleRedirectApi(new Request(`https://router.example${path}?project=ROP-42&respondent=${supplierRef}`), path, env);
      assert.equal(response?.status, 302);
      assert.equal(new URL(response.headers.get("location")).searchParams.get("RID"), attempts[current]);
      current += 1;
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy client returns reject an external ID matching multiple attempts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/clients")) return Response.json([{ id: "client-1" }]);
    if (url.pathname.endsWith("/survey_sessions")) return Response.json([session, { ...session, project_suppliers: { suppliers: { ...supplier, id: "supplier-2" } } }]);
    throw new Error(`Unexpected route ${url.pathname}`);
  };
  try {
    const path = `/r/client/${clientToken}/complete`;
    const response = await handleRedirectApi(new Request(`https://router.example${path}?rid=${supplierRef}&project=ROP-42`), path, env);
    assert.equal(response?.status, 409);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
