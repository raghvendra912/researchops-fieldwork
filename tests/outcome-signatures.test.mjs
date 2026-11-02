import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { signOutcome, verifyOutcomeSignature, signedOutcomeRoute } = await import("../worker/lib/outcome-signatures.ts");
const { handleRedirectApi } = await import("../worker/routes/redirects.ts");

const secret = "test-secret-key-for-outcome-signatures-32b";
const token = "00000000-0000-4000-8000-000000000001";
const completeToken = "00000000-0000-4000-8000-000000000011";
const terminateToken = "00000000-0000-4000-8000-000000000012";

test("outcome signature verifies valid signature and rejects mismatched outcomes", async () => {
  const completeSig = await signOutcome(token, "complete", secret);
  const terminateSig = await signOutcome(token, "terminate", secret);

  assert.equal(typeof completeSig, "string");
  assert.equal(completeSig.length, 32);
  assert.notEqual(completeSig, terminateSig);

  // Valid signatures verify
  assert.equal(await verifyOutcomeSignature(token, "complete", completeSig, secret), true);
  assert.equal(await verifyOutcomeSignature(token, "terminate", terminateSig, secret), true);

  // Mismatched outcome fails (e.g. respondent changing /terminate to /complete with terminate's signature)
  assert.equal(await verifyOutcomeSignature(token, "complete", terminateSig, secret), false);
  assert.equal(await verifyOutcomeSignature(token, "terminate", completeSig, secret), false);

  // Wrong token fails
  assert.equal(await verifyOutcomeSignature("00000000-0000-4000-8000-000000000002", "complete", completeSig, secret), false);

  // Tampered signature fails
  const tampered = completeSig.slice(0, -1) + (completeSig.endsWith("0") ? "1" : "0");
  assert.equal(await verifyOutcomeSignature(token, "complete", tampered, secret), false);
  assert.equal(await verifyOutcomeSignature(token, "complete", "", secret), false);
  assert.equal(await verifyOutcomeSignature(token, "complete", null, secret), false);
});

test("signedOutcomeRoute builds URL with ?sig= parameter", async () => {
  const url = await signedOutcomeRoute("https://router.asrv.co.in", token, "complete", secret);
  assert.match(url, new RegExp(`^https://router\\.asrv\\.co\\.in/r/outcome/${token}/complete\\?sig=[a-f0-9]{32}$`));
});

test("outcome endpoint enforces signatures and per-outcome token separation", async () => {
  const supplier = {
    id: "supplier-1",
    organization_id: "org-1",
    status: "ACTIVE",
    redirect_mode: "STATIC",
    complete_url: "https://supplier.example/complete",
    terminate_url: "https://supplier.example/terminate",
    quota_full_url: null,
    security_terminate_url: null,
  };
  const session = {
    respondent_ref: "SUP-REF-1",
    is_test: false,
    status: "REACHED_CLIENT",
    projects: { project_code: "ROP-100" },
    project_suppliers: { suppliers: supplier },
  };
  const env = {
    SUPABASE_URL: "https://database.example",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    OUTCOME_SIGNING_SECRET: secret,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/survey_sessions")) {
      // Check query parameter for specific token column
      if (url.searchParams.get("complete_token") === `eq.${completeToken}`) {
        return Response.json([session]);
      }
      if (url.searchParams.get("terminate_token") === `eq.${terminateToken}`) {
        return Response.json([session]);
      }
      if (url.searchParams.get("outcome_token") === `eq.${token}`) {
        return Response.json([session]);
      }
      return Response.json([]);
    }
    if (url.pathname.endsWith("/rpc/ingest_survey_event")) {
      return Response.json([{ session_id: "sess-1", event_id: "evt-1", created: true }]);
    }
    throw new Error(`Unexpected route: ${url.pathname}`);
  };

  try {
    // 1. Valid signed complete outcome using completeToken succeeds
    const validSig = await signOutcome(completeToken, "complete", secret);
    const validPath = `/r/outcome/${completeToken}/complete`;
    const res = await handleRedirectApi(
      new Request(`https://router.example${validPath}?sig=${validSig}`),
      validPath,
      env,
    );
    assert.equal(res?.status, 200);
    assert.match(await res.text(), /Survey completed/);

    // 2. Tampered signature on /complete is rejected with 403
    const badSigPath = `/r/outcome/${completeToken}/complete`;
    const badRes = await handleRedirectApi(
      new Request(`https://router.example${badSigPath}?sig=00000000000000000000000000000000`),
      badSigPath,
      env,
    );
    assert.equal(badRes?.status, 403);
    assert.match(await badRes.text(), /signature is invalid/);

    // 3. Changing /terminate signature to /complete is rejected with 403
    const termSig = await signOutcome(terminateToken, "terminate", secret);
    const stolenSigPath = `/r/outcome/${terminateToken}/complete`;
    const stolenRes = await handleRedirectApi(
      new Request(`https://router.example${stolenSigPath}?sig=${termSig}`),
      stolenSigPath,
      env,
    );
    assert.equal(stolenRes?.status, 403);

    // 4. Using terminateToken on /complete without valid complete signature is rejected
    const crossTokenPath = `/r/outcome/${terminateToken}/complete`;
    const crossRes = await handleRedirectApi(
      new Request(`https://router.example${crossTokenPath}`),
      crossTokenPath,
      env,
    );
    // complete_token=eq.terminateToken returns no rows -> 404
    assert.equal(crossRes?.status, 404);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

