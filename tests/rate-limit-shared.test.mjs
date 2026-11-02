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

const { checkSharedRateLimit, checkRateLimit, rateLimitResponse, purgeSharedRateLimitBuckets } = await import("../worker/lib/rate-limit.ts");
const sql = await readFile(new URL("../supabase/migrations/056_shared_rate_limit.sql", import.meta.url), "utf8");

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key" };
const realFetch = globalThis.fetch;
const realWarn = console.warn;
let counter = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${counter++}-${Math.random()}`;

// Simulates the Postgres RPC: fixed window per key, atomic increment.
function fakeRpc() {
  const rows = new Map();
  const calls = [];
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /\/rest\/v1\/rpc\/check_rate_limit$/);
    assert.equal(init.headers.authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    const body = JSON.parse(init.body);
    calls.push(body);
    const now = Date.now();
    let row = rows.get(body.p_key);
    if (!row || row.start + body.p_window_seconds * 1000 <= now) row = { start: now, hits: 0 };
    row.hits += 1;
    rows.set(body.p_key, row);
    return Response.json([{ allowed: row.hits <= body.p_limit, remaining: Math.max(0, body.p_limit - row.hits), resets_at: new Date(row.start + body.p_window_seconds * 1000).toISOString() }]);
  };
  return { rows, calls };
}

test.afterEach(() => { globalThis.fetch = realFetch; console.warn = realWarn; });

test("shared limiter allows up to the limit then blocks, with rateLimitResponse compatibility", async () => {
  fakeRpc();
  const key = uniq("a");
  const first = await checkSharedRateLimit(env, key, 2, 60);
  assert.deepEqual([first.allowed, first.remaining], [true, 1]);
  assert.equal((await checkSharedRateLimit(env, key, 2, 60)).allowed, true);
  const third = await checkSharedRateLimit(env, key, 2, 60);
  assert.deepEqual([third.allowed, third.remaining], [false, 0]);
  assert.equal(typeof third.resetsAt, "number");
  const response = rateLimitResponse(third);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("retry-after")) >= 1);
});

test("shared limiter window resets after expiry", async () => {
  const { rows } = fakeRpc();
  const key = uniq("w");
  await checkSharedRateLimit(env, key, 1, 60);
  assert.equal((await checkSharedRateLimit(env, key, 1, 60)).allowed, false);
  for (const row of rows.values()) row.start -= 61_000;
  assert.equal((await checkSharedRateLimit(env, key, 1, 60)).allowed, true);
});

test("IP is hashed into the key and never sent raw; overlong keys are hashed", async () => {
  const { calls } = fakeRpc();
  await checkSharedRateLimit(env, "postback:abc", 5, 60, { ip: "203.0.113.9" });
  await checkSharedRateLimit(env, "postback:abc", 5, 60, { ip: "203.0.113.10" });
  assert.match(calls[0].p_key, /^postback:abc:[a-f0-9]{32}$/);
  assert.ok(!JSON.stringify(calls).includes("203.0.113"));
  assert.notEqual(calls[0].p_key, calls[1].p_key);
  await checkSharedRateLimit(env, "x".repeat(500), 5, 60);
  assert.ok(calls[2].p_key.length <= 200);
});

test("500 and timeout fall back to the in-memory limiter and still enforce the limit", async () => {
  const warnings = [];
  console.warn = (line) => warnings.push(String(line));
  globalThis.fetch = async () => new Response("boom", { status: 500 });
  const key = uniq("f500");
  assert.equal((await checkSharedRateLimit(env, key, 2, 60)).allowed, true);
  assert.equal((await checkSharedRateLimit(env, key, 2, 60)).allowed, true);
  assert.equal((await checkSharedRateLimit(env, key, 2, 60)).allowed, false);

  globalThis.fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const slow = uniq("slow");
  const started = Date.now();
  assert.equal((await checkSharedRateLimit(env, slow, 1, 60)).allowed, true);
  assert.ok(Date.now() - started < 3000, "must time out quickly");
  assert.equal((await checkSharedRateLimit(env, slow, 1, 60)).allowed, false);

  assert.ok(warnings.length <= 1, "warnings are throttled");
  assert.ok(warnings.every((line) => !/service-role-test-key/.test(line)));
});

test("malformed RPC payload and network errors fall back", async () => {
  globalThis.fetch = async () => Response.json({ nope: true });
  const key = uniq("bad");
  assert.equal((await checkSharedRateLimit(env, key, 1, 60)).allowed, true);
  globalThis.fetch = async () => { throw new TypeError("network down"); };
  assert.equal((await checkSharedRateLimit(env, key, 1, 60)).allowed, false);
});

test("missing configuration uses memory without calling fetch", async () => {
  globalThis.fetch = async () => { throw new Error("fetch must not be called"); };
  const key = uniq("nocfg");
  assert.equal((await checkSharedRateLimit({}, key, 1, 60)).allowed, true);
  assert.equal((await checkSharedRateLimit({}, key, 1, 60)).allowed, false);
});

test("bad inputs are rejected", async () => {
  await assert.rejects(checkSharedRateLimit(env, "k", 0, 60), RangeError);
  await assert.rejects(checkSharedRateLimit(env, "k", 100001, 60), RangeError);
  await assert.rejects(checkSharedRateLimit(env, "k", 1.5, 60), RangeError);
  await assert.rejects(checkSharedRateLimit(env, "k", 1, 0), RangeError);
  await assert.rejects(checkSharedRateLimit(env, "k", 1, 86401), RangeError);
  await assert.rejects(checkSharedRateLimit(env, "", 1, 60), RangeError);
});

test("synchronous checkRateLimit is unchanged", () => {
  const key = uniq("sync");
  assert.equal(checkRateLimit(key, 2, 60).remaining, 1);
  assert.equal(checkRateLimit(key, 2, 60).allowed, true);
  assert.equal(checkRateLimit(key, 2, 60).allowed, false);
});

test("purge helper never throws", async () => {
  globalThis.fetch = async () => Response.json(7);
  assert.equal(await purgeSharedRateLimitBuckets(env), 7);
  globalThis.fetch = async () => { throw new Error("x"); };
  assert.equal(await purgeSharedRateLimitBuckets(env), null);
  assert.equal(await purgeSharedRateLimitBuckets({}), null);
});

test("migration 056 is service-role only, validated and re-runnable", () => {
  assert.match(sql, /create unlogged table if not exists public\.rate_limit_buckets/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.rate_limit_buckets from public, anon, authenticated/);
  assert.match(sql, /create or replace function public\.check_rate_limit/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /on conflict \(bucket_key\) do update/);
  assert.match(sql, /grant execute on function public\.check_rate_limit\(text, integer, integer\) to service_role/);
  assert.match(sql, /grant execute on function public\.purge_rate_limit_buckets\(\) to service_role/);
  assert.doesNotMatch(sql, /grant[^;]*to[^;]*\b(anon|authenticated)\b/i);
  assert.doesNotMatch(sql, /perform_maintenance_tasks/);
});
