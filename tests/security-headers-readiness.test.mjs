import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { trackError } = await import("../worker/lib/observability.ts");
const { requestSizeError, validateRequestSize } = await import("../worker/lib/security.ts");
const nextConfig = (await import("../next.config.ts")).default;

test("next.config.ts and vercel.json configure comprehensive security headers", async () => {
  // Verify next.config.ts headers function
  assert.equal(typeof nextConfig.headers, "function");
  const headersConfig = await nextConfig.headers();
  assert.ok(headersConfig.length > 0);
  const routeHeaders = headersConfig[0].headers;

  const headerNames = routeHeaders.map((h) => h.key.toLowerCase());
  assert.ok(headerNames.includes("x-frame-options"));
  assert.ok(headerNames.includes("x-content-type-options"));
  assert.ok(headerNames.includes("referrer-policy"));
  assert.ok(headerNames.includes("permissions-policy"));

  // Verify vercel.json headers
  const vercelJson = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(vercelJson.headers));
  const vercelHeaders = vercelJson.headers[0].headers.map((h) => h.key.toLowerCase());
  assert.ok(vercelHeaders.includes("x-frame-options"));
  assert.ok(vercelHeaders.includes("x-content-type-options"));
});

test("request size validation rejects payloads exceeding 1MB", async () => {
  const smallReq = new Request("https://example.com/api/test", {
    method: "POST",
    headers: { "content-length": "100" },
    body: "hello",
  });
  const smallResult = await validateRequestSize(smallReq, 1024);
  assert.equal(smallResult.valid, true);

  const largeReq = new Request("https://example.com/api/test", {
    method: "POST",
    headers: { "content-length": "2097152" },
  });
  const largeResult = await validateRequestSize(largeReq, 1048576);
  assert.equal(largeResult.valid, false);

  const errResponse = requestSizeError();
  assert.equal(errResponse.status, 413);
  const errJson = await errResponse.json();
  assert.match(errJson.error, /too large/i);
});

test("trackError captures error details without throwing", async () => {
  // Should not throw even with mock webhook error
  await trackError(
    new Error("Test failure"),
    { path: "/api/test", method: "GET" },
    { ERROR_WEBHOOK_URL: "https://invalid-non-existent-domain.test/webhook" }
  );
  // Reaches here cleanly
  assert.ok(true);
});

