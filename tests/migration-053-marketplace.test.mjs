import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../supabase/migrations/053_marketplace_supply.sql", import.meta.url), "utf8");

test("migration 053 grants and revokes name the created function signatures", () => {
  const definitions = new Map();
  for (const match of sql.matchAll(/create or replace function public\.([a-z_]+)\(([\s\S]*?)\)\s*returns/gi)) {
    const types = match[2].trim() ? match[2].split(",").map((argument) => argument.trim().split(/\s+/).filter((part) => part.toLowerCase() !== "default").slice(0, 2).at(-1).toLowerCase()) : [];
    definitions.set(match[1], types);
  }
  assert.ok(definitions.size >= 9, `expected the marketplace functions, found ${[...definitions.keys()].join(", ")}`);
  let checked = 0;
  for (const match of sql.matchAll(/(?:revoke all|grant execute) on function public\.([a-z_]+)\(([^)]*)\)/gi)) {
    const actual = match[2].trim() ? match[2].split(",").map((type) => type.trim().toLowerCase()) : [];
    assert.deepEqual(actual, definitions.get(match[1]), `${match[1]} permission signature differs from CREATE FUNCTION`);
    checked += 1;
  }
  assert.ok(checked >= 18, `only ${checked} permission statements were checked`);
  for (const name of definitions.keys()) assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\(`, "i"), `${name} must revoke the default PUBLIC execute grant`);
});

test("migration 053 can be re-run after a partial SQL-editor execution", () => {
  assert.doesNotMatch(sql, /create table (?!if not exists)/i);
  assert.doesNotMatch(sql, /create (unique )?index (?!if not exists)/i);
  assert.doesNotMatch(sql, /add column (?!if not exists)/i);
  assert.doesNotMatch(sql, /create function /i, "use CREATE OR REPLACE so a retry succeeds");
  for (const match of sql.matchAll(/create policy "([^"]+)" on public\.([a-z_]+)/gi)) {
    assert.match(sql, new RegExp(`drop policy if exists "${match[1]}" on public\\.${match[2]}`, "i"), `policy ${match[1]} needs a DROP POLICY IF EXISTS`);
  }
  for (const match of sql.matchAll(/create trigger ([a-z_]+) (?:before|after) [^;]*? on public\.([a-z_]+)/gi)) {
    assert.match(sql, new RegExp(`drop trigger if exists ${match[1]} on public\\.${match[2]}`, "i"), `trigger ${match[1]} needs a DROP TRIGGER IF EXISTS`);
  }
  assert.match(sql, /drop constraint if exists projects_cpi_currency_valid/i);
});

test("migration 053 protects commercial data and never stores secrets", () => {
  for (const table of ["marketplaces", "marketplace_surveys", "marketplace_qualification_map", "finance_ledger_entries"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"), `${table} needs RLS`);
  }
  assert.doesNotMatch(sql, /for (insert|update|delete) to authenticated[\s\S]{0,40}on public\.(marketplace_surveys|finance_ledger_entries)/i);
  assert.doesNotMatch(sql, /policy "[^"]+" on public\.(marketplace_surveys|finance_ledger_entries) for (insert|update|delete|all)/i, "inventory and ledger are written only through functions");
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*(marketplace_surveys|finance_ledger_entries)/i);
  assert.match(sql, /config->>'secretEnv' ~ '\^MARKETPLACE_\[A-Z0-9_\]\{1,40\}_SECRET\$'/, "secret names are restricted to MARKETPLACE_*_SECRET");
  assert.doesNotMatch(sql, /\b(api_key|secret_value|client_secret|password|token)\s+text/i, "no secret-bearing column");
  assert.match(sql, /maintain_marketplace_supply\(timestamptz\) from public, anon, authenticated/i);
  assert.match(sql, /pause_projects_for_unavailable_surveys\(uuid\) from public, anon, authenticated/i);
  assert.match(sql, /can_operate_organization\(organization_id\)/, "finance and inventory are operator-only");
});

test("migration 053 keeps ledger writes idempotent and reversals single-shot", () => {
  assert.match(sql, /unique \(session_id, kind, entry_type\)/i);
  assert.equal((sql.match(/on conflict \(session_id, kind, entry_type\) do nothing/gi) ?? []).length, 3, "complete revenue, complete cost, and reversal inserts must all be conflict-safe");
  assert.match(sql, /generated always as \(case when entry_type = 'REVERSAL' then -amount else amount end\) stored/i);
  assert.match(sql, /if new\.status <> 'COMPLETE' or new\.is_test then return new/i, "test traffic never reaches the ledger");
});
