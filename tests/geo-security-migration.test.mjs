import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../supabase/migrations/040_geo_security.sql", import.meta.url), "utf8");

test("migration 040 scopes configuration and restricts geo evidence capture", () => {
  assert.match(migration, /can_operate_organization\(p\.organization_id\)/);
  assert.doesNotMatch(migration, /current_organization_id/);
  assert.match(migration, /grant execute on function public\.configure_project_geo_security\(text,boolean\) to authenticated/);
  assert.match(migration, /grant execute on function public\.capture_session_geolocation\(uuid,text,text,text,text\) to service_role/);
  assert.match(migration, /'NOT_ENABLED','MATCH','MISMATCH','UNKNOWN'/);
});
