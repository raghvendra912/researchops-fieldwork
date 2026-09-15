import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/039_supplier_scoped_respondent_refs.sql", import.meta.url), "utf8");

test("migration 039 grants and revokes name the created function signatures", () => {
  const definitions = new Map();
  for (const match of sql.matchAll(/create or replace function public\.([a-z_]+)\(([\s\S]*?)\)\s*returns/gi)) {
    const types = match[2].trim() ? match[2].split(",").map((argument) => argument.trim().split(/\s+/).at(-1).toLowerCase()) : [];
    definitions.set(match[1], types);
  }
  assert.ok(definitions.size >= 5);
  let checked = 0;
  for (const match of sql.matchAll(/(?:revoke all|grant execute) on function public\.([a-z_]+)\(([^)]*)\)/gi)) {
    const actual = match[2].trim() ? match[2].split(",").map((type) => type.trim().toLowerCase()) : [];
    assert.deepEqual(actual, definitions.get(match[1]), `${match[1]} permission signature differs from CREATE FUNCTION`);
    checked += 1;
  }
  assert.ok(checked >= 8);
});

test("migration 039 can retry after a partial SQL-editor execution", () => {
  assert.match(sql, /drop constraint if exists survey_sessions_project_id_respondent_ref_key/i);
  assert.match(sql, /drop constraint if exists survey_quota_reservations_project_id_respondent_ref_key/i);
  assert.match(sql, /create unique index if not exists survey_sessions_direct_ref_key/i);
  assert.match(sql, /drop trigger if exists project_suppliers_protect_history/i);
});
