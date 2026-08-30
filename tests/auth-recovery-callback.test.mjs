import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseRecoveryCallback, recoveryDestination } from "../src/features/auth/recovery.ts";

test("parses every supported Supabase recovery callback shape", () => {
  assert.deepEqual(parseRecoveryCallback("https://www.asrv.co.in/reset-password?code=pkce-code"), { kind: "code", code: "pkce-code" });
  assert.deepEqual(parseRecoveryCallback("https://www.asrv.co.in/reset-password?token_hash=hashed&type=recovery"), { kind: "token-hash", tokenHash: "hashed" });
  assert.deepEqual(parseRecoveryCallback("https://www.asrv.co.in/reset-password#access_token=access&refresh_token=refresh&type=recovery"), { kind: "implicit", accessToken: "access", refreshToken: "refresh" });
  assert.equal(parseRecoveryCallback("https://www.asrv.co.in/reset-password?type=signup&token_hash=wrong-flow"), null);
});

test("uses one explicit owner for recovery callback consumption", async () => {
  const source = await readFile(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
  assert.match(source, /detectSessionInUrl:\s*false/);
});

test("moves root-delivered recovery credentials to the reset page intact", () => {
  assert.equal(
    recoveryDestination("https://www.asrv.co.in/?code=pkce-code"),
    "/reset-password?code=pkce-code",
  );
  assert.equal(
    recoveryDestination("https://www.asrv.co.in/#access_token=access&refresh_token=refresh&type=recovery"),
    "/reset-password#access_token=access&refresh_token=refresh&type=recovery",
  );
  assert.equal(recoveryDestination("https://www.asrv.co.in/"), null);
});
