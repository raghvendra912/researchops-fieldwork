import assert from "node:assert/strict";
import test from "node:test";

import { handleResponseVariablesApi } from "../worker/routes/response-variables.ts";
import { handleRespondentsApi } from "../worker/routes/respondents.ts";

const request = (path, init = {}) => new Request(`http://localhost${path}`, init);

test("response-variable configuration is available in local/demo mode", async () => {
  const response = await handleResponseVariablesApi(
    request("/api/projects/PRJ-1048/response-variables"),
    "/api/projects/PRJ-1048/response-variables",
    {},
  );
  assert.equal(response?.status, 200);
  const payload = await response.json();
  assert.equal(payload.meta.canOperate, true);
  assert.equal(payload.data[0].variableKey, "age");
});

test("response-variable configuration validates and normalizes its allowlist", async () => {
  const response = await handleResponseVariablesApi(
    request("/api/projects/PRJ-1048/response-variables", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variables: [{ variableKey: "Household_Size", label: "Household size", dataClassification: "demographic", retentionDays: 180, active: true }] }),
    }),
    "/api/projects/PRJ-1048/response-variables",
    {},
  );
  assert.equal(response?.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.data[0], { variableKey: "household_size", label: "Household size", dataClassification: "DEMOGRAPHIC", retentionDays: 180, active: true });
});

test("response-variable configuration rejects duplicate or unsafe definitions", async () => {
  const response = await handleResponseVariablesApi(
    request("/api/projects/PRJ-1048/response-variables", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variables: [{ variableKey: "age", label: "Age" }, { variableKey: "AGE", label: "Duplicate" }] }),
    }),
    "/api/projects/PRJ-1048/response-variables",
    {},
  );
  assert.equal(response?.status, 400);
});

test("respondent intelligence and separate review workflow are available in demo mode", async () => {
  const listResponse = await handleRespondentsApi(request("/api/respondents?export=1"), "/api/respondents", {});
  assert.equal(listResponse?.status, 200);
  const list = await listResponse.json();
  assert.equal(list.meta.canReview, true);
  assert.equal(list.meta.truncated, false);
  assert.equal(list.data[0].respondentRef, "RESP-78291");

  const byInternalId = await handleRespondentsApi(request("/api/respondents?q=session-demo-1"), "/api/respondents", {});
  assert.equal((await byInternalId.json()).data[0].id, "session-demo-1");

  const reviewResponse = await handleRespondentsApi(
    request("/api/respondents/session-demo-1/review", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewType: "VENDOR", status: "DISPUTED", note: "Supplier reconciliation" }),
    }),
    "/api/respondents/session-demo-1/review",
    {},
  );
  assert.equal(reviewResponse?.status, 200);
  const review = await reviewResponse.json();
  assert.equal(review.data.id, "session-demo-1");
});
