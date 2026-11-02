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

const { signClientReturn, verifyClientReturn, checkClientReturn, isValidClientSecretEnvName } = await import("../worker/domain/client-signing.ts");
const { signOutcome } = await import("../worker/lib/outcome-signatures.ts");
const { handleRedirectApi } = await import("../worker/routes/redirects.ts");
const { handleClientPostbackApi } = await import("../worker/routes/postbacks.ts");
const sql = await readFile(new URL("../supabase/migrations/055_signed_client_returns.sql", import.meta.url), "utf8");

const secret = "client-shared-secret-0123456789";
const sessionId = "11111111-1111-4111-8111-111111111111";
const completeToken = "00000000-0000-4000-8000-000000000011";
const outcomeSecret = "test-secret-key-for-outcome-signatures-32b";

test("client return signature binds session and outcome and rejects tampering", async () => {
  const h = await signClientReturn(secret, sessionId, "complete");
  assert.match(h, /^[a-f0-9]{64}$/);
  assert.equal(await verifyClientReturn(secret, sessionId, "complete", h), true);
  assert.equal(await verifyClientReturn(secret, sessionId, "terminate", h), false, "a terminate signature must not authorise a complete");
  assert.equal(await verifyClientReturn(secret, "22222222-2222-4222-8222-222222222222", "complete", h), false);
  assert.equal(await verifyClientReturn("another-secret-0123456789", sessionId, "complete", h), false);
  assert.equal(await verifyClientReturn(secret, sessionId, "complete", "short"), false);
  assert.equal(await verifyClientReturn(secret, sessionId, "complete", null), false);
});

