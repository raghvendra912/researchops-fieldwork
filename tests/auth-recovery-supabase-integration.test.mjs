import assert from "node:assert/strict";
import test from "node:test";

const url = process.env.TEST_SUPABASE_URL;
const anonKey = process.env.TEST_SUPABASE_ANON_KEY;
const serviceKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && anonKey && serviceKey);

async function call(path, { token = anonKey, apikey = anonKey, method = "GET", body } = {}) {
  const response = await fetch(`${url}${path}`, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: { apikey, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

test("local Supabase completes a disposable password recovery lifecycle", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `recovery-${suffix}@example.test`;
  const originalPassword = "RecoveryBefore!2026";
  const replacementPassword = "RecoveryAfter!2026";
  let userId;

  try {
    const created = await call("/auth/v1/admin/users", {
      token: serviceKey, apikey: serviceKey, method: "POST",
      body: { email, password: originalPassword, email_confirm: true },
    });
    assert.equal(created.response.status, 200, JSON.stringify(created.data));
    userId = created.data.id;

    const generated = await call("/auth/v1/admin/generate_link", {
      token: serviceKey, apikey: serviceKey, method: "POST",
      body: { type: "recovery", email, redirect_to: "http://127.0.0.1:3010/reset-password" },
    });
    assert.equal(generated.response.status, 200, JSON.stringify(generated.data));
    assert.ok(generated.data.hashed_token);

    const verified = await call("/auth/v1/verify", {
      method: "POST", body: { type: "recovery", token_hash: generated.data.hashed_token },
    });
    assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
    assert.ok(verified.data.access_token);

    const updated = await call("/auth/v1/user", {
      token: verified.data.access_token, method: "PUT", body: { password: replacementPassword },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.data));

    const login = await call("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email, password: replacementPassword },
    });
    assert.equal(login.response.status, 200, JSON.stringify(login.data));
    assert.equal(login.data.user.email, email);

    const replay = await call("/auth/v1/verify", {
      method: "POST", body: { type: "recovery", token_hash: generated.data.hashed_token },
    });
    assert.ok([400, 403].includes(replay.response.status), JSON.stringify(replay.data));
  } finally {
    if (userId) {
      const removed = await call(`/auth/v1/admin/users/${userId}`, { token: serviceKey, apikey: serviceKey, method: "DELETE" });
      assert.equal(removed.response.status, 200, JSON.stringify(removed.data));
    }
  }
});
