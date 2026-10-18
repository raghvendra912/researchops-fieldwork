import test from "node:test";
import assert from "node:assert/strict";
import { handleScreeningQuestionsApi } from "../worker/routes/screening-questions.ts";

test("screening question workflow accepts up to five typed questions", async () => {
  const request = new Request("https://app.test/api/projects/ROP-1/screening-questions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ questions: [{ question: "Are you responsible for purchases?", answerType: "BOOLEAN" }] }) });
  const response = await handleScreeningQuestionsApi(request, "/api/projects/ROP-1/screening-questions", {});
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, [{ question: "Are you responsible for purchases?", answerType: "BOOLEAN" }]);
});

test("screening question workflow rejects invalid and oversized sets", async () => {
  const questions = Array.from({ length: 6 }, (_, index) => ({ question: `Question ${index}`, answerType: "TEXT" }));
  const request = new Request("https://app.test/api/projects/ROP-1/screening-questions", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ questions }) });
  const response = await handleScreeningQuestionsApi(request, "/api/projects/ROP-1/screening-questions", {});
  assert.equal(response.status, 400);
});
