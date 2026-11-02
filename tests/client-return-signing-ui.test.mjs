import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { isValidSecretName, validateSigning, signingErrorMessage, fraudRuleInfo, humanizeRuleCode, policyOptions } = await import("../src/features/clients/return-signing.ts");
const component = await readFile(new URL("../app/components/ClientReturnSigning.tsx", import.meta.url), "utf8");
const directory = await readFile(new URL("../app/components/DirectoryPage.tsx", import.meta.url), "utf8");
const fraud = await readFile(new URL("../app/components/FraudReview.tsx", import.meta.url), "utf8");

test("secret variable name validator matches the server pattern", () => {
  for (const ok of ["CLIENT_ACME_SECRET", "CLIENT_A1_B2_SECRET"]) assert.equal(isValidSecretName(ok), true, ok);
  for (const bad of ["", "client_acme_secret", "CLIENT__SECRET", "CLIENT_ACME", "ACME_SECRET", "CLIENT_ACME-X_SECRET", `CLIENT_${"A".repeat(41)}_SECRET`, "CLIENT_ACME_SECRET\n"]) assert.equal(isValidSecretName(bad), false, JSON.stringify(bad));
});

test("validateSigning requires a valid name for HOLD and REJECT only", () => {
  assert.equal(validateSigning("OFF", ""), "");
  assert.equal(validateSigning("OFF", "CLIENT_X_SECRET"), "");
  assert.notEqual(validateSigning("HOLD", ""), "");
  assert.notEqual(validateSigning("REJECT", "nope"), "");
  assert.equal(validateSigning("REJECT", " CLIENT_X_SECRET "), "");
  assert.deepEqual(policyOptions.map((option) => option.value), ["OFF", "HOLD", "REJECT"]);
});

test("signing errors are calm and never expose raw technical text", () => {
  assert.match(signingErrorMessage(501), /database update/i);
  assert.doesNotMatch(signingErrorMessage(501), /migration|055|PostgREST/i);
  assert.match(signingErrorMessage(502), /try again/i);
});

test("fraud rule labels cover the new codes and fall back to a humanized label", () => {
  assert.equal(fraudRuleInfo("UNVERIFIED_RETURN").explain, "Complete arrived without the client's signature.");
  assert.equal(fraudRuleInfo("NO_CLIENT_REACH").explain, "Complete without a recorded hand-off to the client.");
  assert.equal(fraudRuleInfo("UNVERIFIED_RETURN").holds, true);
  assert.equal(fraudRuleInfo("NO_CLIENT_REACH").holds, true);
  assert.equal(fraudRuleInfo("SPEEDING").label, "Speeding");
  assert.equal(fraudRuleInfo("SPEEDING").holds, true);
  assert.equal(fraudRuleInfo("HOSTING_ASN").holds, false);
  assert.equal(fraudRuleInfo("SOME_NEW_RULE").label, "Some new rule");
  assert.equal(fraudRuleInfo("constructor").label, "Constructor");
  assert.equal(humanizeRuleCode(""), "Unknown rule");
});

test("UI is wired and never handles a secret value", () => {
  assert.match(directory, /<ClientReturnSigning /);
  assert.match(directory, /canOperate/);
  assert.match(component, /\/return-signing/);
  assert.match(component, /Secret found on the server/);
  assert.match(component, /Secret NOT configured/);
  assert.match(component, /x-researchops-signature/);
  assert.match(component, /hosting environment variables/);
  assert.doesNotMatch(component, /type="password"|signingSecret\b|secretValue/);
  assert.match(fraud, /hold the complete out of valid delivery/);
  assert.match(fraud, /fraudRuleInfo/);
});
