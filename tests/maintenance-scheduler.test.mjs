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

const { handleMaintenanceCronApi } = await import("../worker/routes/maintenance.ts");
const sql = await readFile(new URL("../supabase/migrations/049_scheduler_and_pacing_triggers.sql", import.meta.url), "utf8");

test("maintenance cron requires CRON_SECRET and handles mock mode", async () => {
  // 1. Missing auth when secret configured -> 401
  const reqNoAuth = new Request("https://router.asrv.co.in/api/cron/maintenance");
  const resNoAuth = await handleMaintenanceCronApi(reqNoAuth, "/api/cron/maintenance", {
    CRON_SECRET: "cron-secret-123",
  });
  assert.equal(resNoAuth?.status, 401);

  // 2. Invalid auth -> 401
  const reqBadAuth = new Request("https://router.asrv.co.in/api/cron/maintenance", {
    headers: { authorization: "Bearer wrong-secret" },
  });
  const resBadAuth = await handleMaintenanceCronApi(reqBadAuth, "/api/cron/maintenance", {
    CRON_SECRET: "cron-secret-123",
  });
  assert.equal(resBadAuth?.status, 401);

  // 3. Valid auth in mock mode -> 200
  const reqValid = new Request("https://router.asrv.co.in/api/cron/maintenance", {
    headers: { authorization: "Bearer cron-secret-123" },
  });
  const resValid = await handleMaintenanceCronApi(reqValid, "/api/cron/maintenance", {
    CRON_SECRET: "cron-secret-123",
  });
  assert.equal(resValid?.status, 200);
  const data = await resValid?.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "mock");
});

test("migration 049 defines automated triggers and maintenance RPC", () => {
  // QUOTA_REACHED trigger
  assert.match(sql, /create or replace function public\.emit_quota_reached_notification/);
  assert.match(sql, /after insert on public\.survey_events/);
  assert.match(sql, /QUOTA_REACHED/);

  // PACING_RISK function
  assert.match(sql, /create or replace function public\.check_pacing_and_alert/);
  assert.match(sql, /PACING_RISK/);

  // perform_maintenance_tasks RPC
  assert.match(sql, /create or replace function public\.perform_maintenance_tasks/);
  assert.match(sql, /purge_expired_survey_response_values/);
  assert.match(sql, /check_pacing_and_alert/);
  assert.match(sql, /grant execute on function public\.perform_maintenance_tasks\(\) to service_role/);
});

