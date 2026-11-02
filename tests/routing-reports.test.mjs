import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { handleRoutingReportsApi, ratio, funnelRatios, resolveRange, mapFunnelRow, buildTimeline, MAX_RANGE_DAYS } = await import("../worker/routes/routing-reports.ts");
const sql = await readFile(new URL("../supabase/migrations/057_routing_reports.sql", import.meta.url), "utf8");

const env = { SUPABASE_URL: "https://db.example", SUPABASE_ANON_KEY: "anon" };
const SESSION = "0b8f6f0e-6a53-4c2c-9d0e-3d8d2f6b1a11";
const DAY = 86_400_000;

function mockSupabase(role, handlers = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const path = url.pathname + url.search;
    calls.push({ path, init });
    if (url.pathname.endsWith("/organization_members")) return Response.json(role ? [{ organization_id: "org-1", role }] : []);
    for (const [match, respond] of Object.entries(handlers)) if (path.includes(match)) return respond(url, init);
    throw new Error(`Unexpected ${path}`);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const get = (path, headers = { authorization: "Bearer a.b.c" }) => handleRoutingReportsApi(new Request(`https://x.example${path}`, { headers }), new URL(`https://x.example${path}`).pathname, env);

test("ratio returns 0 for zero, negative or non-finite denominators", () => {
  assert.equal(ratio(5, 0), 0);
  assert.equal(ratio(0, 0), 0);
  assert.equal(ratio(5, -1), 0);
  assert.equal(ratio(Number.NaN, 4), 0);
  assert.equal(ratio(1, 3), 0.3333);
  assert.deepEqual(funnelRatios({ clicks: 0, starts: 0, reachedClient: 0, completes: 0, rejected: 0 }), { clickToStart: 0, startToReached: 0, reachedToComplete: 0, rejectionRate: 0 });
});

test("funnel math derives routed, rejected and step ratios", () => {
  const row = mapFunnelRow({ supplier_id: "s1", supplier_name: "CPX", clicks: 100, decisions: { ROUTED: 80, DUPLICATE: 15, RATE_LIMITED: 5 }, starts: 60, reached: 30, completes: 15, terminates: 10, quota_full: 3, quality_terminates: 2 });
  assert.equal(row.routed, 80);
  assert.equal(row.rejected, 20);
  assert.deepEqual(row.rejections, { DUPLICATE: 15, RATE_LIMITED: 5 });
  assert.deepEqual(row.ratios, { clickToStart: 0.6, startToReached: 0.5, reachedToComplete: 0.5, rejectionRate: 0.2 });
  const empty = mapFunnelRow({ supplier_id: null, clicks: 0, decisions: {}, starts: 4 });
  assert.equal(empty.supplierName, "Unknown supplier");
  assert.equal(empty.ratios.clickToStart, 0);
});

test("date range defaults to 30 days, clamps to 92 days and rejects invalid input", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const fallback = resolveRange(null, null, now);
  assert.equal(Date.parse(fallback.to) - Date.parse(fallback.from), 30 * DAY);
  const wide = resolveRange("2020-01-01", "2026-09-30", now);
  assert.equal(Date.parse(wide.to) - Date.parse(wide.from), MAX_RANGE_DAYS * DAY);
  assert.equal(wide.clamped, true);
  assert.equal(wide.to, "2026-10-01T00:00:00.000Z"); // date-only `to` includes the whole day
  assert.equal(resolveRange("not-a-date", null, now), null);
  const inverted = resolveRange("2026-09-30", "2026-09-01", now);
  assert.equal(Date.parse(inverted.to) - Date.parse(inverted.from), 30 * DAY);
  const future = resolveRange(null, "2030-01-01", now);
  assert.ok(Date.parse(future.to) <= now + DAY);
});

