import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { registerHooks } from "node:module";

// Resolve extensionless Worker imports when running source TypeScript in Node.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
  return nextResolve(specifier, context);
} });
const domain = await import("../worker/domain/marketplace.ts");
const { adapterFor, marketplaceAdapters } = await import("../worker/providers/marketplace.ts");

const hmac = (algorithm, secret, value) => createHmac(algorithm, secret).update(value).digest("hex");

test("inventory feeds from different marketplaces normalise to one shape", () => {
  const { surveys, errors } = domain.parseInventory({ data: [
    { survey_id: 1001, name: "Wallet study", price: "$2.50", country: "in", language: "EN", loi: "10 ", ir: "38%", conversion: 52, remaining: "240", state: "Live", url: "https://panel.example.com/s?id=1&uid={{respondent_id}}", targeting: [{ question: "AGE", operator: "between", values: [25, 54] }, { id: "GENDER", value: "2" }] },
    { id: "S-2", title: "Streaming", cpi: 1.1, status: "full" },
  ] });
  assert.deepEqual(errors, []);
  assert.equal(surveys.length, 2);
  const [first, second] = surveys;
  assert.equal(first.external_id, "1001");
  assert.equal(first.cpi, 2.5);
  assert.equal(first.country_code, "IN");
  assert.equal(first.language_code, "en");
  assert.equal(first.loi_minutes, 10);
  assert.equal(first.incidence_pct, 38);
  assert.equal(first.quota_remaining, 240);
  assert.equal(first.status, "OPEN");
  assert.deepEqual(first.qualifications, [{ code: "AGE", operator: "BETWEEN", values: ["25", "54"] }, { code: "GENDER", values: ["2"] }]);
  assert.equal(second.status, "CLOSED");
  assert.equal(second.country_code, undefined);
});

test("bad rows are reported individually and never half-imported", () => {
  const { surveys, errors } = domain.parseInventory([
    { id: "ok", title: "Fine", cpi: 1 },
    { id: "neg", title: "Negative", cpi: -1 },
    { id: "pct", title: "Bad percent", cpi: 1, incidence: 140 },
    { id: "url", title: "Bad link", cpi: 1, url: "javascript:alert(1)" },
    { id: "ctry", title: "Bad country", cpi: 1, country: "USA" },
    { id: "ok", title: "Duplicate", cpi: 2 },
    { title: "No id", cpi: 1 },
    "not an object",
  ]);
  assert.deepEqual(surveys.map((survey) => survey.external_id), ["ok"]);
  assert.equal(errors.length, 7);
  assert.match(errors.join("\n"), /duplicate survey id/);
  assert.match(errors.join("\n"), /entry URL must be an http\(s\) link/);
  assert.deepEqual(domain.parseInventory("nope").errors, ["Expected a list of surveys"]);
  assert.match(domain.parseInventory(new Array(501).fill({ id: "x", title: "t", cpi: 1 })).errors[0], /at most 500/);
});

test("CSV inventory handles quotes, commas, BOM, CRLF and embedded JSON", () => {
  const csv = '﻿id,title,country,cpi,url,qualifications\r\nA-1,"Study, with comma",us,"1,250.50",https://p.example/s?x=1,"[{""code"":""AGE"",""values"":[""18""]}]"\r\nA-2,"Say ""hi""",in,3,,\r\n';
  const { surveys, errors } = domain.parseCsvInventory(csv);
  assert.deepEqual(errors, []);
  assert.equal(surveys.length, 2);
  assert.equal(surveys[0].title, "Study, with comma");
  assert.equal(surveys[0].cpi, 1250.5);
  assert.deepEqual(surveys[0].qualifications, [{ code: "AGE", values: ["18"] }]);
  assert.equal(surveys[1].title, 'Say "hi"');
  assert.equal(surveys[1].entry_url, undefined);
});

test("earnings per click uses conversion, labels incidence as a ceiling, and never invents a figure", () => {
  assert.deepEqual(domain.estimateEarningsPerClick({ cpi: 2, conversionPct: 50 }), { value: 1, basis: "conversion" });
  assert.deepEqual(domain.estimateEarningsPerClick({ cpi: 2, conversionPct: 50, incidencePct: 90 }), { value: 1, basis: "conversion" });
  assert.deepEqual(domain.estimateEarningsPerClick({ cpi: 2, incidencePct: 25 }), { value: 0.5, basis: "incidence-ceiling" });
  assert.deepEqual(domain.estimateEarningsPerClick({ cpi: 2 }), { value: null, basis: null });
  assert.equal(domain.marginPerComplete(3, 1.8), 1.2);
  assert.equal(domain.marginPct(3, 1.8), 40);
  assert.equal(domain.marginPct(0, 0), null);
});

