import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { handleRedirectApi } = await import("../worker/routes/redirects.ts");
const { parseAsnList, hostingAsnSet, networkRiskContext } = await import("../worker/domain/network-risk.ts");
const migration = await readFile(new URL("../supabase/migrations/058_network_risk_flag.sql", import.meta.url), "utf8");
const redirectsSource = await readFile(new URL("../worker/routes/redirects.ts", import.meta.url), "utf8");

const token = "00000000-0000-4000-8000-000000000001";
const clientToken = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const outcomeToken = "00000000-0000-4000-8000-000000000004";
const supplier = { id: "supplier-1", organization_id: "org-1", status: "ACTIVE", redirect_mode: "STATIC", complete_url: "https://supplier.example/complete?uid={{respondent_id}}&secret=abc", terminate_url: "https://supplier.example/term", quota_full_url: null, security_terminate_url: null };
const baseEnv = { SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "key", FRAUD_HASH_SECRET: "hash-secret" };

function withAsn(url, asn) {
  const request = new Request(url);
  if (asn !== undefined) Object.defineProperty(request, "cf", { value: { asn, country: "IN" } });
  return request;
}

function mockDatabase({ projectStatus = "LIVE" } = {}) {
  const state = { hits: [], events: [], paths: [] };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const path = url.pathname;
    state.paths.push(path);
    if (path.endsWith("/routing_hits")) { state.hits.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    if (path.endsWith("/rpc/ingest_survey_event")) { state.events.push(JSON.parse(init.body)); return Response.json([{ session_id: attemptId, event_id: crypto.randomUUID(), created: true }]); }
    if (path.endsWith("/rpc/reserve_project_quota")) return Response.json([{ allowed: true, reservation_id: "reservation-1" }]);
    if (path.endsWith("/rpc/capture_session_network_context")) return Response.json(null);
    if (path.endsWith("/suppliers")) return Response.json([supplier]);
    if (path.endsWith("/project_suppliers")) return Response.json([{ id: "assignment-1", supplier_id: supplier.id, status: "ACTIVE", projects: { id: "project-1", project_code: "ROP-42", status: projectStatus, survey_url: "https://survey.example/start?token=private", test_survey_url: null, survey_parameters: [], clients: { redirect_token: clientToken }, project_markets: [] } }]);
    if (path.endsWith("/project_eligibility_rules") || path.endsWith("/project_quota_cells") || path.endsWith("/fraud_flags")) return Response.json([]);
    if (path.endsWith("/clients")) return Response.json([{ id: "client-1" }]);
    if (path.endsWith("/marketplaces")) return Response.json([]);
    if (path.endsWith("/survey_sessions")) {
      if (url.searchParams.get("select") === "outcome_token") return Response.json([{ outcome_token: outcomeToken }]);
      return Response.json([{ id: attemptId, respondent_ref: "R1", is_test: false, status: "REACHED_CLIENT", projects: { project_code: "ROP-42", client_id: "client-1" }, project_suppliers: { suppliers: supplier } }]);
    }
    throw new Error(`Unexpected route: ${path}`);
  };
  return state;
}

