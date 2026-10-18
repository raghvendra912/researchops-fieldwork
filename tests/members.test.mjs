import test from "node:test";
import assert from "node:assert/strict";
import { handleMembersApi } from "../worker/routes/members.ts";

const env = { SUPABASE_URL: "https://db.example.test", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };

test("organization member administration is restricted to admins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("organization_members")
    ? Response.json([{ organization_id: "org-1", role: "PM" }])
    : new Response(null, { status: 500 });
  try {
    const response = await handleMembersApi(new Request("https://app.test/api/organization-members", { headers: { authorization: "Bearer x.eyJzdWIiOiJ1LTEifQ.x" } }), "/api/organization-members", env);
    assert.equal(response.status, 403);
  } finally { globalThis.fetch = originalFetch; }
});

test("admin cannot grant the ADMIN role", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("organization_members")
    ? Response.json([{ organization_id: "org-1", role: "ADMIN" }])
    : new Response(null, { status: 500 });
  try {
    const request = new Request("https://app.test/api/organization-members", { method: "POST", headers: { authorization: "Bearer x.eyJzdWIiOiJhZG1pbi0xIn0.x", "content-type": "application/json" }, body: JSON.stringify({ displayName: "New Admin", email: "new@example.com", role: "ADMIN" }) });
    const response = await handleMembersApi(request, "/api/organization-members", env);
    assert.equal(response.status, 400);
  } finally { globalThis.fetch = originalFetch; }
});

test("demo member administration exposes organization roles", async () => {
  const response = await handleMembersApi(new Request("https://app.test/api/organization-members"), "/api/organization-members", {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.meta.role, "OWNER");
  assert.deepEqual(body.data.map((member) => member.role), ["OWNER", "PM"]);
});