test("funnel returns realistic mock data without Supabase", async () => {
  const response = await handleRoutingReportsApi(new Request("https://x.example/api/routing/funnel"), "/api/routing/funnel", {});
  const body = await response.json();
  assert.equal(body.meta.source, "mock");
  assert.ok(body.data.length >= 2 && body.data[0].clicks > body.data[0].starts);
});

test("funnel requires a session, and only operators may read it", async () => {
  let mock = mockSupabase("PM", {});
  try {
    const anonymous = await get("/api/routing/funnel", {});
    assert.equal(anonymous.status, 401);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); }
  for (const role of ["ANALYST", "MEMBER"]) {
    mock = mockSupabase(role, {});
    try {
      assert.equal((await get("/api/routing/funnel")).status, 403, role);
      assert.ok(!mock.calls.some((call) => call.path.includes("supplier_funnel_report")));
    } finally { mock.restore(); }
  }
});

test("funnel calls the RPC with the user's token, clamped dates and pagination", async () => {
  const rows = ["a", "b", "c"].map((name, index) => ({ supplier_id: `00000000-0000-4000-8000-00000000000${index}`, supplier_name: name, clicks: 10 - index, decisions: { ROUTED: 5 }, starts: 4, reached: 2, completes: 1, terminates: 1, quota_full: 0, quality_terminates: 0 }));
  const mock = mockSupabase("OWNER", { "/rpc/supplier_funnel_report": () => Response.json(rows) });
  try {
    const response = await get("/api/routing/funnel?from=2020-01-01&to=2026-09-30&limit=2&offset=1&supplierId=00000000-0000-4000-8000-000000000001");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 2);
    assert.deepEqual(body.data.map((row) => row.supplierName), ["b", "c"]);
    assert.equal(body.meta.total, 3);
    assert.equal(body.meta.clamped, true);
    const call = mock.calls.find((item) => item.path.includes("supplier_funnel_report"));
    const sent = JSON.parse(call.init.body);
    assert.equal(sent.p_organization_id, "org-1");
    assert.equal(sent.p_supplier_id, "00000000-0000-4000-8000-000000000001");
    assert.equal(Date.parse(sent.p_to) - Date.parse(sent.p_from), MAX_RANGE_DAYS * DAY);
    assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer a.b.c");
    assert.equal(new Headers(call.init.headers).get("apikey"), "anon", "anon key, never the service role");
    assert.equal((await get("/api/routing/funnel?from=bogus")).status, 400);
    assert.equal((await get("/api/routing/funnel?projectId=nope")).status, 400);
  } finally { mock.restore(); }
});

test("funnel resolves a project code under RLS and returns an empty report when it is not visible", async () => {
  const mock = mockSupabase("PM", { "/rest/v1/projects": () => Response.json([]) });
  try {
    const response = await get("/api/routing/funnel?projectCode=prj-1048");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, []);
    assert.ok(!mock.calls.some((call) => call.path.includes("supplier_funnel_report")));
  } finally { mock.restore(); }
});

test("timeline is ordered across sources and never exposes hashes, IPs or URLs", () => {
  const timeline = buildTimeline(
    [
      { hop: "SUPPLIER_ENTRY", decision: "ROUTED", http_status: 302, target_host: "survey.example", country_code: "IN", latency_ms: 12, created_at: "2026-08-18T08:14:58Z", ip_hash: "deadbeef", user_agent_hash: "cafebabe", visitor_id: "v", target_url: "https://survey.example/?x=secret" },
      { hop: "CLIENT_RETURN", decision: "ROUTED", http_status: 302, created_at: "2026-08-18T08:27:00Z", ip_hash: "deadbeef" },
    ],
    [{ event_type: "COMPLETE", occurred_at: "2026-08-18T08:27:00Z" }, { event_type: "START", occurred_at: "2026-08-18T08:15:00Z" }],
    [{ rule_code: "SPEEDING", severity: "MEDIUM", status: "OPEN", created_at: "2026-08-18T08:27:30Z" }],
  );
  assert.deepEqual(timeline.map((item) => `${item.source}:${item.status}`), ["ROUTER:ROUTED", "EVENT:START", "ROUTER:ROUTED", "EVENT:COMPLETE", "FLAG:MEDIUM/OPEN"]);
  assert.equal(timeline[0].targetHost, "survey.example");
  assert.equal(timeline[0].latencyMs, 12);
  const serialized = JSON.stringify(timeline);
  for (const secret of ["deadbeef", "cafebabe", "ip_hash", "https://", "secret", "visitor"]) assert.ok(!serialized.includes(secret), secret);
});

