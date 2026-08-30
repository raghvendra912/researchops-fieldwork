import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function request(path, init = {}, environment = {}) {
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost" + path, { ...init, headers: { accept: "text/html", ...init.headers } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...environment },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the ResearchOps Project Center", async () => {
  const response = await request("/projects");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Project Center · ResearchOps<\/title>/i);
  assert.match(html, /Project Center/);
  assert.match(html, /Checking your workspace session/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders the protected operational dashboard shell",async()=>{const response=await request("/dashboard");assert.equal(response.status,200);const html=await response.text();assert.match(html,/Checking your workspace session/i);assert.match(html,/Dashboard/)});

test("server-renders password recovery routes without account disclosure", async () => {
  const requestPage = await request("/forgot-password");
  assert.equal(requestPage.status, 200);
  const requestHtml = await requestPage.text();
  assert.match(requestHtml, /Reset your password/i);
  assert.match(requestHtml, /Account recovery/i);

  const updatePage = await request("/reset-password");
  assert.equal(updatePage.status, 200);
  const updateHtml = await updatePage.text();
  assert.match(updateHtml, /Choose a new password/i);
  assert.match(updateHtml, /Secure recovery/i);
});

test("server-renders email OTP signup", async () => {
  const response = await request("/signup");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Create your workspace account/i);
  assert.match(html, /email.*one-time code/i);
});

test("server-renders persistent directory surfaces", async () => {
  const clients = await request("/clients");
  assert.equal(clients.status, 200);
  assert.match(await clients.text(), /Checking your workspace session/i);
  const suppliers = await request("/suppliers");
  assert.equal(suppliers.status, 200);
  assert.match(await suppliers.text(), /Checking your workspace session/i);
  const fraud = await request("/fraud");
  assert.equal(fraud.status, 200);
  assert.match(await fraud.text(), /Checking your workspace session/i);
  const notificationsPage = await request("/notifications");
  assert.equal(notificationsPage.status, 200);
  assert.match(await notificationsPage.text(), /Checking your workspace session/i);
});

test("serves Worker health and project APIs", async () => {
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "healthy");

  const projects = await request("/api/projects");
  assert.equal(projects.status, 200);
  const body = await projects.json();
  assert.ok(body.data.length >= 3);
  assert.equal(body.data[0].id, "PRJ-1048");
  assert.equal(body.meta.source, "mock");
  assert.equal(body.meta.canOperate, true);

  const filteredProjects = await request("/api/projects?status=LIVE&page=1&pageSize=2&sortBy=code&sortDirection=asc");
  assert.equal(filteredProjects.status, 200);
  const filteredBody = await filteredProjects.json();
  assert.equal(filteredBody.meta.total, 4);
  assert.equal(filteredBody.meta.totalPages, 2);
  assert.deepEqual(filteredBody.data.map((project) => project.id), ["PRJ-1043", "PRJ-1045"]);

  const searchedProjects = await request("/api/projects?q=Northstar&page=2&pageSize=1");
  assert.equal(searchedProjects.status, 200);
  const searchedBody = await searchedProjects.json();
  assert.equal(searchedBody.meta.total, 2);
  assert.equal(searchedBody.data[0].id, "PRJ-1042");

  const created = await request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName: "API smoke project", client: "Northstar Bank", quota: 100, clientCpi: 8.5 }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).data.status, "PENDING");

  for (const invalidProject of [
    { projectName: "Fractional quota", client: "Northstar Bank", quota: 1.5, clientCpi: 8.5 },
    { projectName: "Invalid LOI", client: "Northstar Bank", quota: 100, clientCpi: 8.5, loi: 0 },
    { projectName: "Invalid incidence", client: "Northstar Bank", quota: 100, clientCpi: 8.5, incidence: 101 },
    { projectName: "Invalid survey", client: "Northstar Bank", quota: 100, clientCpi: 8.5, surveyUrl: "javascript:alert(1)" },
    { projectName: "Invalid security redirect", client: "Northstar Bank", quota: 100, clientCpi: 8.5, securityTerminateUrl: "ftp://unsafe.example" },
  ]) {
    const rejectedProject = await request("/api/projects", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invalidProject),
    });
    assert.equal(rejectedProject.status, 400);
  }

  const updated = await request("/api/projects/PRJ-1048", {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectName: "Updated Wallet Study", clientPo: "PO-2", type: "B2C", category: "Financial Technology", quota: 600, clientCpi: 9.25, endDate: "2026-09-20", surveyUrl: "https://survey.example/start" }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.name, "Updated Wallet Study");

  const transitioned = await request("/api/projects/PRJ-1046/transitions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "LIVE" }) });
  assert.equal(transitioned.status, 200);
  assert.equal((await transitioned.json()).data.status, "LIVE");
  const rejectedTransition = await request("/api/projects/PRJ-1046/transitions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "PENDING" }) });
  assert.equal(rejectedTransition.status, 409);

  const markets = await request("/api/projects/PRJ-1048/markets");
  assert.equal(markets.status, 200);
  assert.equal((await markets.json()).data[0].countryCode, "IN");
  const marketsUpdated = await request("/api/projects/PRJ-1048/markets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markets: [{ countryCode: "US", languageCode: "en", targetQuota: 250, expectedLoiMinutes: 12, expectedIr: 42.5 }, { countryCode: "CA", languageCode: "fr", targetQuota: 150, expectedLoiMinutes: 10, expectedIr: 38 }] }) });
  assert.equal(marketsUpdated.status, 200);
  assert.equal((await marketsUpdated.json()).data.length, 2);
  const duplicateMarkets = await request("/api/projects/PRJ-1048/markets", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ markets: [{ countryCode: "US", languageCode: "en", targetQuota: 100, expectedLoiMinutes: 10, expectedIr: 40 }, { countryCode: "US", languageCode: "en", targetQuota: 100, expectedLoiMinutes: 10, expectedIr: 40 }] }) });
  assert.equal(duplicateMarkets.status, 400);

  const assignments = await request("/api/projects/PRJ-1048/suppliers");
  assert.equal(assignments.status, 200);
  assert.equal((await assignments.json()).data[0].supplierName, "CPX Research");
  const assignmentsUpdated = await request("/api/projects/PRJ-1048/suppliers", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ assignments: [{ supplierId: "supplier-cpx", supplierProjectId: "CPX-NEW", supplierCpi: 7.75, targetQuota: 300, status: "ACTIVE" }] }) });
  assert.equal(assignmentsUpdated.status, 200);
  assert.equal((await assignmentsUpdated.json()).data[0].targetQuota, 300);

  const eventBody = JSON.stringify({ organizationId: "00000000-0000-4000-8000-000000000001", projectCode: "PRJ-1048", respondentRef: "respondent-1", eventType: "START", providerTransactionId: "txn-1" });
  const eventTimestamp = String(Math.floor(Date.now() / 1000));
  const eventSignature = createHmac("sha256", "test-event-secret").update(`${eventTimestamp}.${eventBody}`).digest("hex");
  const ingested = await request("/api/events", { method: "POST", headers: { "content-type": "application/json", "x-researchops-timestamp": eventTimestamp, "x-researchops-signature": eventSignature }, body: eventBody }, { EVENT_INGESTION_SECRET: "test-event-secret" });
  assert.equal(ingested.status, 202);
  assert.equal((await ingested.json()).data.eventType, "START");
  const unsigned = await request("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: eventBody }, { EVENT_INGESTION_SECRET: "test-event-secret" });
  assert.equal(unsigned.status, 401);

  for (const provider of ["cpx", "bitlabs", "purespectrum"]) {
    const callbackBody = JSON.stringify({ organizationId: "00000000-0000-4000-8000-000000000001", projectCode: "PRJ-1048", respondentRef: `${provider}-respondent`, disposition: "complete", transactionId: `${provider}-txn` });
    const callbackTimestamp = String(Math.floor(Date.now() / 1000));
    const secret = `${provider}-test-secret`;
    const callbackSignature = createHmac("sha256", secret).update(`${callbackTimestamp}.${callbackBody}`).digest("hex");
    const key = provider === "cpx" ? "CPX_CALLBACK_SECRET" : provider === "bitlabs" ? "BITLABS_CALLBACK_SECRET" : "PURESPECTRUM_CALLBACK_SECRET";
    const callback = await request(`/api/callbacks/${provider}`, { method: "POST", headers: { "content-type": "application/json", "x-researchops-timestamp": callbackTimestamp, "x-researchops-signature": callbackSignature }, body: callbackBody }, { [key]: secret });
    assert.equal(callback.status, 202);
    assert.equal((await callback.json()).data.eventType, "COMPLETE");
    assert.ok(callback.headers.get("x-request-id"));
  }

  const fraudFlags = await request("/api/fraud-flags");
  assert.equal(fraudFlags.status, 200);
  const fraudBody = await fraudFlags.json();
  assert.equal(fraudBody.meta.canOperate, true);
  const fraudFlag = fraudBody.data[0];
  assert.equal(fraudFlag.ruleCode, "SPEEDING");
  const resolvedFlag = await request(`/api/fraud-flags/${fraudFlag.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "DISMISSED" }) });
  assert.equal(resolvedFlag.status, 200);
  const analytics = await request("/api/analytics?from=2026-08-01&to=2026-08-31");
  assert.equal(analytics.status, 200);
  const analyticsBody = await analytics.json();
  assert.equal(analyticsBody.data.portfolio.completes, 1994);
  assert.equal(analyticsBody.data.suppliers.length, 3);
  const invalidAnalytics = await request("/api/analytics?from=2026-09-01&to=2026-08-01");
  assert.equal(invalidAnalytics.status, 400);
  const notifications = await request("/api/notifications");
  assert.equal(notifications.status, 200);
  const notice = (await notifications.json()).data[0];
  const readNotice = await request(`/api/notifications/${notice.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(readNotice.status, 200);
  const rules = await request("/api/notification-rules");
  assert.equal(rules.status, 200);
  const ruleBody = await rules.json();
  assert.equal(ruleBody.data.length, 7);
  assert.equal(ruleBody.meta.canAdminister, true);
  const savedRules = await request("/api/notification-rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: ruleBody.data }) });
  assert.equal(savedRules.status, 200);
  const partialRules = await request("/api/notification-rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: ruleBody.data.slice(0, 6) }) });
  assert.equal(partialRules.status, 400);
  const invalidThresholdRules = ruleBody.data.map((rule) => rule.eventType === "PACING_RISK" ? { ...rule, threshold: 101 } : rule);
  const invalidThreshold = await request("/api/notification-rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ rules: invalidThresholdRules }) });
  assert.equal(invalidThreshold.status, 400);

  const organization = await request("/api/organizations/current");
  assert.equal(organization.status, 200);
  const organizationBody = await organization.json();
  assert.equal(organizationBody.meta.source, "mock");
  assert.equal(organizationBody.data.timezone, "Asia/Kolkata");
  const organizationUpdated = await request("/api/organizations/current", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Demo workspace", timezone: "UTC" }) });
  assert.equal(organizationUpdated.status, 200);
  const invalidOrganizationUpdate = await request("/api/organizations/current", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "D", timezone: "Mars/Olympus" }) });
  assert.equal(invalidOrganizationUpdate.status, 400);

  const clients = await request("/api/clients");
  assert.equal(clients.status, 200);
  const clientsBody = await clients.json();
  assert.equal(clientsBody.data.length, 4);
  assert.equal(clientsBody.meta.canOperate, true);
  const clientCreated = await request("/api/clients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "New Client", code: "NEW_CLIENT", redirects: { completeUrl: "https://must-not-be-stored.example/complete" }, redirectVariables: [{ name: "respondent_id", source: "URL_PARAM", defaultValue: "", required: true }, { name: "project_id", source: "SYSTEM", defaultValue: "", required: true }] }) });
  assert.equal(clientCreated.status, 201);
  const createdClientBody = await clientCreated.json();
  assert.equal(createdClientBody.data.redirects, undefined);
  assert.equal(createdClientBody.data.redirectVariables.length, 2);
  assert.match(createdClientBody.data.links.complete, /respondent_id=\{\{respondent_id\}\}/);
  assert.match(createdClientBody.data.links.complete, /project_id=\{\{project_id\}\}/);
  const clientUpdated = await request("/api/clients/client-northstar", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Northstar Financial", code: "NORTHSTAR_FIN" }) });
  assert.equal(clientUpdated.status, 200);
  assert.equal((await clientUpdated.json()).data.name, "Northstar Financial");

  const supplierCreated = await request("/api/suppliers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Specialist Panel", code: "SPECIALIST", supplierType: "SPECIALIST" }) });
  assert.equal(supplierCreated.status, 201);

  const readiness = await request("/api/readiness");
  assert.equal(readiness.status, 200);
  const readinessBody = await readiness.json();
  assert.equal(readinessBody.application, "healthy");
  assert.equal(readinessBody.api, "healthy");
  assert.equal(readinessBody.database.status, "not-configured");
});

test("enforces workspace roles on protected project operations", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) return Response.json({ id: "user-1", email: "analyst@example.com" });
    if (url.includes("/organization_members")) return Response.json([{ organization_id: "org-1", role: "ANALYST" }]);
    if (url.includes("/notification_rules")) return Response.json([]);
    if (url.includes("/rest/v1/fraud_flags")) return Response.json([]);
    if (url.includes("/rest/v1/projects")) return Response.json([], { headers: { "content-range": "*/0" } });
    if (url.includes("/rest/v1/clients")) return Response.json([]);
    throw new Error(`Unexpected Supabase request: ${url}`);
  };

  const environment = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" };
  const headers = { authorization: "Bearer valid-user-token" };
  try {
    const readable = await request("/api/projects", { headers }, environment);
    assert.equal(readable.status, 200);
    assert.equal((await readable.json()).meta.canOperate, false);

    const forbidden = await request("/api/projects", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Forbidden create", client: "Client", quota: 10, clientCpi: 5 }),
    }, environment);
    assert.equal(forbidden.status, 403);
    assert.match((await forbidden.json()).error, /role does not allow/i);

    const forbiddenUpdate = await request("/api/projects/PRJ-1048", {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ projectName: "Forbidden", quota: 10, clientCpi: 5 }),
    }, environment);
    assert.equal(forbiddenUpdate.status, 403);

    const forbiddenTransition = await request("/api/projects/PRJ-1048/transitions", {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ status: "PAUSED" }),
    }, environment);
    assert.equal(forbiddenTransition.status, 403);
    const forbiddenMarkets = await request("/api/projects/PRJ-1048/markets", {
      method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ markets: [{ countryCode: "US", languageCode: "en", targetQuota: 100, expectedLoiMinutes: 10, expectedIr: 40 }] }),
    }, environment);
    assert.equal(forbiddenMarkets.status, 403);
    const forbiddenAssignments = await request("/api/projects/PRJ-1048/suppliers", {
      method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ assignments: [] }),
    }, environment);
    assert.equal(forbiddenAssignments.status, 403);
    const forbiddenOrganizationSettings = await request("/api/organizations/current", {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ name: "Forbidden workspace", timezone: "UTC" }),
    }, environment);
    assert.equal(forbiddenOrganizationSettings.status, 403);
    const readableNotificationRules = await request("/api/notification-rules", { headers }, environment);
    assert.equal(readableNotificationRules.status, 200);
    assert.equal((await readableNotificationRules.json()).meta.canAdminister, false);
    const forbiddenNotificationRules = await request("/api/notification-rules", {
      method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ rules: [] }),
    }, environment);
    assert.equal(forbiddenNotificationRules.status, 403);
    const readableClients = await request("/api/clients", { headers }, environment);
    assert.equal(readableClients.status, 200);
    assert.equal((await readableClients.json()).meta.canOperate, false);
    const readableFraudFlags = await request("/api/fraud-flags", { headers }, environment);
    assert.equal(readableFraudFlags.status, 200);
    assert.equal((await readableFraudFlags.json()).meta.canOperate, false);
    const forbiddenFraudResolution = await request("/api/fraud-flags/00000000-0000-4000-8000-000000000099", {
      method: "PATCH", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ status: "CONFIRMED" }),
    }, environment);
    assert.equal(forbiddenFraudResolution.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("throttles same-origin authentication traffic", async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return Response.json({ error: "invalid credentials" }, { status: 400 });
  };
  try {
    const environment = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" };
    workerUrl.searchParams.set("test", `auth-rate-${process.pid}-${Date.now()}`);
    const { default: worker } = await import(workerUrl.href);
    let response;
    for (let index = 0; index < 11; index += 1) {
      response = await worker.fetch(new Request("http://localhost/supabase/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "cf-connecting-ip": "192.0.2.44" },
        body: JSON.stringify({ email: "person@example.test", password: "incorrect" }),
      }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, ...environment }, { waitUntil() {}, passThroughOnException() {} });
    }
    assert.equal(upstreamCalls, 10);
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards Supabase Auth POST bodies without deployment hop-by-hop headers", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (input, init) => {
    forwarded = { input: String(input), init };
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-encoding": "gzip", "content-length": "999", "connection": "keep-alive" },
    });
  };
  try {
    const response = await request("/supabase/auth/v1/signup", {
      method: "POST",
      headers: { authorization: "Bearer public-token", "content-type": "application/json", connection: "keep-alive", "x-forwarded-host": "www.asrv.co.in" },
      body: JSON.stringify({ email: "operator@example.test", password: "not-a-real-secret" }),
    }, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-anon-key" });
    assert.equal(response.status, 200);
    assert.equal(forwarded.input, "https://project.supabase.co/auth/v1/signup");
    assert.equal(forwarded.init.body, JSON.stringify({ email: "operator@example.test", password: "not-a-real-secret" }));
    assert.equal(forwarded.init.headers.get("apikey"), "public-anon-key");
    assert.equal(forwarded.init.headers.get("authorization"), "Bearer public-token");
    assert.equal(forwarded.init.headers.has("connection"), false);
    assert.equal(forwarded.init.headers.has("x-forwarded-host"), false);
    assert.equal(response.headers.has("content-encoding"), false);
    assert.equal(response.headers.has("content-length"), false);
    assert.equal(response.headers.has("connection"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
