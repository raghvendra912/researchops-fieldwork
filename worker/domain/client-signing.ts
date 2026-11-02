// Per-client return-link signing. The secret is known only to the client platform and this
// Worker (never placed in a URL the respondent can see), so a respondent who edits the
// address bar cannot forge a `complete`. Secrets are referenced by Worker env-var name and
// are never stored in the database.

export type SignedReturnPolicy = "OFF" | "HOLD" | "REJECT";
export type ReturnVerification = "NOT_REQUIRED" | "VERIFIED" | "UNSIGNED" | "INVALID";

const secretEnvPattern = /^CLIENT_[A-Z0-9_]{1,40}_SECRET$/;

export function isValidClientSecretEnvName(name: unknown): name is string {
  return typeof name === "string" && secretEnvPattern.test(name);
}

export function parseSignedReturnPolicy(value: unknown): SignedReturnPolicy | null {
  return value === "OFF" || value === "HOLD" || value === "REJECT" ? value : null;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

/** HMAC-SHA256 (64 hex chars) over `<session uuid>|<outcome>`; the client appends it as `h=`. */
export async function signClientReturn(secret: string, sessionId: string, outcome: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${sessionId.toLowerCase().trim()}|${outcome.toLowerCase().trim()}`)));
}

export async function verifyClientReturn(secret: string, sessionId: string, outcome: string, provided: string | null | undefined) {
  const candidate = (provided ?? "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(candidate)) return false;
  return constantTimeEqual(candidate, await signClientReturn(secret, sessionId, outcome));
}

export type ClientSigningConfig = { signing_secret_env: string | null; signed_return_policy: string | null };

export type ReturnCheck =
  | { ok: true; verification: ReturnVerification }
  | { ok: false; status: 403 | 503; reason: string };

/**
 * Decides whether a browser return may be recorded. INVALID signatures are always refused
 * (tampering); a missing signature is refused under REJECT and accepted-but-flagged under
 * HOLD. A configured policy with no usable secret fails closed instead of silently accepting.
 */
export async function checkClientReturn(config: ClientSigningConfig | undefined, env: Record<string, unknown>, sessionId: string, outcome: string, provided: string | null | undefined): Promise<ReturnCheck> {
  const policy = parseSignedReturnPolicy(config?.signed_return_policy) ?? "OFF";
  if (policy === "OFF") return { ok: true, verification: "NOT_REQUIRED" };
  const secretName = config?.signing_secret_env;
  const secret = isValidClientSecretEnvName(secretName) ? env[secretName] : undefined;
  if (typeof secret !== "string" || secret.length < 16) return { ok: false, status: 503, reason: "Client return signing is enabled but its secret is not configured" };
  if (!provided) return policy === "REJECT" ? { ok: false, status: 403, reason: "A signed return link is required for this client" } : { ok: true, verification: "UNSIGNED" };
  return await verifyClientReturn(secret, sessionId, outcome, provided) ? { ok: true, verification: "VERIFIED" } : { ok: false, status: 403, reason: "The return link signature is invalid" };
}
