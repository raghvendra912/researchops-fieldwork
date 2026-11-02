import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const sql = await readFile(new URL("../supabase/migrations/052_record_level_visibility.sql", import.meta.url), "utf8");

test("migration 052 defines client team assignment and sharing rules tables", () => {
  // Client team assignments
  assert.match(sql, /create table if not exists public\.client_team_assignments/);
  assert.match(sql, /role text not null default 'MEMBER' check \(role in \('LEAD', 'MEMBER'\)\)/);
  assert.match(sql, /unique\(client_id, user_id\)/);

  // Sharing rules
  assert.match(sql, /create table if not exists public\.sharing_rules/);
  assert.match(sql, /entity_type text not null check \(entity_type in \('PROJECT', 'CLIENT'\)\)/);
  assert.match(sql, /access_level text not null check \(access_level in \('READ', 'EDIT'\)\)/);
});

test("migration 052 enforces record-level visibility in RLS policies", () => {
  // Scoped read on projects via can_access_project
  assert.match(sql, /create policy "scoped read projects" on public\.projects/);
  assert.match(sql, /using \(public\.can_access_project\(id\)\)/);

  // Scoped read on survey_sessions
  assert.match(sql, /create policy "scoped read survey sessions" on public\.survey_sessions/);
  assert.match(sql, /using \(public\.can_access_project\(project_id\)\)/);

  // Scoped read on survey_events
  assert.match(sql, /create policy "scoped read survey events" on public\.survey_events/);

  // Scoped read on clients via can_access_client
  assert.match(sql, /create policy "scoped read clients" on public\.clients/);
  assert.match(sql, /using \(public\.can_access_client\(id\)\)/);
});

test("migration 052 grants access to client team leads and sales owners", () => {
  assert.match(sql, /create or replace function public\.can_access_client/);
  assert.match(sql, /create or replace function public\.can_access_project/);
  // The real project columns come from migration 038; names like secondary_pm_id or sales_user_id do not exist.
  assert.match(sql, /p\.sales_person_id/);
  assert.match(sql, /p\.secondary_project_manager_id/);
  assert.doesNotMatch(sql, /sales_user_id|secondary_pm_id/);
  assert.match(sql, /cta\.role = 'LEAD'/);
});

