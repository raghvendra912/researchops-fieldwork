import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { registerHooks } from "node:module";

// Resolve extensionless Worker imports when running source TypeScript in Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { handleRedirectApi } = await import("../worker/routes/redirects.ts");

const supplierToken = "00000000-0000-4000-8000-000000000001";
const clientToken = "00000000-0000-4000-8000-000000000002";
const attemptId = "00000000-0000-4000-8000-000000000003";
const outcomeToken = "00000000-0000-4000-8000-000000000004";
const supplier = { id: "supplier-1", organization_id: "org-1", status: "ACTIVE", redirect_mode: "STATIC", complete_url: null, terminate_url: null, quota_full_url: null, security_terminate_url: null };
const signingConfig = { secretEnv: "MARKETPLACE_TEST_SECRET", entrySigning: { enabled: true, param: "hash", algorithm: "SHA-256" } };

// Each test uses its own client id: the marketplace lookup is cached per client.
function liveFixture({ clientId, marketplaces }) {
  const original = globalThis.fetch; const lookups = [];
  globalThis.fetch = async (input) => {
    const url = new URL(input); const path = url.pathname; lookups.push(path);
    if (path.endsWith("/rpc/supplier_scoped_ref_ready")) return Response.json(true);
    if (path.endsWith("/rpc/ingest_survey_event")) return Response.json([{ session_id: attemptId, event_id: crypto.randomUUID(), created: true }]);
    if (path.endsWith("/rpc/reserve_project_quota")) return Response.json([{ allowed: true, reservation_id: "reservation-1" }]);
    if (path.endsWith("/marketplaces")) return marketplaces(url);
    if (path.endsWith("/suppliers")) return Response.json([supplier]);
    if (path.endsWith("/project_suppliers")) return Response.json([{ id: "assignment-1", supplier_id: supplier.id, status: "ACTIVE", projects: { id: "project-1", client_id: clientId, project_code: "ROP-77", status: "LIVE", survey_url: "https://panel.example.com/s?id=1&uid={{respondent_id}}", test_survey_url: null, survey_parameters: [], clients: { redirect_token: clientToken }, project_markets: [{ country_code: "IN", language_code: "en" }] } }]);
    if (path.endsWith("/project_eligibility_rules") || path.endsWith("/project_quota_cells") || path.endsWith("/fraud_flags")) return Response.json([]);
    if (path.endsWith("/survey_sessions")) return Response.json([{ outcome_token: outcomeToken }]);
    throw new Error(`Unexpected mocked route: ${path}`);
  };
  return { lookups, restore: () => { globalThis.fetch = original; } };
}
const launch = (env) => {
  const path = `/r/supplier/${supplierToken}/live`;
  return handleRedirectApi(new Request(`https://router.example${path}?project=ROP-77&respondent=SUP-9`), path, env);
};
const baseEnv = { SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

test("a marketplace project is redirected to a signed survey link", async () => {
  const fixture = liveFixture({ clientId: "client-signed", marketplaces: (url) => {
    assert.match(url.search, /client_id=eq\.client-signed/, "the lookup is keyed on the project's client");
    return Response.json([{ provider: "GENERIC", config: signingConfig }]);
  } });
  try {
    const response = await launch({ ...baseEnv, MARKETPLACE_TEST_SECRET: "entry-secret" });
    assert.equal(response?.status, 302, await response?.clone().text());
    const location = new URL(response.headers.get("location"));
    const supplied = location.searchParams.get("hash");
    assert.match(supplied, /^[0-9a-f]{64}$/);
    location.searchParams.delete("hash");
    assert.equal(supplied, createHmac("sha256", "entry-secret").update(location.toString()).digest("hex"), "hash covers the full URL, including our session id");
    assert.equal(location.searchParams.get("rid"), attemptId);
  } finally { fixture.restore(); }
});

test("a marketplace with signing enabled but no secret fails closed instead of sending an unsigned link", async () => {
  const fixture = liveFixture({ clientId: "client-nosecret", marketplaces: () => Response.json([{ provider: "GENERIC", config: signingConfig }]) });
  try {
    const response = await launch(baseEnv);
    assert.equal(response?.status, 502);
    assert.equal(response.headers.get("location"), null);
    assert.match(await response.text(), /marketplace entry link/i);
  } finally { fixture.restore(); }
});

test("projects whose client is not a marketplace are routed exactly as before", async () => {
  const fixture = liveFixture({ clientId: "client-plain", marketplaces: () => Response.json([]) });
  try {
    const response = await launch(baseEnv);
    assert.equal(response?.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.has("hash"), false);
    await launch(baseEnv);
    assert.equal(fixture.lookups.filter((path) => path.endsWith("/marketplaces")).length, 1, "the lookup is cached between launches");
  } finally { fixture.restore(); }
});

test("routing keeps working when migration 053 has not been applied yet", async () => {
  const fixture = liveFixture({ clientId: "client-premigration", marketplaces: () => Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 }) });
  try {
    const response = await launch(baseEnv);
    assert.equal(response?.status, 302, "a missing marketplaces table must never block routing");
    assert.equal(new URL(response.headers.get("location")).searchParams.has("hash"), false);
  } finally { fixture.restore(); }
});

test("a marketplace that is paused or not signing leaves the link untouched", async () => {
  const fixture = liveFixture({ clientId: "client-nosign", marketplaces: () => Response.json([{ provider: "CINT", config: { secretEnv: "MARKETPLACE_TEST_SECRET" } }]) });
  try {
    const response = await launch({ ...baseEnv, MARKETPLACE_TEST_SECRET: "entry-secret" });
    assert.equal(response?.status, 302);
    assert.equal(new URL(response.headers.get("location")).searchParams.has("hash"), false);
  } finally { fixture.restore(); }
});
