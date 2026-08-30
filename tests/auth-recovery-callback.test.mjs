import assert from "node:assert/strict";
import test from "node:test";
import { parseRecoveryCallback } from "../src/features/auth/recovery.ts";

test("parses every supported Supabase recovery callback shape", () => {
  assert.deepEqual(parseRecoveryCallback("https://www.asrv.co.in/reset-password?code=pkce-code"), { kind: "code", code: "pkce-code" });
  assert.deepEqual(parseRecoveryCallback("https://www.asrv.co.in/reset-password?token_hash=hashed&type=recovery"), { kind: "token-hash", tokenHash: "hashed" });
  assert.deepEqual(parseRecoveryCallback("https://www.asrv.co.in/reset-password#access_token=access&refresh_token=refresh&type=recovery"), { kind: "implicit", accessToken: "access", refreshToken: "refresh" });
  assert.equal(parseRecoveryCallback("https://www.asrv.co.in/reset-password?type=signup&token_hash=wrong-flow"), null);
});
