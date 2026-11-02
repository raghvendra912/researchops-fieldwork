import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// Resolve extensionless Worker imports when running source TypeScript in Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const { handleRedirectApi } = await import("../worker/routes/redirects.ts");
const cache = await import("../worker/lib/config-cache.ts");

const supplierToken = "00000000-0000-4000-8000-000000000001";
const clientToken = "00000000-0000-4000-8000-000000000002";
const sessionId = "00000000-0000-4000-8000-000000000003";
const outcomeToken = "00000000-0000-4000-8000-000000000004";
const baseEnv = { SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "service-key" };

// The entry path made this many Supabase REST calls on a cold click before this change
// (suppliers, check_rate_limit, project_suppliers, eligibility, quota cells, reserve RPC, START,
// network context, fraud flags, survey_sessions, marketplaces, REACHED_CLIENT).
const CALLS_BEFORE = 12;

function world(overrides = {}) {
  const state = {
    supplier: { id: "supplier-1", organization_id: "org-1", status: "ACTIVE", redirect_mode: "STATIC", complete_url: null, terminate_url: "https://panel.example.com/term", quota_full_url: "https://panel.example.com/qf", security_terminate_url: "https://panel.example.com/sec" },
    assignmentStatus: "ACTIVE",
    projectStatus: "LIVE",
    clientId: "client-perf",
    projectId: "project-perf",
    surveyUrl: "https://panel.example.com/s?id=1&uid={{respondent_id}}",
    rules: [],
    cells: [],
    reservation: { allowed: true, reservation_id: "reservation-1", reason: "ok" },
    failStart: false,
    barriers: [],
    ...overrides,
  };
  const calls = []; const events = []; const rpcBodies = {};
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input); const path = url.pathname.replace("/rest/v1/", "");
    calls.push(path);
    for (const barrier of state.barriers) {
      if (!barrier.paths.some((name) => path.endsWith(name))) continue;
      barrier.arrived.add(path);
      if (barrier.arrived.size === barrier.paths.length) barrier.release();
      await Promise.race([barrier.promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`not concurrent: ${path}`)), 400))]);
    }
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (path === "rpc/check_rate_limit") return Response.json([{ allowed: true, remaining: 100, resets_at: new Date(Date.now() + 60000).toISOString() }]);
    if (path === "rpc/ingest_survey_event") {
      events.push(body.p_event_type);
      if (state.failStart && body.p_event_type === "START") return new Response("boom", { status: 500 });
      return Response.json([{ session_id: sessionId, event_id: crypto.randomUUID(), created: true }]);
    }
    if (path === "rpc/reserve_project_quota") { rpcBodies.reserve = body; return Response.json([state.reservation]); }
    if (path === "rpc/release_quota_reservation") { rpcBodies.release = body; return Response.json([]); }
    if (path === "rpc/capture_session_network_context") return Response.json(null);
    if (path === "marketplaces") return Response.json([]);
    if (path === "suppliers") return Response.json([state.supplier]);
    if (path === "project_suppliers") return Response.json([{ id: "assignment-1", supplier_id: state.supplier.id, target_quota: 10, status: state.assignmentStatus, projects: { id: state.projectId, client_id: state.clientId, project_code: "ROP-88", status: state.projectStatus, survey_url: state.surveyUrl, test_survey_url: null, survey_parameters: [], clients: { redirect_token: clientToken }, project_markets: [{ country_code: "IN", language_code: "en" }] } }]);
    if (path === "project_eligibility_rules") return Response.json(state.rules);
    if (path === "project_quota_cells") return Response.json(state.cells);
    if (path === "fraud_flags") return Response.json([]);
    if (path === "survey_sessions") return Response.json([{ outcome_token: outcomeToken }]);
    throw new Error(`Unexpected mocked route: ${path}`);
  };
  return { state, calls, events, rpcBodies, restore: () => { globalThis.fetch = original; } };
}
function barrier(...paths) {
  let release; const promise = new Promise((resolve) => { release = resolve; });
  return { paths, arrived: new Set(), promise, release };
}
const click = (env = baseEnv, query = "project=ROP-88&respondent=SUP-1") => {
  const path = `/r/supplier/${supplierToken}/live`;
  return handleRedirectApi(new Request(`https://router.example${path}?${query}`), path, env);
};

