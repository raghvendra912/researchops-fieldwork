import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser family is captured without storing the raw user agent", async () => {
  const redirectSource = await readFile(new URL("../worker/routes/redirects.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/043_browser_session_context.sql", import.meta.url), "utf8");
  const respondents = await readFile(new URL("../worker/routes/respondents.ts", import.meta.url), "utf8");

  assert.match(redirectSource, /browserType:\s*browserType\(request\)/);
  assert.doesNotMatch(migration, /add column[^;]*user_agent/is);
  assert.match(migration, /add column if not exists browser_type/i);
  assert.match(migration, /new\.metadata->>'browserType'/);
  assert.match(respondents, /device_type,browser_type/);
  assert.match(respondents, /browserType:\s*row\.browser_type/);
});

test("operating-system family is recorded without retaining user-agent text", async () => {
  const redirectSource = await readFile(new URL("../worker/routes/redirects.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/044_session_operating_system.sql", import.meta.url), "utf8");
  assert.match(redirectSource, /osType:\s*operatingSystem\(request\)/);
  assert.match(migration, /add column if not exists os_type/i);
  assert.doesNotMatch(migration, /add column[^;]*user_agent/is);
});
