import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { parseFraudFilters, buildFraudFlagsPath, fraudFiltersToQuery, safeEvidence, evidenceSummary, heldAge, heldQueueFilters, isHoldingRule, filterableRuleCodes } = await import("../src/features/fraud/fraud-filters.ts");
const { fraudRuleInfo, holdingRuleCodes } = await import("../src/features/clients/return-signing.ts");
const { handleFraudApi } = await import("../worker/routes/fraud.ts");
const component = await readFile(new URL("../app/components/FraudReview.tsx", import.meta.url), "utf8");

const parse = (query) => parseFraudFilters(new URLSearchParams(query));

test("no filters keeps the original query shape", () => {
  const path = buildFraudFlagsPath(parse(""));
  assert.equal(path, "/rest/v1/fraud_flags?select=id,rule_code,severity,status,evidence,created_at,survey_sessions(respondent_ref,project_suppliers(suppliers(name)),projects(project_code,project_name))&order=created_at.desc&limit=100");
  assert.equal(fraudFiltersToQuery(parse("")), "");
});

test("valid filters are normalised and built into PostgREST in() lists", () => {
  const filters = parse("ruleCode=speeding,UNVERIFIED_RETURN&ruleCode=HOSTING_ASN&status=open&projectCode=prj-1048");
  assert.deepEqual(filters, { ruleCodes: ["SPEEDING", "UNVERIFIED_RETURN", "HOSTING_ASN"], statuses: ["OPEN"], projectCode: "PRJ-1048" });
  const path = buildFraudFlagsPath(filters);
  assert.match(path, /&rule_code=in\.\(SPEEDING,UNVERIFIED_RETURN,HOSTING_ASN\)/);
  assert.match(path, /&status=in\.\(OPEN\)/);
  assert.match(path, /survey_sessions!inner\(.*projects!inner\(/);
  assert.match(path, /&survey_sessions\.projects\.project_code=eq\.PRJ-1048&/);
});

test("injection attempts and unknown values are ignored", () => {
  const attempts = [
    "ruleCode=SPEEDING,or=(status.eq.OPEN)",
    "ruleCode=SPEEDING)&select=*",
    "status=eq.OPEN&select=*",
    "status=OPEN,or=(id.neq.0)",
    "projectCode=PRJ-1);drop",
    "projectCode=PRJ-1&select=*",
    "projectCode=a,b",
    "ruleCode=constructor,__proto__,*",
  ];
  for (const attempt of attempts) {
    const path = buildFraudFlagsPath(parse(attempt));
    assert.doesNotMatch(path, /or=|select=\*|drop|\*|;|constructor|__proto__/i, attempt);
    assert.equal(path.match(/select=/g).length, 1, attempt);
    assert.equal(path.match(/\?/g).length, 1, attempt);
  }
  assert.deepEqual(parse("ruleCode=SPEEDING,or=(status.eq.OPEN)").ruleCodes, ["SPEEDING"]);
  assert.deepEqual(parse("status=eq.OPEN&select=*").statuses, []);
  assert.equal(parse("projectCode=PRJ-1);drop").projectCode, "");
  assert.equal(parse(`projectCode=${"A".repeat(41)}`).projectCode, "");
});

test("every filterable rule code has a friendly label", () => {
  for (const code of filterableRuleCodes) assert.notEqual(fraudRuleInfo(code).explain, "", code);
  assert.deepEqual(filterableRuleCodes.map((code) => fraudRuleInfo(code).label), ["Speeding", "Unverified return", "No client hand-off", "Duplicate IP", "Duplicate device", "Quality violation", "Hosting network"]);
});

test("holding rules are exactly the three that remove a complete; advisory rules do not hold", () => {
  assert.deepEqual([...holdingRuleCodes].sort(), ["NO_CLIENT_REACH", "SPEEDING", "UNVERIFIED_RETURN"]);
  for (const code of holdingRuleCodes) assert.equal(fraudRuleInfo(code).holds, true, code);
  for (const code of ["HOSTING_ASN", "DUPLICATE_IP", "DUPLICATE_DEVICE", "QUALITY_VIOLATION"]) { assert.equal(fraudRuleInfo(code).holds, false, code); assert.equal(isHoldingRule(code), false, code); }
  assert.deepEqual(heldQueueFilters.statuses, ["OPEN"]);
  assert.deepEqual(heldQueueFilters.ruleCodes, holdingRuleCodes);
});

test("evidence shown to operators never includes hashes or addresses", () => {
  const evidence = { durationSeconds: 42, minimumSeconds: 60, reason: "complete without a recorded client hand-off", ipHash: "abc", deviceHash: "def", ip: "1.2.3.4", nested: { a: 1 } };
  assert.deepEqual(Object.keys(safeEvidence(evidence)).sort(), ["durationSeconds", "minimumSeconds", "reason"]);
  assert.doesNotMatch(evidenceSummary(evidence), /abc|def|1\.2\.3\.4/);
  assert.match(evidenceSummary(evidence), /Finished in \(s\): 42 · Minimum \(s\): 60/);
  assert.deepEqual(safeEvidence(null), {});
  assert.deepEqual(safeEvidence([1]), {});
});

test("held age is plain language", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  assert.equal(heldAge("2026-11-02T11:59:50Z", now), "Just now");
  assert.equal(heldAge("2026-11-02T11:15:00Z", now), "45 min");
  assert.equal(heldAge("2026-11-02T07:00:00Z", now), "5 h");
  assert.equal(heldAge("2026-10-30T12:00:00Z", now), "3 days");
  assert.equal(heldAge(undefined, now), "Unknown");
  assert.equal(heldAge("not a date", now), "Unknown");
});

test("the API applies filters in demo mode and ignores hostile values", async () => {
  const get = async (query) => (await handleFraudApi(new Request(`http://localhost/api/fraud-flags${query}`), "/api/fraud-flags", {})).json();
  assert.equal((await get("")).data.length, 1);
  assert.equal((await get("?ruleCode=SPEEDING&status=OPEN")).data.length, 1);
  assert.equal((await get("?ruleCode=HOSTING_ASN")).data.length, 0);
  assert.equal((await get("?status=CONFIRMED")).data.length, 0);
  assert.equal((await get("?projectCode=PRJ-9999")).data.length, 0);
  assert.equal((await get(`?ruleCode=${encodeURIComponent("SPEEDING,or=(id.neq.0)")}`)).data.length, 1);
  assert.equal((await get(`?status=${encodeURIComponent("eq.OPEN&select=*")}`)).data.length, 1);
});

test("the API sends the validated filter path with the caller's bearer token", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    return Response.json(String(url).includes("organization_members") ? [{ organization_id: "o", role: "ADMIN" }] : []);
  };
  try {
    const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
    const request = new Request("http://localhost/api/fraud-flags?ruleCode=SPEEDING,or=(a.eq.1)&status=OPEN", { headers: { authorization: "Bearer user-token" } });
    await handleFraudApi(request, "/api/fraud-flags", env);
    const flagCall = calls.find((call) => call.url.includes("/rest/v1/fraud_flags"));
    assert.ok(flagCall, "fraud_flags query was issued");
    {
      assert.match(flagCall.url, /rule_code=in\.\(SPEEDING\)/);
      assert.doesNotMatch(flagCall.url, /or=/);
      assert.equal(flagCall.auth, "Bearer user-token");
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("the Fraud review page wires the held queue, filters and guarded actions", () => {
  assert.match(component, /Held completes/);
  assert.match(component, /role="tablist"/);
  assert.match(component, /heldQueueFilters/);
  assert.match(component, /filterableRuleCodes\.map/);
  assert.match(component, /filterableStatuses\.map/);
  assert.match(component, /fraudFiltersToQuery/);
  assert.match(component, /Release/);
  assert.match(component, /Reject/);
  assert.match(component, /Yes, release/);
  assert.match(component, /Yes, reject/);
  assert.match(component, /canOperate && flag\.canReview !== false/);
  assert.match(component, /audit log/);
  assert.match(component, /evidenceSummary/);
  assert.doesNotMatch(component, /Object\.entries\(flag\.evidence\)/);
  assert.doesNotMatch(component, /ipHash|deviceHash/);
});
