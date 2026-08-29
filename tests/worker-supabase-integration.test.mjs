import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";

const baseUrl = process.env.TEST_APP_URL;
const eventSecret = process.env.TEST_EVENT_SECRET;
const providerSecrets = {
  cpx: process.env.TEST_CPX_SECRET,
  bitlabs: process.env.TEST_BITLABS_SECRET,
  purespectrum: process.env.TEST_PURESPECTRUM_SECRET,
};
const enabled = Boolean(baseUrl);
const run = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function call(path, { token, method = "GET", body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(60_000),
      headers: {
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { response, data };
}

function expectStatus(result, status) {
  assert.equal(result.response.status, status, JSON.stringify(result.data));
  return result.data;
}

test("Worker and Supabase persist operator, event, fraud, and provider workflows", { skip: !enabled }, async () => {
  const signup = expectStatus(await call("/supabase/auth/v1/signup", {
    method: "POST",
    body: { email: `operator-${run}@example.test`, password: "LocalWorker!2026" },
  }), 200);
  assert.ok(signup.access_token);
  const token = signup.access_token;

  const organization = expectStatus(await call("/api/organizations", {
    token, method: "POST", body: { name: `M3 verification ${run}` },
  }), 201).data;
  assert.equal(organization.role, "OWNER");
  const organizationSettings = expectStatus(await call("/api/organizations/current", {
    token, method: "PATCH", body: { name: `Updated workspace ${run}`, timezone: "Asia/Kolkata" },
  }), 200).data;
  assert.equal(organizationSettings.name, `Updated workspace ${run}`);
  assert.equal(organizationSettings.timezone, "Asia/Kolkata");

  const client = expectStatus(await call("/api/clients", {
    token, method: "POST", body: { name: `Client ${run}`, code: `C${Date.now()}`, contactName: "Client operator", contactEmail: `client-${run}@example.test`, redirects: { completeUrl: "https://client.example.test/complete", terminateUrl: "https://client.example.test/terminate", quotaFullUrl: "https://client.example.test/quota", securityTerminateUrl: "https://client.example.test/security" } },
  }), 201).data;
  const supplier = expectStatus(await call("/api/suppliers", {
    token, method: "POST", body: { name: `Supplier ${run}`, code: `S${Date.now()}`, redirectMode: "DYNAMIC", contactName: "Supply operator", redirects: { completeUrl: "https://supplier.example.test/complete?rid={{respondent_id}}", terminateUrl: "https://supplier.example.test/terminate", quotaFullUrl: "https://supplier.example.test/quota", securityTerminateUrl: "https://supplier.example.test/security" } },
  }), 201).data;

  expectStatus(await call(`/api/clients/${client.id}`, {
    token, method: "PATCH", body: { name: `Updated Client ${run}` },
  }), 200);
  expectStatus(await call(`/api/suppliers/${supplier.id}`, {
    token, method: "PATCH", body: { redirectMode: "STATIC" },
  }), 200);
  const clientDirectory = expectStatus(await call("/api/clients", { token }), 200);
  assert.equal(clientDirectory.meta.canOperate, true);
  assert.ok(clientDirectory.data.some((row) => row.id === client.id && row.name === `Updated Client ${run}`));
  const supplierDirectory = expectStatus(await call("/api/suppliers", { token }), 200);
  assert.ok(supplierDirectory.data.some((row) => row.id === supplier.id && row.redirectMode === "STATIC" && row.links?.live));

  const project = expectStatus(await call("/api/projects", {
    token,
    method: "POST",
    body: {
      projectName: `Persistent Project ${run}`,
      client: `Updated Client ${run}`,
      clientPo: "M3-PO",
      type: "B2C",
      category: "Financial Technology",
      clientCpi: 12.5,
      quota: 120,
      countryCode: "US",
      languageCode: "en",
      loi: 12,
      incidence: 45,
      suppliers: [`Supplier ${run}`],
      surveyUrl: "https://survey.example.test/start?rid={{respondent_id}}",
      securityTerminateUrl: "https://client.example.test/project-security",
    },
  }), 201).data;
  assert.match(project.id, /^ROP-/);
  assert.equal(project.status, "PENDING");

  expectStatus(await call(`/api/projects/${project.id}`, {
    token,
    method: "PATCH",
    body: {
      projectName: `Updated Project ${run}`,
      clientPo: "M3-PO-UPDATED",
      type: "B2B",
      category: "Integration",
      clientCpi: 13.25,
      quota: 150,
      endDate: "2026-09-20",
      surveyUrl: "https://survey.example.test/updated?rid={{respondent_id}}",
      securityTerminateUrl: "https://client.example.test/project-security-updated",
    },
  }), 200);

  const markets = expectStatus(await call(`/api/projects/${project.id}/markets`, {
    token,
    method: "PUT",
    body: { markets: [
      { countryCode: "US", languageCode: "en", targetQuota: 90, expectedLoiMinutes: 12, expectedIr: 45 },
      { countryCode: "CA", languageCode: "fr", targetQuota: 60, expectedLoiMinutes: 10, expectedIr: 40 },
    ] },
  }), 200).data;
  assert.equal(markets.length, 2);

  const assignments = expectStatus(await call(`/api/projects/${project.id}/suppliers`, {
    token,
    method: "PUT",
    body: { assignments: [{ supplierId: supplier.id, supplierProjectId: "SUP-M3", supplierCpi: 8.75, targetQuota: 150, status: "ACTIVE" }] },
  }), 200).data;
  assert.equal(assignments[0].supplierId, supplier.id);

  const live = expectStatus(await call(`/api/projects/${project.id}/transitions`, {
    token, method: "POST", body: { status: "LIVE" },
  }), 200).data;
  assert.equal(live.status, "LIVE");

  const detail = expectStatus(await call(`/api/projects/${project.id}`, { token }), 200);
  assert.equal(detail.meta.source, "supabase");
  assert.equal(detail.meta.canOperate, true);
  assert.equal(detail.data.name, `Updated Project ${run}`);
  assert.equal(detail.data.status, "LIVE");
  assert.equal(detail.data.quota, 150);
  assert.equal(detail.data.manager, `operator-${run}`);
  assert.equal(detail.data.surveyUrl, "https://survey.example.test/updated?rid={{respondent_id}}");
  assert.equal(detail.data.securityTerminateUrl, "https://client.example.test/project-security-updated");
  assert.ok(detail.data.createdAt);
  const portfolio = expectStatus(await call(`/api/projects?q=${encodeURIComponent(`Updated Project ${run}`)}&status=LIVE&page=1&pageSize=10`, { token }), 200);
  assert.equal(portfolio.meta.source, "supabase");
  assert.equal(portfolio.meta.canOperate, true);
  assert.equal(portfolio.meta.total, 1);
  assert.equal(portfolio.data[0].id, project.id);
  const managerFacet = portfolio.meta.facets.managers.find((manager) => manager.label === `operator-${run}` && /^[0-9a-f-]{36}$/i.test(manager.value));
  assert.ok(managerFacet);
  const managerPortfolio = expectStatus(await call(`/api/projects?manager=${managerFacet.value}&q=${encodeURIComponent(`Updated Project ${run}`)}`, { token }), 200);
  assert.equal(managerPortfolio.meta.total, 1);
  assert.equal(managerPortfolio.data[0].manager, `operator-${run}`);

  if (eventSecret) {
    async function ingest(eventType, respondentRef, transactionId, expectedStatus = 201, extra = {}) {
      const body = { organizationId: organization.id, projectCode: project.id, supplierId: supplier.id, respondentRef, eventType, providerTransactionId: transactionId, deviceRef: "shared-test-device", ...extra };
      const rawBody = JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", eventSecret).update(`${timestamp}.${rawBody}`).digest("hex");
      return expectStatus(await call("/api/events", { method: "POST", body, headers: { "x-researchops-timestamp": timestamp, "x-researchops-signature": signature, "cf-connecting-ip": "203.0.113.10" } }), expectedStatus);
    }

    const primaryRef = `RESP-${run}`;
    const firstEvent = await ingest("START", primaryRef, `TX-START-${run}`);
    assert.equal(firstEvent.data.created, true);
    const replay = await ingest("START", primaryRef, `TX-START-${run}`, 200);
    assert.equal(replay.data.created, false);
    assert.equal(replay.data.eventId, firstEvent.data.eventId);
    await ingest("REACHED_CLIENT", primaryRef, `TX-REACHED-${run}`);
    await ingest("COMPLETE", primaryRef, `TX-COMPLETE-${run}`);
    for (const [suffix, terminal] of [["TERM", "TERMINATE"], ["QUOTA", "QUOTA_FULL"], ["QUALITY", "QUALITY_TERMINATE"], ["ABANDON", "ABANDON"]]) {
      const respondentRef = `RESP-${suffix}-${run}`;
      await ingest("START", respondentRef, `TX-${suffix}-START-${run}`);
      await ingest(terminal, respondentRef, `TX-${suffix}-END-${run}`, 201, suffix === "QUALITY" ? { metadata: { qualityViolation: true } } : {});
    }

    const metricDetail = expectStatus(await call(`/api/projects/${project.id}`, { token }), 200);
    assert.equal(metricDetail.data.starts, 5);
    assert.equal(metricDetail.data.reached, 1);
    assert.equal(metricDetail.data.completes, 1);
    assert.equal(metricDetail.data.terminates, 1);
    assert.equal(metricDetail.data.overQuota, 1);
    assert.equal(metricDetail.data.qualityTerm, 1);
    assert.equal(metricDetail.data.abandonRate, 20);
    assert.equal(metricDetail.data.conversionRate, 20);
    const supplierMetrics = expectStatus(await call(`/api/projects/${project.id}/suppliers`, { token }), 200);
    assert.equal(supplierMetrics.data[0].starts, 5);
    assert.equal(supplierMetrics.data[0].completes, 1);
    assert.equal(supplierMetrics.data[0].cost, 8.75);
    const livePortfolio = expectStatus(await call(`/api/projects?q=${encodeURIComponent(`Updated Project ${run}`)}`, { token }), 200);
    assert.equal(livePortfolio.data[0].starts, 5);
    assert.equal(livePortfolio.data[0].completes, 1);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const analytics = expectStatus(await call(`/api/analytics?from=${yesterday}&to=${today}`, { token }), 200);
    assert.equal(analytics.meta.source, "supabase");
    assert.equal(analytics.data.portfolio.starts, 5);
    assert.equal(analytics.data.portfolio.completes, 1);
    assert.equal(analytics.data.suppliers[0].cost, 8.75);
    const respondents = expectStatus(await call(`/api/respondents?q=${encodeURIComponent(primaryRef)}`, { token }), 200);
    assert.equal(respondents.data.length, 1);
    assert.deepEqual(respondents.data[0].events.map((event) => event.eventType), ["START", "REACHED_CLIENT", "COMPLETE"]);
    const fraudFlags = expectStatus(await call("/api/fraud-flags", { token }), 200);
    assert.equal(fraudFlags.meta.canOperate, true);
    const projectFlags = fraudFlags.data.filter((flag) => flag.session.project.projectCode === project.id);
    assert.ok(projectFlags.some((flag) => flag.ruleCode === "SPEEDING"));
    assert.ok(projectFlags.some((flag) => flag.ruleCode === "DUPLICATE_IP"));
    assert.ok(projectFlags.some((flag) => flag.ruleCode === "DUPLICATE_DEVICE"));
    assert.ok(projectFlags.some((flag) => flag.ruleCode === "QUALITY_VIOLATION"));
    const speeding = projectFlags.find((flag) => flag.ruleCode === "SPEEDING");
    const resolved = expectStatus(await call(`/api/fraud-flags/${speeding.id}`, { token, method: "PATCH", body: { status: "CONFIRMED" } }), 200);
    assert.equal(resolved.data.status, "CONFIRMED");

    if (Object.values(providerSecrets).every(Boolean)) {
      for (const [provider, secret] of Object.entries(providerSecrets)) {
        const callbackBody = { organizationId: organization.id, projectCode: project.id, respondentRef: `${provider}-${run}`, disposition: "complete", transactionId: `${provider}-TX-${run}` };
        const rawBody = JSON.stringify(callbackBody);
        const timestamp = String(Math.floor(Date.now() / 1000));
        const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
        const callbackResult = await call(`/api/callbacks/${provider}`, { method: "POST", body: callbackBody, headers: { "x-researchops-timestamp": timestamp, "x-researchops-signature": signature } });
        const callback = expectStatus(callbackResult, 201);
        assert.equal(callback.data.eventType, "COMPLETE");
        assert.equal(callback.meta.source, "supabase");
        assert.ok(callbackResult.response.headers.get("x-request-id"));
      }
      const callbackMetrics = expectStatus(await call(`/api/projects/${project.id}`, { token }), 200);
      assert.equal(callbackMetrics.data.completes, 4);
    }
  }

  const audit = expectStatus(await call(`/supabase/rest/v1/audit_logs?organization_id=eq.${organization.id}&select=action&order=created_at.asc`, { token }), 200);
  const actions = new Set(audit.map((row) => row.action));
  for (const action of ["ORGANIZATION_SETTINGS_UPDATED", "PROJECT_CREATED", "PROJECT_UPDATED", "PROJECT_STATUS_CHANGED", "PROJECT_MARKETS_REPLACED", "PROJECT_SUPPLIERS_REPLACED", "CLIENTS_INSERT", "CLIENTS_UPDATE", "SUPPLIERS_INSERT", "SUPPLIERS_UPDATE"]) {
    assert.ok(actions.has(action), `Missing audit action ${action}`);
  }
  if (eventSecret) assert.ok(actions.has("FRAUD_FLAG_RESOLVED"));
});