test("a warm live entry makes fewer Supabase calls than the old 12 and exposes Server-Timing", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-count", projectId: "project-count" });
  try {
    const cold = await click();
    assert.equal(cold?.status, 302, await cold?.clone().text());
    assert.equal(w.calls.length, CALLS_BEFORE, "a cold click still reads everything once");
    assert.match(cold.headers.get("server-timing"), /^entry;dur=\d+$/);
    w.calls.length = 0;
    const warm = await click();
    assert.equal(warm?.status, 302);
    assert.ok(w.calls.length < CALLS_BEFORE, `warm click made ${w.calls.length} calls`);
    assert.equal(w.calls.length, 9);
    for (const cached of ["project_eligibility_rules", "project_quota_cells", "marketplaces"]) assert.ok(!w.calls.includes(cached), `${cached} is served from the config cache`);
    for (const fresh of ["suppliers", "project_suppliers", "rpc/reserve_project_quota", "rpc/ingest_survey_event"]) assert.ok(w.calls.includes(fresh), `${fresh} is read live`);
  } finally { w.restore(); }
});

test("independent reads overlap: rate limit with assignment lookup, rules with quota cells and marketplace, capture with fraud and token reads", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-overlap", projectId: "project-overlap" });
  w.state.barriers = [
    barrier("rpc/check_rate_limit", "project_suppliers"),
    barrier("project_eligibility_rules", "project_quota_cells", "marketplaces"),
    barrier("rpc/capture_session_network_context", "fraud_flags", "survey_sessions"),
  ];
  try {
    const response = await click();
    assert.equal(response?.status, 302, await response?.clone().text());
    assert.equal(new URL(response.headers.get("location")).searchParams.get("rid"), sessionId);
  } finally { w.restore(); }
});

test("ordering that must stay sequential: START before network context, reservation before START, REACHED_CLIENT last", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-order", projectId: "project-order" });
  try {
    await click();
    const at = (name) => w.calls.indexOf(name);
    assert.ok(at("rpc/reserve_project_quota") < at("rpc/ingest_survey_event"));
    assert.ok(at("rpc/ingest_survey_event") < at("rpc/capture_session_network_context"));
    assert.ok(at("project_suppliers") < at("project_eligibility_rules"), "config reads wait for the live assignment status");
    assert.deepEqual(w.events, ["START", "REACHED_CLIENT"]);
    assert.equal(w.calls.at(-1), "rpc/ingest_survey_event");
  } finally { w.restore(); }
});

test("a paused project, assignment or supplier is refused on the very next click even with warm config", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-pause", projectId: "project-pause" });
  try {
    assert.equal((await click())?.status, 302);
    assert.equal((await click())?.status, 302, "second click is served with cached config");
    w.calls.length = 0;

    w.state.projectStatus = "PAUSED";
    let response = await click();
    assert.match(response.headers.get("location"), /^https:\/\/panel\.example\.com\/term/);
    assert.ok(!w.calls.includes("rpc/reserve_project_quota") && !w.calls.includes("rpc/ingest_survey_event"), "no quota or event for a paused project");

    w.state.projectStatus = "LIVE"; w.state.assignmentStatus = "PAUSED";
    response = await click();
    assert.match(response.headers.get("location"), /^https:\/\/panel\.example\.com\/term/);
    assert.ok(!w.calls.includes("rpc/reserve_project_quota"));

    w.state.assignmentStatus = "ACTIVE"; w.state.supplier = { ...w.state.supplier, status: "PAUSED" };
    response = await click();
    assert.equal(response.status, 404);
    assert.ok(!w.calls.includes("rpc/reserve_project_quota"));

    w.state.supplier = { ...w.state.supplier, status: "ACTIVE" };
    assert.equal((await click())?.status, 302, "resumes immediately too");
  } finally { w.restore(); }
});