test("timeline requires a session, is read-scoped by RLS and 404s on invisible sessions", async () => {
  let mock = mockSupabase("ANALYST", { "/survey_sessions": () => Response.json([]) });
  try {
    assert.equal((await get(`/api/respondents/${SESSION}/timeline`, {})).status, 401);
    const hidden = await get(`/api/respondents/${SESSION}/timeline`);
    assert.equal(hidden.status, 404);
    assert.ok(!mock.calls.some((call) => call.path.includes("routing_hits")), "no further reads once the session is not visible");
  } finally { mock.restore(); }
  mock = mockSupabase("ANALYST", {
    "/survey_sessions": () => Response.json([{ id: SESSION }]),
    "/routing_hits": () => Response.json([]),
    "/survey_events": () => Response.json([{ event_type: "START", occurred_at: "2026-08-18T08:15:00Z" }]),
    "/fraud_flags": () => Response.json([]),
  });
  try {
    const response = await get(`/api/respondents/${SESSION}/timeline`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.meta.routerHitsVisible, false);
    const hitsCall = mock.calls.find((call) => call.path.includes("routing_hits"));
    assert.doesNotMatch(hitsCall.path, /ip_hash|user_agent_hash|visitor_id/);
  } finally { mock.restore(); }
});

test("only the exact timeline path is claimed, so the generic respondents handler still sees everything else", async () => {
  assert.equal(await handleRoutingReportsApi(new Request("https://x.example/api/respondents"), "/api/respondents", env), null);
  assert.equal(await handleRoutingReportsApi(new Request("https://x.example/api/respondents/abc/review"), "/api/respondents/abc/review", env), null);
  const mock = (await import("node:fs/promises")).readFile;
  const index = await mock(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.ok(index.indexOf("handleRoutingReportsApi(request") < index.indexOf("handleRespondentsApi(request"), "timeline route must precede the prefix-matched respondents handler");
});

test("migration 057 is a re-runnable security invoker function limited to authenticated users", () => {
  assert.match(sql, /create or replace function public\.supplier_funnel_report/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke all on function public\.supplier_funnel_report\(uuid, timestamptz, timestamptz, uuid, uuid\) from public/);
  assert.match(sql, /grant execute on function public\.supplier_funnel_report\([^)]*\) to authenticated, service_role/);
  assert.doesNotMatch(sql, /security definer/);
});

test("supplier funnel page, timeline component and navigation are wired up", async () => {
  const page = await readFile(new URL("../app/(product)/supplier-funnel/page.tsx", import.meta.url), "utf8");
  const component = await readFile(new URL("../app/components/SupplierFunnel.tsx", import.meta.url), "utf8");
  const timeline = await readFile(new URL("../app/components/ClickTimeline.tsx", import.meta.url), "utf8");
  const explorer = await readFile(new URL("../app/components/RespondentExplorer.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../app/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(page, /SupplierFunnel/);
  assert.match(component, /project-center-page/);
  assert.match(component, /outcome-grid/);
  assert.match(component, /\/api\/routing\/funnel/);
  assert.match(timeline, /\/timeline/);
  assert.doesNotMatch(timeline, /error\.message|stack/);
  assert.match(explorer, /<ClickTimeline key=\{selected\.id\}/);
  assert.match(shell, /\/supplier-funnel/);
});

test("server-renders the protected supplier funnel route", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/supplier-funnel", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Supplier funnel|Checking your workspace session/i);
});
