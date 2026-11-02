import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  }
});

const { handleRedirectApi } = await import("../worker/routes/redirects.ts");
const { createHmacSignature, verifyHmacSignature, generateClickId, extractOrSetVisitorId } = await import("../worker/lib/security.ts");

const secret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const env = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-key-at-least-32-chars-long",
  EVENT_INGESTION_SECRET: secret,
};

test("HMAC signatures authenticate outcome links and detect tampering", async () => {
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const outcome = "complete";
  const signature = await createHmacSignature(secret, `${sessionId}:${outcome}`);
  assert.equal(signature.length, 64);

  // Valid signature
  const valid = await verifyHmacSignature(secret, `${sessionId}:${outcome}`, signature);
  assert.equal(valid, true);

  // Tampered outcome (e.g. screened-out respondent edits URL to complete)
  const tamperedOutcome = await verifyHmacSignature(secret, `${sessionId}:terminate`, signature);
  assert.equal(tamperedOutcome, false);

  // Tampered session ID
  const tamperedSession = await verifyHmacSignature(secret, `00000000-0000-4000-8000-000000000002:${outcome}`, signature);
  assert.equal(tamperedSession, false);
});

test("UUIDv7 generates timestamp-ordered valid UUIDs", () => {
  const id1 = generateClickId();
  const id2 = generateClickId();
  assert.match(id1, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(id2, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(id1, id2);
});

test("visitor identification extracts existing or generates persistent 24h ro_vid cookie", () => {
  // Fresh visitor
  const req1 = new Request("https://router.example/l/token");
  const { visitorId: vid1, setCookieHeader } = extractOrSetVisitorId(req1);
  assert.ok(vid1);
  assert.match(setCookieHeader, /ro_vid=/);
  assert.match(setCookieHeader, /Max-Age=86400/);
  assert.match(setCookieHeader, /HttpOnly/);

  // Returning visitor
  const req2 = new Request("https://router.example/l/token", {
    headers: { cookie: `ro_vid=${vid1}` }
  });
  const { visitorId: vid2, setCookieHeader: returnHeader } = extractOrSetVisitorId(req2);
  assert.equal(vid2, vid1);
  assert.equal(returnHeader, undefined);
});

test("outcome routing rejects tampered HMAC signatures", async () => {
  const originalFetch = globalThis.fetch;
  const loggedHits = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/rpc/record_routing_hit")) {
      loggedHits.push(JSON.parse(init.body));
      return Response.json([{ id: crypto.randomUUID() }]);
    }
    if (url.pathname.endsWith("/survey_sessions")) {
      return Response.json([{
        id: "sess-100",
        respondent_ref: "resp-100",
        status: "REACHED_CLIENT",
        is_test: false,
        projects: { id: "prj-1", project_code: "ROP-100" },
        project_suppliers: { suppliers: { id: "sup-1", organization_id: "org-1", status: "ACTIVE", complete_url: "https://sup.example/c" } }
      }]);
    }
    throw new Error(`Unexpected route: ${url.pathname}`);
  };

  try {
    const path = "/r/outcome/00000000-0000-4000-8000-000000000100/complete";
    // Call with invalid signature
    const response = await handleRedirectApi(
      new Request(`https://router.example${path}?h=bad0000000000000000000000000000000000000000000000000000000000000&diagnose=1`),
      path,
      env
    );
    assert.equal(response?.status, 403);
    const body = await response?.json();
    assert.match(body.error, /invalid or tampered/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fast complete holds speeding respondents for review and logs supplier exit", async () => {
  const originalFetch = globalThis.fetch;
  const events = [];
  const loggedHits = [];
  const sessionId = "00000000-0000-4000-8000-000000000200";
  const signature = await createHmacSignature(secret, `${sessionId}:complete`);

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/rpc/record_routing_hit")) {
      loggedHits.push(JSON.parse(init.body));
      return Response.json([{ id: crypto.randomUUID() }]);
    }
    if (url.pathname.endsWith("/survey_sessions")) {
      return Response.json([{
        id: sessionId,
        respondent_ref: "resp-200",
        status: "REACHED_CLIENT",
        is_test: false,
        started_at: new Date(Date.now() - 5000).toISOString(), // 5 seconds ago = speeding!
        projects: { id: "prj-2", project_code: "ROP-200" },
        project_suppliers: { suppliers: { id: "sup-2", organization_id: "org-2", status: "ACTIVE", complete_url: "https://sup.example/complete?uid={{respondent_id}}" } }
      }]);
    }
    if (url.pathname.endsWith("/rpc/ingest_survey_event")) {
      events.push(JSON.parse(init.body));
      return Response.json([{ session_id: sessionId, event_id: crypto.randomUUID(), created: true }]);
    }
    throw new Error(`Unexpected route: ${url.pathname}`);
  };

  try {
    const path = "/r/outcome/00000000-0000-4000-8000-000000000200/complete";
    const response = await handleRedirectApi(
      new Request(`https://router.example${path}?h=${signature}&rid=${sessionId}`),
      path,
      env
    );
    assert.equal(response?.status, 200);
    // Check speeding reason was emitted to event ingestion
    assert.equal(events[0].p_event_type, "COMPLETE");
    assert.equal(events[0].p_metadata.heldForReview, true);
    assert.equal(events[0].p_metadata.reasonCode, "SPEEDING_HELD_FOR_REVIEW");

    // Check hit logs: CLIENT_RETURN and SUPPLIER_EXIT were recorded
    const clientReturn = loggedHits.find(h => h.p_stage === "CLIENT_RETURN");
    assert.ok(clientReturn);
    assert.equal(clientReturn.p_status, "ACCEPTED");

    const supplierExit = loggedHits.find(h => h.p_stage === "SUPPLIER_EXIT");
    assert.ok(supplierExit);
    assert.equal(supplierExit.p_status, "PROCESSED");
    assert.match(supplierExit.p_target_url, /sup\.example\/complete/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