test("eligibility and quota behave identically with the cache on and off", async () => {
  const rules = [{ variable_key: "age", operator: "BETWEEN", values: ["18", "40"], required: true, active: true }];
  const cells = [
    { id: "cell-a", name: "A", target_quota: 5, priority: 1, active: true, conditions: [{ variable_key: "gender", operator: "EQ", values: ["f"], required: true }] },
    { id: "cell-b", name: "B", target_quota: 5, priority: 2, active: true, conditions: [{ variable_key: "gender", operator: "EQ", values: ["m"], required: true }] },
  ];
  const run = async (seconds, repeat) => {
    cache.invalidateConfigCache();
    const w = world({ clientId: `client-id-${seconds}`, projectId: `project-id-${seconds}`, rules, cells });
    const env = { ...baseEnv, ROUTER_CONFIG_CACHE_SECONDS: seconds };
    try {
      const results = [];
      for (let index = 0; index < repeat; index += 1) {
        const ok = await click(env, "project=ROP-88&respondent=SUP-1&age=30&gender=f");
        const reserve = JSON.stringify(w.rpcBodies.reserve);
        const old = await click(env, "project=ROP-88&respondent=SUP-2&age=70&gender=f");
        results.push({ ok: ok.status, reserve, ineligible: old.status, ineligibleTo: new URL(old.headers.get("location")).host });
      }
      w.state.reservation = { allowed: false, reservation_id: null, reason: "cell_full" };
      const full = await click(env, "project=ROP-88&respondent=SUP-3&age=30&gender=m");
      return { results, full: [full.status, new URL(full.headers.get("location")).pathname], events: w.events.join(","), reserve: w.rpcBodies.reserve, calls: w.calls.length };
    } finally { w.restore(); }
  };
  const cached = await run("60", 2); const uncached = await run("0", 2);
  assert.deepEqual(cached.results, uncached.results);
  assert.deepEqual(cached.full, uncached.full);
  assert.equal(cached.events, uncached.events);
  assert.equal(cached.results[0].ok, 302);
  assert.equal(cached.results[0].ineligible, 302);
  assert.equal(cached.results[0].ineligibleTo, "panel.example.com");
  assert.deepEqual(JSON.parse(cached.results[0].reserve).p_matching_cell_ids, ["cell-a"]);
  assert.deepEqual(cached.reserve.p_matching_cell_ids, ["cell-b"]);
  assert.deepEqual(cached.full, [302, "/qf"]);
  assert.match(cached.events, /START,TERMINATE/);
  assert.match(cached.events, /QUOTA_FULL$/);
  assert.ok(cached.calls < uncached.calls, "the cache removes calls only; the outcome is unchanged");
});

test("ROUTER_CONFIG_CACHE_SECONDS=0 re-reads configuration on every click", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-off", projectId: "project-off" });
  try {
    const env = { ...baseEnv, ROUTER_CONFIG_CACHE_SECONDS: "0" };
    await click(env); await click(env);
    for (const name of ["project_eligibility_rules", "project_quota_cells", "marketplaces"]) assert.equal(w.calls.filter((path) => path === name).length, 2, name);
    assert.equal(cache.configCacheSize(), 0);
  } finally { w.restore(); }
});

test("a rule edit applies after invalidation or TTL expiry, not before (documented staleness)", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-edit", projectId: "project-edit" });
  const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
  try {
    assert.equal((await click(baseEnv, "project=ROP-88&respondent=SUP-1&age=30"))?.status, 302);
    assert.equal(w.events.at(-1), "REACHED_CLIENT");
    w.state.rules = [{ variable_key: "age", operator: "GTE", values: ["99"], required: true, active: true }];
    await click(baseEnv, "project=ROP-88&respondent=SUP-2&age=30");
    assert.equal(w.events.at(-1), "REACHED_CLIENT", "stale rules are still used inside the TTL");
    cache.invalidateConfigCache("eligibility-rules", "project-edit");
    await click(baseEnv, "project=ROP-88&respondent=SUP-3&age=30");
    assert.equal(w.events.at(-1), "TERMINATE", "applies after invalidate");
    w.state.rules = [];
    await click(baseEnv, "project=ROP-88&respondent=SUP-4&age=30");
    assert.equal(w.events.at(-1), "TERMINATE", "still cached");
    offset = 61_000;
    await click(baseEnv, "project=ROP-88&respondent=SUP-5&age=30");
    assert.equal(w.events.at(-1), "REACHED_CLIENT", "applies after the TTL");
  } finally { Date.now = realNow; w.restore(); }
});