async function run(request, pathname, env = baseEnv) {
  const pending = [];
  const response = await handleRedirectApi(request, pathname, env, { waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);
  return response;
}

const originalFetch = globalThis.fetch;
const entryPath = `/r/supplier/${token}/live`;

test("live entry logs SUPPLIER_ENTRY and CLIENT_REDIRECT with the client host only, and no readiness call", async () => {
  const state = mockDatabase();
  try {
    const response = await run(withAsn(`https://router.example${entryPath}?project=ROP-42&respondent=R1`, 64496), entryPath);
    assert.equal(response.status, 302);
    const hops = state.hits.map((row) => row.hop);
    assert.deepEqual(hops, ["SUPPLIER_ENTRY", "CLIENT_REDIRECT"]);
    const redirectRow = state.hits.find((row) => row.hop === "CLIENT_REDIRECT");
    assert.equal(redirectRow.target_host, "survey.example");
    assert.equal(redirectRow.decision, "ROUTED");
    assert.equal(redirectRow.session_id, attemptId);
    assert.equal(redirectRow.asn, "64496");
    for (const row of state.hits) {
      const serialised = JSON.stringify(row);
      assert.ok(!serialised.includes("token=private") && !serialised.includes("https://"), "no full URL in any logged row");
    }
    assert.equal(state.paths.some((path) => path.endsWith("/rpc/supplier_scoped_ref_ready")), false);
    assert.equal(state.events[0].p_metadata.networkRisk, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("supplier terminate at entry logs SUPPLIER_EXIT with host only", async () => {
  const state = mockDatabase({ projectStatus: "PAUSED" });
  try {
    const response = await run(withAsn(`https://router.example${entryPath}?project=ROP-42&respondent=R1`), entryPath);
    assert.equal(response.status, 302);
    const exit = state.hits.find((row) => row.hop === "SUPPLIER_EXIT");
    assert.ok(exit, "SUPPLIER_EXIT row present");
    assert.equal(exit.target_host, "supplier.example");
    assert.equal(exit.decision, "PAUSED_EXIT");
    assert.ok(!JSON.stringify(state.hits).includes("https://"));
    assert.equal(state.hits.some((row) => row.hop === "CLIENT_REDIRECT"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("client outcome page with a supplier destination logs SUPPLIER_EXIT HANDOFF_OFFERED", async () => {
  const state = mockDatabase();
  try {
    const path = `/r/client/${clientToken}/complete`;
    const response = await run(new Request(`https://router.example${path}?rid=${attemptId}&project=ROP-42`), path);
    assert.equal(response.status, 200);
    assert.deepEqual(state.hits.map((row) => row.hop), ["CLIENT_RETURN", "SUPPLIER_EXIT"]);
    const exit = state.hits[1];
    assert.equal(exit.decision, "HANDOFF_OFFERED");
    assert.equal(exit.target_host, "supplier.example");
    assert.equal(exit.session_id, attemptId);
    assert.ok(!JSON.stringify(state.hits).includes("secret=abc"));
    assert.ok(!JSON.stringify(state.hits).includes("https://"));
  } finally { globalThis.fetch = originalFetch; }
});

test("a logging failure never affects the respondent redirect", async () => {
  const state = mockDatabase();
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (new URL(input).pathname.endsWith("/routing_hits")) throw new Error("hit log down");
    return inner(input, init);
  };
  try {
    const response = await run(withAsn(`https://router.example${entryPath}?project=ROP-42&respondent=R1`), entryPath);
    assert.equal(response.status, 302);
    assert.equal(state.hits.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("hosting ASN tags the START event metadata but never blocks", async () => {
  for (const asn of [16509, 15169]) {
    const state = mockDatabase();
    try {
      const response = await run(withAsn(`https://router.example${entryPath}?project=ROP-42&respondent=R1`, asn), entryPath);
      assert.equal(response.status, 302, "hosting traffic is still routed");
      const start = state.events.find((body) => body.p_event_type === "START");
      assert.equal(start.p_metadata.networkRisk, "HOSTING_ASN");
      assert.equal(start.p_metadata.asn, String(asn));
      assert.equal(state.hits.find((row) => row.hop === "SUPPLIER_ENTRY").decision, "ROUTED");
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("ordinary ASN, missing ASN and test-mode traffic carry no networkRisk", async () => {
  for (const [asn, mode] of [[64496, ""], [undefined, ""], [16509, "&mode=test"]]) {
    const state = mockDatabase();
    try {
      const response = await run(withAsn(`https://router.example${entryPath}?project=ROP-42&respondent=R1${mode}`, asn), entryPath);
      assert.equal(response.status, 302);
      const start = state.events.find((body) => body.p_event_type === "START");
      assert.equal(start.p_metadata.networkRisk, undefined);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test("NETWORK_RISK_ASNS extends the built-in list", async () => {
  assert.deepEqual(parseAsnList("AS64500, 64501,bad,, -5"), [64500, 64501]);
  assert.equal(hostingAsnSet().has(16509), true);
  assert.equal(hostingAsnSet().has(64500), false);
  assert.equal(hostingAsnSet("64500").has(64500), true);
  const request = withAsn("https://router.example/x", 64500);
  assert.deepEqual(networkRiskContext(request, {}, false), {});
  assert.equal(networkRiskContext(request, { NETWORK_RISK_ASNS: "64500" }, false).networkRisk, "HOSTING_ASN");
  assert.deepEqual(networkRiskContext(request, { NETWORK_RISK_ASNS: "64500" }, true), {});
});

test("the per-click supplier_scoped_ref_ready database call is gone", () => {
  assert.equal(redirectsSource.includes("supplier_scoped_ref_ready"), false);
  assert.equal(redirectsSource.includes("supplierScopedRefReady"), false);
});

test("migration 058 is advisory: new rule on START, no metric view or quota changes, re-runnable", () => {
  assert.match(migration, /drop constraint if exists fraud_flags_rule_code_check/i);
  assert.match(migration, /'NO_CLIENT_REACH','HOSTING_ASN'/);
  assert.match(migration, /create or replace function public\.evaluate_survey_event_risk/i);
  for (const rule of ["DUPLICATE_IP", "DUPLICATE_DEVICE", "SPEEDING", "QUALITY_VIOLATION", "UNVERIFIED_RETURN", "NO_CLIENT_REACH"]) assert.ok(migration.includes(`'${rule}'`), rule);
  assert.match(migration, /event_type = 'START'[^;]*networkRisk[^;]*'HOSTING_ASN','MEDIUM'/);
  assert.doesNotMatch(migration.split(/\r?\n/).filter((line) => !line.startsWith("--")).join("\n"), /create (or replace )?view|apply_quota_reservation_outcome/i);
});