test("policy matrix: OFF accepts, HOLD flags unsigned, REJECT refuses, bad signatures always refused, missing secret fails closed", async () => {
  const env = { CLIENT_ACME_SECRET: secret };
  const config = (signed_return_policy) => ({ signing_secret_env: "CLIENT_ACME_SECRET", signed_return_policy });
  const good = await signClientReturn(secret, sessionId, "complete");
  assert.deepEqual(await checkClientReturn(undefined, env, sessionId, "complete", null), { ok: true, verification: "NOT_REQUIRED" });
  assert.deepEqual(await checkClientReturn(config("OFF"), env, sessionId, "complete", null), { ok: true, verification: "NOT_REQUIRED" });
  assert.deepEqual(await checkClientReturn(config("HOLD"), env, sessionId, "complete", null), { ok: true, verification: "UNSIGNED" });
  assert.deepEqual(await checkClientReturn(config("HOLD"), env, sessionId, "complete", good), { ok: true, verification: "VERIFIED" });
  assert.equal((await checkClientReturn(config("HOLD"), env, sessionId, "complete", "a".repeat(64))).ok, false, "HOLD still refuses a wrong signature");
  const rejectMissing = await checkClientReturn(config("REJECT"), env, sessionId, "complete", null);
  assert.equal(rejectMissing.ok, false);
  assert.equal(rejectMissing.status, 403);
  const noSecret = await checkClientReturn(config("REJECT"), {}, sessionId, "complete", good);
  assert.equal(noSecret.ok, false);
  assert.equal(noSecret.status, 503);
  assert.equal(isValidClientSecretEnvName("CLIENT_ACME_SECRET"), true);
  assert.equal(isValidClientSecretEnvName("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(isValidClientSecretEnvName("CLIENT_x_SECRET"), false);
});

function mockWorld({ policy, sessionStatus = "REACHED_CLIENT" }) {
  const state = { ingested: [], flagPatches: 0, status: sessionStatus };
  const supplier = { id: "supplier-1", organization_id: "org-1", status: "ACTIVE", redirect_mode: "STATIC", complete_url: "https://supplier.example/c", terminate_url: null, quota_full_url: null, security_terminate_url: null };
  const session = () => ({ id: sessionId, respondent_ref: "SUP-1", is_test: false, status: state.status, projects: { project_code: "ROP-100", client_id: "client-1" }, project_suppliers: { suppliers: supplier } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/survey_sessions")) return Response.json([session()]);
    if (url.pathname.endsWith("/clients")) return Response.json([{ id: "client-1", signing_secret_env: "CLIENT_ACME_SECRET", signed_return_policy: policy }]);
    if (url.pathname.endsWith("/rpc/ingest_survey_event")) { state.ingested.push(JSON.parse(init.body)); return Response.json([{ session_id: sessionId, event_id: "evt-1", created: true }]); }
    if (url.pathname.endsWith("/fraud_flags")) { state.flagPatches += 1; return Response.json([{ id: "flag-1" }]); }
    throw new Error(`Unexpected route: ${url.pathname}`);
  };
  return state;
}

const baseEnv = { SUPABASE_URL: "https://database.example", SUPABASE_SERVICE_ROLE_KEY: "service-key", OUTCOME_SIGNING_SECRET: outcomeSecret, CLIENT_ACME_SECRET: secret };

async function outcomeRequest(query) {
  const path = `/r/outcome/${completeToken}/complete`;
  const sig = await signOutcome(completeToken, "complete", outcomeSecret);
  return handleRedirectApi(new Request(`https://router.example${path}?sig=${sig}${query}`), path, baseEnv);
}

test("REJECT: an unsigned complete is refused and nothing is recorded", async () => {
  const original = globalThis.fetch;
  try {
    const state = mockWorld({ policy: "REJECT" });
    const response = await outcomeRequest("");
    assert.equal(response.status, 403);
    assert.equal(state.ingested.length, 0);
  } finally { globalThis.fetch = original; }
});

test("REJECT: a correctly client-signed complete is recorded as VERIFIED, a wrong outcome signature is refused", async () => {
  const original = globalThis.fetch;
  try {
    const state = mockWorld({ policy: "REJECT" });
    const h = await signClientReturn(secret, sessionId, "complete");
    const response = await outcomeRequest(`&h=${h}`);
    assert.equal(response.status, 200);
    assert.equal(state.ingested.length, 1);
    assert.equal(JSON.stringify(state.ingested[0]).includes("VERIFIED"), true);

    const wrong = await signClientReturn(secret, sessionId, "terminate");
    const refused = await outcomeRequest(`&h=${wrong}`);
    assert.equal(refused.status, 403);
    assert.equal(state.ingested.length, 1);
  } finally { globalThis.fetch = original; }
});

test("HOLD: an unsigned complete is recorded but marked UNSIGNED so the database holds it", async () => {
  const original = globalThis.fetch;
  try {
    const state = mockWorld({ policy: "HOLD" });
    const response = await outcomeRequest("");
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(state.ingested[0]).includes("UNSIGNED"), true);
  } finally { globalThis.fetch = original; }
});

test("REJECT: replaying an already-recorded complete without h is only a harmless hand-off", async () => {
  const original = globalThis.fetch;
  try {
    mockWorld({ policy: "REJECT", sessionStatus: "COMPLETE" });
    assert.equal((await outcomeRequest("")).status, 200);
  } finally { globalThis.fetch = original; }
});

test("a configured policy whose secret is missing from the Worker fails closed with 503", async () => {
  const original = globalThis.fetch;
  try {
    mockWorld({ policy: "REJECT" });
    const path = `/r/outcome/${completeToken}/complete`;
    const sig = await signOutcome(completeToken, "complete", outcomeSecret);
    const withoutSecret = { ...baseEnv };
    delete withoutSecret.CLIENT_ACME_SECRET;
    const response = await handleRedirectApi(new Request(`https://router.example${path}?sig=${sig}`), path, withoutSecret);
    assert.equal(response.status, 503);
  } finally { globalThis.fetch = original; }
});

async function signedPostback(payload, key = secret, skew = 0) {
  const raw = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000) + skew);
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${timestamp}.${raw}`))), (b) => b.toString(16).padStart(2, "0")).join("");
  return new Request("https://router.example/api/postbacks/client-token-0001", { method: "POST", body: raw, headers: { "x-researchops-timestamp": timestamp, "x-researchops-signature": signature } });
}

test("server-to-server postback: valid signature records a VERIFIED complete and reconciles the hold", async () => {
  const original = globalThis.fetch;
  try {
    const state = mockWorld({ policy: "HOLD" });
    const response = await handleClientPostbackApi(await signedPostback({ rid: sessionId, status: "complete" }), "/api/postbacks/client-token-0001", baseEnv);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reconciled, true);
    assert.equal(state.flagPatches, 1);
    assert.equal(JSON.stringify(state.ingested[0]).includes("VERIFIED"), true);
  } finally { globalThis.fetch = original; }
});

test("server-to-server postback: bad signature, stale timestamp, wrong secret and bad payload are rejected", async () => {
  const original = globalThis.fetch;
  try {
    const state = mockWorld({ policy: "HOLD" });
    const run = async (request) => (await handleClientPostbackApi(request, "/api/postbacks/client-token-0001", baseEnv)).status;
    assert.equal(await run(await signedPostback({ rid: sessionId, status: "complete" }, "attacker-secret-0123456789")), 401);
    assert.equal(await run(await signedPostback({ rid: sessionId, status: "complete" }, secret, -3600)), 401);
    assert.equal(await run(await signedPostback({ rid: "not-a-uuid", status: "complete" })), 400);
    assert.equal(await run(await signedPostback({ rid: sessionId, status: "bogus" })), 400);
    assert.equal(state.ingested.length, 0);
    state.status = "TERMINATE";
    assert.equal(await run(await signedPostback({ rid: sessionId, status: "complete" })), 409, "a terminated respondent cannot be completed");
  } finally { globalThis.fetch = original; }
});

test("migration 055 adds the policy columns, new hold rules, and keeps held completes out of valid delivery", () => {
  assert.match(sql, /add column if not exists signing_secret_env/i);
  assert.match(sql, /signed_return_policy in \('OFF','HOLD','REJECT'\)/i);
  assert.match(sql, /signing_secret_env ~ '\^CLIENT_\[A-Z0-9_\]\{1,40\}_SECRET\$'/i);
  assert.match(sql, /rule_code in \('DUPLICATE_IP','DUPLICATE_DEVICE','SPEEDING','QUALITY_VIOLATION','UNVERIFIED_RETURN','NO_CLIENT_REACH'\)/);
  assert.equal((sql.match(/rule_code in \('SPEEDING', 'UNVERIFIED_RETURN', 'NO_CLIENT_REACH'\) and status in/g) ?? []).length, 2, "both metric views must exclude held completes");
  assert.match(sql, /apply_quota_reservation_outcome/);
  assert.match(sql, /'NO_CLIENT_REACH'/);
  assert.doesNotMatch(sql, /create table (?!if not exists)/i);
});
