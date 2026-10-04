import assert from "node:assert/strict";
import test from "node:test";
import { handleAssistantApi } from "../worker/routes/assistant.ts";

const request = (body) => new Request("https://example.test/api/assistant", { method: "POST", headers: { authorization: "Bearer header.payload.signature", "content-type": "application/json" }, body: JSON.stringify(body) });

test("admin copilot keeps the OpenAI key server-side and returns response text", async () => {
  const originalFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes("/rest/v1/organization_members")) return Response.json([{ organization_id: "org-1", role: "OWNER" }]);
    if (url === "https://api.openai.com/v1/responses") return Response.json({ output: [{ content: [{ type: "output_text", text: "Project audit is ready." }] }] });
    return new Response(null, { status: 404 });
  };
  try {
    const response = await handleAssistantApi(request({ question: "What is missing?", projects: [{ id: "ROP-1", name: "Study", status: "LIVE" }] }), "/api/assistant", { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "server-secret" });
    assert.equal(response.status, 200); const responseBody = await response.json(); assert.equal(responseBody.data.answer, "Project audit is ready.");
    const openai = calls.find((call) => call.url.includes("api.openai.com"));
    assert.equal(new Headers(openai.init.headers).get("authorization"), "Bearer server-secret");
    assert.equal(JSON.stringify(responseBody).includes("server-secret"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("copilot rejects non-admin workspace roles", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("/rest/v1/organization_members") ? Response.json([{ organization_id: "org-1", role: "PM" }]) : new Response(null, { status: 500 });
  try {
    const response = await handleAssistantApi(request({ question: "Audit", projects: [] }), "/api/assistant", { SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", OPENAI_API_KEY: "server-secret" });
    assert.equal(response.status, 403);
  } finally { globalThis.fetch = originalFetch; }
});