test("entry links are signed with an HMAC of the URL and tampering is detected", async () => {
  const secret = "marketplace-secret";
  const url = "https://panel.example.com/s?id=1&uid=abc";
  const signed = await domain.signEntryUrl(url, secret);
  const parsed = new URL(signed);
  assert.equal(parsed.searchParams.get("hash"), hmac("sha256", secret, new URL(url).toString()));
  assert.equal(await domain.verifyEntryUrl(signed, secret), true);
  assert.equal(await domain.verifyEntryUrl(signed.replace("uid=abc", "uid=abd"), secret), false);
  assert.equal(await domain.verifyEntryUrl(signed, "other-secret"), false);
  assert.equal(await domain.verifyEntryUrl(url, secret), false, "an unsigned link must not verify");

  const resigned = await domain.signEntryUrl(`${url}&hash=forged`, secret);
  assert.equal(new URL(resigned).searchParams.getAll("hash").length, 1);
  assert.equal(new URL(resigned).searchParams.get("hash"), new URL(signed).searchParams.get("hash"), "a pre-existing hash cannot influence the signature");

  const sha1 = await domain.signEntryUrl(url, secret, { param: "sig", algorithm: "SHA-1" });
  assert.equal(new URL(sha1).searchParams.get("sig"), hmac("sha1", secret, new URL(url).toString()));
  const fallback = await domain.signEntryUrl(url, secret, { param: "bad name!" });
  assert.ok(new URL(fallback).searchParams.has("hash"), "an unsafe parameter name falls back to hash");
});

test("only MARKETPLACE_*_SECRET names may be read from the server environment", () => {
  assert.equal(domain.isValidSecretEnvName("MARKETPLACE_CINT_SECRET"), true);
  assert.equal(domain.isValidSecretEnvName("MARKETPLACE_A1_B2_SECRET"), true);
  for (const name of ["SUPABASE_SERVICE_ROLE_KEY", "marketplace_cint_secret", "MARKETPLACE_SECRET", "MARKETPLACE_CINT_SECRET_EXTRA", "", undefined, 7]) {
    assert.equal(domain.isValidSecretEnvName(name), false, String(name));
  }
});

test("marketplace confirmations map to ledger actions and reject unknown input", () => {
  const confirmed = "11111111-1111-4111-8111-111111111111";
  const reversed = "22222222-2222-4222-8222-222222222222";
  const { actions, errors } = domain.parseConfirmations({ events: [
    { transaction_id: confirmed, status: "Approved" },
    { rid: reversed.toUpperCase(), status: "rejected", reason: "Quality" },
    { transaction_id: "not-a-uuid", status: "approved" },
    { transaction_id: confirmed, status: "weird" },
  ] });
  assert.deepEqual(actions, [{ sessionId: confirmed, action: "CONFIRM" }, { sessionId: reversed, action: "REVERSE", reason: "Quality" }]);
  assert.equal(errors.length, 2);
  assert.deepEqual(domain.parseConfirmations({}).errors, ["Expected a list of events"]);
});

test("provider adapters share generic behaviour and fall back for unknown providers", async () => {
  assert.equal(adapterFor("CINT").provider, "CINT");
  assert.equal(adapterFor("nonsense").provider, "GENERIC");
  assert.deepEqual(Object.keys(marketplaceAdapters).sort(), ["CINT", "DYNATA", "GENERIC", "OTHER", "PURESPECTRUM", "TOLUNA"]);
  const adapter = adapterFor("GENERIC");
  assert.equal(adapter.parseInventory({ format: "json", data: '[{"id":"a","title":"t","cpi":1}]' }).surveys.length, 1);
  assert.match(adapter.parseInventory({ format: "json", data: "{oops" }).errors[0], /not valid JSON/);
  assert.match(adapter.parseInventory({ format: "csv", data: ["x"] }).errors[0], /CSV data must be text/);
  const url = "https://panel.example.com/s?id=1";
  assert.equal(await adapter.buildEntryUrl(url, {}, "secret"), url, "signing is off by default");
  await assert.rejects(adapter.buildEntryUrl(url, { entrySigning: { enabled: true } }, undefined), /secret is not configured/);
  const signed = await adapter.buildEntryUrl(url, { entrySigning: { enabled: true, param: "h" } }, "secret");
  assert.equal(await domain.verifyEntryUrl(signed, "secret", { param: "h" }), true);
});