test("config cache: TTL expiry, size bound, disabled at 0, clamped to 60s, failures not cached", async () => {
  cache.invalidateConfigCache();
  assert.equal(cache.configCacheTtlMs({}), 60_000);
  assert.equal(cache.configCacheTtlMs({ ROUTER_CONFIG_CACHE_SECONDS: "0" }), 0);
  assert.equal(cache.configCacheTtlMs({ ROUTER_CONFIG_CACHE_SECONDS: "15" }), 15_000);
  assert.equal(cache.configCacheTtlMs({ ROUTER_CONFIG_CACHE_SECONDS: "900" }), 60_000, "never above 60 seconds");
  assert.equal(cache.configCacheTtlMs({ ROUTER_CONFIG_CACHE_SECONDS: "-3" }), 60_000);
  assert.equal(cache.configCacheTtlMs({ ROUTER_CONFIG_CACHE_SECONDS: "abc" }), 60_000);

  let loads = 0; const load = async () => ++loads;
  const env = { ROUTER_CONFIG_CACHE_SECONDS: "10" };
  const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
  try {
    assert.equal(await cache.cachedConfig(env, "t", "k", load), 1);
    assert.equal(await cache.cachedConfig(env, "t", "k", load), 1);
    offset = 10_001;
    assert.equal(await cache.cachedConfig(env, "t", "k", load), 2, "expired entry is reloaded");
    assert.equal(await cache.cachedConfig({ ROUTER_CONFIG_CACHE_SECONDS: "0" }, "t", "k", load), 3, "disabled cache always loads");
    assert.equal(await cache.cachedConfig({ ROUTER_CONFIG_CACHE_SECONDS: "0" }, "t", "k", load), 4);
    await assert.rejects(cache.cachedConfig(env, "t", "bad", async () => { throw new Error("down"); }));
    assert.equal(await cache.cachedConfig(env, "t", "bad", async () => "recovered"), "recovered", "a failure is not cached");

    cache.invalidateConfigCache();
    for (let index = 0; index < cache.CONFIG_CACHE_MAX_ENTRIES + 50; index += 1) await cache.cachedConfig(env, "bound", `k${index}`, async () => index);
    assert.equal(cache.configCacheSize(), cache.CONFIG_CACHE_MAX_ENTRIES);
    assert.equal(cache.readConfigCache("bound", "k0").hit, false, "oldest entries are evicted");
    assert.equal(cache.readConfigCache("bound", `k${cache.CONFIG_CACHE_MAX_ENTRIES + 49}`).hit, true);
    cache.invalidateConfigCache("bound", "k100");
    assert.equal(cache.readConfigCache("bound", "k100").hit, false);
    cache.invalidateConfigCache("bound");
    assert.equal(cache.configCacheSize(), 0);
  } finally { Date.now = realNow; }
});

test("the quota reservation is released and the click refused when the START write fails", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-startfail", projectId: "project-startfail", failStart: true });
  try {
    const response = await click();
    assert.equal(response?.status, 502);
    assert.match(await response.text(), /could not be started/);
    assert.deepEqual(w.rpcBodies.release, { p_reservation_id: "reservation-1" });
    assert.ok(!w.calls.includes("rpc/capture_session_network_context"));
    assert.ok(!w.calls.includes("fraud_flags") && !w.calls.includes("survey_sessions"), "speculative reads only start after a successful START");
  } finally { w.restore(); }
});

test("the quota reservation is released on a geo mismatch and no speculative reads are wasted", async () => {
  cache.invalidateConfigCache();
  const w = world({ clientId: "client-geo", projectId: "project-geo" });
  try {
    const path = `/r/supplier/${supplierToken}/live`;
    const request = new Request(`https://router.example${path}?project=ROP-88&respondent=SUP-1`, { headers: { "x-vercel-ip-country": "US" } });
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input).includes("/project_suppliers")) { const rows = await response.json(); rows[0].projects.geo_security_enabled = true; return Response.json(rows); }
      return response;
    };
    const response = await handleRedirectApi(request, path, baseEnv);
    globalThis.fetch = original;
    assert.equal(response.headers.get("location")?.startsWith("https://panel.example.com/sec"), true);
    assert.deepEqual(w.rpcBodies.release, { p_reservation_id: "reservation-1" });
    assert.ok(!w.calls.includes("fraud_flags") && !w.calls.includes("survey_sessions"), "no wasted reads on a geo mismatch");
  } finally { w.restore(); }
});
