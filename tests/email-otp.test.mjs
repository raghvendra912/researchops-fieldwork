import assert from "node:assert/strict";
import test from "node:test";
import { verifyEmailOtp } from "../src/features/auth/email-otp.ts";

test("email OTP verification supports signup and existing-user token types", async () => {
  const attempted = [];
  await verifyEmailOtp(async (type) => {
    attempted.push(type);
    return { error: type === "signup" ? null : new Error("wrong token type") };
  });
  assert.deepEqual(attempted, ["email", "signup"]);
});

test("email OTP verification rejects a code when every supported type fails", async () => {
  await assert.rejects(() => verifyEmailOtp(async () => ({ error: new Error("invalid code") })), /invalid code/);
});
