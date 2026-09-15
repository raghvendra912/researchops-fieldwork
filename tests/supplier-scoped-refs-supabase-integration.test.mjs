import assert from "node:assert/strict";
import test from "node:test";

const base = process.env.TEST_SUPABASE_URL;
const anon = process.env.TEST_SUPABASE_ANON_KEY;
const service = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(base && anon && service);
const suffix = `${Date.now()}${Math.random().toString(16).slice(2, 8)}`;

async function call(path, { token = anon, method = "GET", body, prefer } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { apikey: token === service ? service : anon, authorization: `Bearer ${token}`, "content-type": "application/json", ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}
function ok(result) { assert.ok(result.status >= 200 && result.status < 300, JSON.stringify(result.data)); return result.data; }

test("migration 039 isolates equal supplier references and keeps assignment history", { skip: !enabled }, async () => {
  const owner = ok(await call("/auth/v1/signup", { method: "POST", body: { email: `scoped-${suffix}@example.test`, password: "LocalTest!2026" } }));
  const token = owner.access_token;
  const organization = ok(await call("/rest/v1/rpc/create_initial_organization", { token, method: "POST", body: { p_name: `Scoped ${suffix}` } }))[0].organization_id;
  const clientName = `Client ${suffix}`;
  ok(await call("/rest/v1/clients", { token, method: "POST", body: { organization_id: organization, name: clientName, code: `C${suffix}` } }));
  const secondName = `Second Supplier ${suffix}`;
  ok(await call("/rest/v1/suppliers", { token, method: "POST", body: { organization_id: organization, name: secondName, code: `S${suffix}` } }));
  const project = ok(await call("/rest/v1/rpc/create_project_with_market", { token, method: "POST", body: { p_project_name: `Scoped study ${suffix}`, p_client_name: clientName, p_client_po: "TEST", p_project_type: "Consumer", p_category: "Test", p_client_cpi: 10, p_quota: 20, p_country_code: "US", p_language_code: "en", p_expected_loi_minutes: 10, p_expected_ir: 40, p_start_date: "2026-09-15", p_supplier_names: ["CPX Research", secondName] } }))[0];
  const assignments = ok(await call(`/rest/v1/project_suppliers?project_id=eq.${project.id}&select=id,supplier_id,supplier_project_id,supplier_cpi,target_quota,status,suppliers(name)`, { token }));
  assert.equal(assignments.length, 2);
  const respondentRef = `SHARED-${suffix}`;
  const sessions = [];
  const reservations = [];
  for (const assignment of assignments) {
    const reservation = ok(await call("/rest/v1/rpc/reserve_project_quota", { token: service, method: "POST", body: { p_organization_id: organization, p_project_code: project.project_code, p_supplier_id: assignment.supplier_id, p_respondent_ref: respondentRef, p_matching_cell_ids: [] } }))[0];
    assert.equal(reservation.allowed, true);
    reservations.push(reservation.reservation_id);
    const event = ok(await call("/rest/v1/rpc/ingest_survey_event", { token: service, method: "POST", body: { p_organization_id: organization, p_project_code: project.project_code, p_supplier_id: assignment.supplier_id, p_respondent_ref: respondentRef, p_event_type: "START", p_provider_transaction_id: `START-${assignment.id}`, p_occurred_at: new Date().toISOString(), p_metadata: {}, p_is_test: false } }))[0];
    sessions.push(event.session_id);
  }
  assert.notEqual(sessions[0], sessions[1]);
  assert.notEqual(reservations[0], reservations[1]);
  const rows = ok(await call(`/rest/v1/survey_sessions?project_id=eq.${project.id}&respondent_ref=eq.${respondentRef}&select=id,project_supplier_id`, { token: service }));
  assert.equal(rows.length, 2);
  const completeBody = { p_organization_id: organization, p_project_code: project.project_code, p_supplier_id: assignments[0].supplier_id, p_respondent_ref: respondentRef, p_event_type: "COMPLETE", p_provider_transaction_id: `COMPLETE-${assignments[0].id}`, p_occurred_at: new Date().toISOString(), p_metadata: {}, p_is_test: false };
  const complete = ok(await call("/rest/v1/rpc/ingest_survey_event", { token: service, method: "POST", body: completeBody }))[0];
  assert.equal(complete.session_id, sessions[0]);
  const replay = ok(await call("/rest/v1/rpc/ingest_survey_event", { token: service, method: "POST", body: completeBody }))[0];
  assert.equal(replay.created, false);
  const quotaRows = ok(await call(`/rest/v1/survey_quota_reservations?project_id=eq.${project.id}&respondent_ref=eq.${respondentRef}&select=project_supplier_id,status`, { token: service }));
  assert.equal(quotaRows.find((row) => row.project_supplier_id === assignments[0].id)?.status, "CONSUMED");
  assert.equal(quotaRows.find((row) => row.project_supplier_id === assignments[1].id)?.status, "RESERVED");
  const edited = ok(await call("/rest/v1/rpc/replace_project_suppliers", { token, method: "POST", body: { p_project_code: project.project_code, p_assignments: assignments.map((item) => ({ supplier_id: item.supplier_id, supplier_project_id: item.supplier_project_id, supplier_cpi: Number(item.supplier_cpi ?? 0) + 1, target_quota: item.target_quota ?? 20, status: item.status })) } }));
  assert.deepEqual(new Set(edited.map((item) => item.id)), new Set(assignments.map((item) => item.id)));
  const removal = await call("/rest/v1/rpc/replace_project_suppliers", { token, method: "POST", body: { p_project_code: project.project_code, p_assignments: [{ supplier_id: assignments[0].supplier_id, supplier_project_id: assignments[0].supplier_project_id, supplier_cpi: 1, target_quota: 20, status: "CLOSED" }] } });
  assert.ok(removal.status >= 400);
  const directRemoval = await call(`/rest/v1/project_suppliers?id=eq.${assignments[0].id}`, { token: service, method: "DELETE" });
  assert.ok(directRemoval.status >= 400);
});
