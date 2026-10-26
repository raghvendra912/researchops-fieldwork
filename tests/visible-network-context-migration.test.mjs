import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../supabase/migrations/045_visible_session_network_context.sql", import.meta.url), "utf8");

test("migration 045 stores authorized respondent IP and location context", () => {
  assert.match(migration, /add column if not exists ip_address inet/i);
  assert.match(migration, /capture_session_network_context\(/i);
  assert.match(migration, /grant execute on function public\.capture_session_network_context\(uuid,text,text,text,text,text\) to service_role/i);
});
