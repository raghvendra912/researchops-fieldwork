import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/047_fraud_adjusted_metrics.sql", import.meta.url), "utf8");

test("migration 047 views and functions exclude fraud and rejected sessions from billable completes", () => {
  // Views define is_valid_delivery checking internal/vendor rejections and confirmed/speeding fraud
  assert.match(sql, /coalesce\(s\.internal_approval_status, 'NOT_REVIEWED'\) <> 'REJECTED'/);
  assert.match(sql, /coalesce\(s\.vendor_approval_status, 'NOT_REVIEWED'\) <> 'REJECTED'/);
  assert.match(sql, /has_confirmed_fraud/);
  assert.match(sql, /has_speeding/);

  // project_event_metrics filters completes by is_valid_delivery
  assert.match(sql, /filter\(where not s\.is_test and e\.event_type='COMPLETE' and s\.is_valid_delivery\)::integer completes/);
  // Retains gross_completes for reconciliation
  assert.match(sql, /filter\(where not s\.is_test and e\.event_type='COMPLETE'\)::integer gross_completes/);
  // Exposes rejected_completes
  assert.match(sql, /rejected_completes/);

  // Supplier cost is computed strictly on valid completes
  assert.match(sql, /round\(count\(distinct ss\.id\) filter\(where not ss\.is_test and e\.event_type='COMPLETE' and ss\.is_valid_delivery\)\*coalesce\(ps\.supplier_cpi,0\),2\) cost/);
});

test("migration 047 releases consumed quota upon review rejection or confirmed fraud", () => {
  // review_survey_session releases quota when rejected
  assert.match(sql, /if p_status = 'REJECTED' then[\s\S]*?update public\.survey_quota_reservations[\s\S]*?set status = 'RELEASED'/);

  // resolve_fraud_flag releases quota when confirmed
  assert.match(sql, /if p_status = 'CONFIRMED' and target_session\.id is not null then[\s\S]*?update public\.survey_quota_reservations[\s\S]*?set status = 'RELEASED'/);

  // apply_quota_reservation_outcome does not consume quota if immediate fraud exists
  assert.match(sql, /when new\.event_type = 'COMPLETE' and not has_immediate_fraud then 'CONSUMED'/);
});

test("migration 047 views use security_invoker and reload PostgREST schema", () => {
  assert.match(sql, /create or replace view public\.project_event_metrics with \(security_invoker=true\)/);
  assert.match(sql, /create or replace view public\.project_supplier_event_metrics with \(security_invoker=true\)/);
  assert.match(sql, /grant select on public\.project_event_metrics, public\.project_supplier_event_metrics to authenticated/);
  assert.match(sql, /notify pgrst,'reload schema'/);
});

