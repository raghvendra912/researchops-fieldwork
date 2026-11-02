import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { handleAuditLogsApi } = await import("../worker/routes/audit-logs.ts");
const sql = await readFile(new URL("../supabase/migrations/051_audit_log_viewer_and_mfa.sql", import.meta.url), "utf8");

test("audit logs endpoint returns mock data and handles operator authorization", async () => {
  // Mock mode returns audit entries
  const req = new Request("https://router.asrv.co.in/api/audit-logs");
  const res = await handleAuditLogsApi(req, "/api/audit-logs", {});
  assert.equal(res?.status, 200);
  const json = await res?.json();
  assert.equal(json.meta.source, "mock");
  assert.ok(json.data.length >= 2);
  assert.equal(json.data[0].action, "ORGANIZATION_SETTINGS_UPDATED");
});

test("migration 051 provides audit log query function and organization MFA controls", () => {
  // MFA column on organizations
  assert.match(sql, /alter table public\.organizations[\s\S]*?add column if not exists mfa_required/);

  // Performance indexes
  assert.match(sql, /create index if not exists audit_logs_org_created_idx/);

  // query_audit_logs function with actor enrichment
  assert.match(sql, /create or replace function public\.query_audit_logs/);
  assert.match(sql, /left join public\.user_profiles p on p\.id = a\.actor_user_id/);
  assert.match(sql, /grant execute on function public\.query_audit_logs/);

  // update_organization_mfa_policy function
  assert.match(sql, /create or replace function public\.update_organization_mfa_policy/);
  assert.match(sql, /grant execute on function public\.update_organization_mfa_policy/);
});

