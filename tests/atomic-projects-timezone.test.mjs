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

const { buildRespondentReportCsv } = await import("../src/features/projects/respondent-report.ts");
const sql = await readFile(new URL("../supabase/migrations/050_atomic_project_creation.sql", import.meta.url), "utf8");

test("respondent report export formats timestamps in specified workspace timezone", () => {
  const row = {
    id: "sess-1",
    respondentRef: "RESP-1",
    projectCode: "ROP-100",
    startedAt: "2026-11-01T12:00:00.000Z",
    completedAt: "2026-11-01T12:30:00.000Z",
    durationSeconds: 1800,
    status: "COMPLETE",
  };

  // 1. UTC export
  const utcCsv = buildRespondentReportCsv([row], "UTC");
  assert.match(utcCsv, /2026-11-01/);
  assert.match(utcCsv, /12:00:00/);
  assert.match(utcCsv, /12:30:00/);

  // 2. Asia/Kolkata (+05:30) export: 12:00 UTC -> 17:30 IST
  const istCsv = buildRespondentReportCsv([row], "Asia/Kolkata");
  assert.match(istCsv, /2026-11-01/);
  assert.match(istCsv, /17:30:00/);
  assert.match(istCsv, /18:00:00/);

  // 3. America/New_York (-04:00 or -05:00) export: 12:00 UTC -> 08:00 or 07:00 EDT/EST
  const nyCsv = buildRespondentReportCsv([row], "America/New_York");
  assert.match(nyCsv, /2026-11-01/);
  assert.match(nyCsv, /08:00:00|07:00:00/);
});

test("migration 050 provides atomic creation, clone, and archive RPCs", () => {
  // create_project_atomic
  assert.match(sql, /create or replace function public\.create_project_atomic/);
  assert.match(sql, /create_project_with_market_v4/);
  assert.match(sql, /replace_project_markets/);
  assert.match(sql, /configure_project_geo_security/);

  // clone_project
  assert.match(sql, /create or replace function public\.clone_project/);
  assert.match(sql, /archive_project/);

  // Grants
  assert.match(sql, /grant execute on function public\.create_project_atomic/);
  assert.match(sql, /grant execute on function public\.clone_project/);
  assert.match(sql, /grant execute on function public\.archive_project/);
});

