// Cryptographic signing and verification for respondent outcome URLs.
// Binds each outcome (complete, terminate, quota-full, security-terminate) to
// its specific session token using HMAC-SHA256 so that an outcome URL for one
// status cannot be used to trigger a different status (e.g. self-completing by
// changing /terminate to /complete).

import type { RoutingOutcome } from "../domain/routing-links";

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

export function getSigningSecret(env: { OUTCOME_SIGNING_SECRET?: string; EVENT_INGESTION_SECRET?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): string {
  return env.OUTCOME_SIGNING_SECRET || env.EVENT_INGESTION_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "development-fallback-outcome-secret-key-32b";
}

/**
 * Computes an HMAC-SHA256 signature binding the outcome token and the expected outcome.
 * Returns a 32-character hex string (first 128 bits of SHA-256 is plenty for URL signatures).
 */
export async function signOutcome(token: string, outcome: string, secret: string): Promise<string> {
  const payload = `outcome:${token.toLowerCase().trim()}:${outcome.toLowerCase().trim()}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return hex(bytes).slice(0, 32);
}

/**
 * Verifies that the provided signature matches the token and outcome.
 */
export async function verifyOutcomeSignature(
  token: string,
  outcome: string,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature || typeof signature !== "string" || signature.length !== 32) return false;
  const expected = await signOutcome(token, outcome, secret);
  return constantTimeEqual(signature.toLowerCase(), expected);
}

/**
 * Generates a signed per-session outcome URL.
 */
export async function signedOutcomeRoute(
  origin: string,
  token: string,
  outcome: RoutingOutcome,
  secret: string,
): Promise<string> {
  const base = `${origin.replace(/\/$/, "")}/r/outcome/${token}/${outcome}`;
  const sig = await signOutcome(token, outcome, secret);
  return `${base}?sig=${sig}`;
}

