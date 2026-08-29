import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.TEST_APP_URL;
const enabled = Boolean(baseUrl);
const run = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function call(path, { token, method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const data = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`);
  return data;
}

test("Supabase persists operational notifications and administrator rules", { skip: !enabled }, async () => {
  const signup = await call("/supabase/auth/v1/signup", { method: "POST", body: { email: `notifications-${run}@example.test`, password: "LocalNotice!2026" } });
  const token = signup.access_token;
  const organization = (await call("/api/organizations", { token, method: "POST", body: { name: `Notifications ${run}` } })).data;

  const client = (await call("/api/clients", { token, method: "POST", body: { name: `Notice Client ${run}`, code: `NC${Date.now()}` } })).data;
  assert.ok(client.id);
  const project = (await call("/api/projects", { token, method: "POST", body: { projectName: `Notice Project ${run}`, client: `Notice Client ${run}`, quota: 10, clientCpi: 5 } })).data;
  await call(`/api/projects/${project.id}/transitions`, { token, method: "POST", body: { status: "PENDING" } });
  await call(`/api/projects/${project.id}/transitions`, { token, method: "POST", body: { status: "LIVE" } });

  const rules = await call("/api/notification-rules", { token });
  assert.equal(rules.data.length, 7);
  const changed = rules.data.map((rule) => rule.eventType === "PACING_RISK" ? { ...rule, threshold: 75 } : rule);
  const saved = await call("/api/notification-rules", { token, method: "PUT", body: { rules: changed } });
  assert.equal(saved.data.find((rule) => rule.eventType === "PACING_RISK").threshold, 75);
  const persistedRules = await call("/api/notification-rules", { token });
  assert.equal(persistedRules.data.find((rule) => rule.eventType === "PACING_RISK").threshold, 75);

  const notifications = await call("/api/notifications", { token });
  assert.equal(notifications.meta.source, "supabase");
  const liveNotice = notifications.data.find((notice) => notice.eventType === "PROJECT_LIVE");
  assert.ok(liveNotice);
  const readNotice = await call(`/api/notifications/${liveNotice.id}`, { token, method: "PATCH", body: {} });
  assert.ok(readNotice.data.readAt);

  assert.ok(organization.id);
});
