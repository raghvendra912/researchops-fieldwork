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

const { uuidv7, readVisitorId, visitorCookie, defaultDecision, hostOf, buildRoutingHit } = await import("../worker/lib/routing-hits.ts");
const { handleRedirectApi } = await import("../worker/routes/redirects.ts");
const sql = await readFile(new URL("../supabase/migrations/054_routing_hits.sql", import.meta.url), "utf8");

test("uuidv7 is a valid, time-ordered v7 uuid", () => {
  const first = uuidv7(1_700_000_000_000);
  const later = uuidv7(1_700_000_001_000);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(first < later, "later timestamps must sort after earlier ones");
});

test("visitor cookie is read back and is HttpOnly for 24 hours", () => {
  const id = uuidv7();
  const cookie = visitorCookie(id);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=86400/);
  assert.equal(readVisitorId(new Request("https://r.example/", { headers: { cookie: `a=b; ${cookie.split(";")[0]}` } })), id);
  assert.equal(readVisitorId(new Request("https://r.example/", { headers: { cookie: "ro_vid=not-a-uuid" } })), undefined);
});

test("default decisions follow the response status", () => {
  assert.equal(defaultDecision(429, "SUPPLIER_ENTRY"), "RATE_LIMITED");
  assert.equal(defaultDecision(502, "SUPPLIER_ENTRY"), "ERROR");
  assert.equal(defaultDecision(302, "SUPPLIER_ENTRY"), "ROUTED");
  assert.equal(defaultDecision(404, "SUPPLIER_ENTRY"), "REJECTED");
  assert.equal(defaultDecision(200, "CLIENT_RETURN"), "ROUTED");
  assert.equal(hostOf("https://survey.example/path?x=1"), "survey.example");
});

test("hits store hashes and a target host, never raw IP or user agent", async () => {
  const request = new Request("https://r.example/r/supplier/x/live", { headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "UA/1", "cf-ipcountry": "in" } });
  const row = await buildRoutingHit({ request, env: { FRAUD_HASH_SECRET: "s" }, trace: { targetHost: "survey.example" }, hop: "SUPPLIER_ENTRY", routeKind: "supplier", status: 302, clickId: uuidv7(), visitorId: uuidv7(), latencyMs: 12.4 });
  assert.equal(row.country_code, "IN");
  assert.equal(row.latency_ms, 12);
  assert.match(row.ip_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(row).includes("203.0.113.9"));
});

async function runEntry({ supplierStatus, rateLimitKey }) {
  const rows = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/routing_hits")) { rows.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    if (url.pathname.endsWith("/suppliers")) return Response.json([{ id: "supplier-1", organization_id: "org-1", status: supplierStatus, redirect_mode: "STATIC", complete_url: null, terminate_url: null, quota_full_url: null, security_terminate_url: null }]);
    throw new Error(`Unexpected route: ${url.pathname}`);
  };
  const pending = [];
  try {
    const path = `/r/supplier/${rateLimitKey}/live`;
    const response = await handleRedirectApi(
      new Request(`https://r.example${path}?project=ROP-1&respondent=A1`),
      path,
      { SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "key" },
      { waitUntil: (promise) => pending.push(promise) },
    );
    await Promise.all(pending);
    return { response, rows };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("a rejected click (inactive supplier) is logged and receives a visitor cookie", async () => {
  const { response, rows } = await runEntry({ supplierStatus: "PAUSED", rateLimitKey: "00000000-0000-4000-8000-00000000000a" });
  assert.equal(response.status, 404);
  assert.match(response.headers.get("set-cookie") ?? "", /ro_vid=/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, "INACTIVE");
  assert.equal(rows[0].hop, "SUPPLIER_ENTRY");
  assert.equal(rows[0].http_status, 404);
  assert.equal(rows[0].supplier_id, "supplier-1");
  assert.match(rows[0].visitor_id, /^[0-9a-f-]{36}$/);
});

test("migration 054 partitions by month, keeps 90 days, and is re-runnable", () => {
  assert.match(sql, /partition by range \(created_at\)/i);
  assert.match(sql, /maintain_routing_hits\(p_retention_days integer default 90\)/i);
  assert.match(sql, /revoke all on function public\.maintain_routing_hits\(integer\) from public/i);
  assert.match(sql, /grant execute on function public\.maintain_routing_hits\(integer\) to service_role/i);
  assert.doesNotMatch(sql.replace(/execute format([^;]*);/g, ""), /create table (?!if not exists)/i);
  assert.ok(sql.includes("to_regclass('public.' || partition_name) is null"));
  assert.doesNotMatch(sql, /create (unique )?index (?!if not exists)/i);
  assert.match(sql, /drop policy if exists "operators read routing hits"/i);
  for (const decision of ["hop in ('SUPPLIER_ENTRY', 'CLIENT_REDIRECT', 'CLIENT_RETURN', 'SUPPLIER_EXIT')"]) assert.ok(sql.includes(decision));
});
