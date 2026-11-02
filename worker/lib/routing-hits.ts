// Router hit log: one row per request, accepted or rejected, kept apart from survey sessions.

export type RoutingHop = "SUPPLIER_ENTRY" | "CLIENT_REDIRECT" | "CLIENT_RETURN" | "SUPPLIER_EXIT";

export type RoutingTrace = {
  organizationId?: string;
  supplierId?: string;
  projectId?: string;
  sessionId?: string;
  respondentRef?: string;
  decision?: string;
  targetHost?: string;
  /** Additional hop rows (CLIENT_REDIRECT / SUPPLIER_EXIT) logged beside the request row; host only, never a full URL. */
  extraHops?: Array<{ hop: RoutingHop; decision: string; targetHost?: string }>;
};

export type RoutingHitEnv = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; FRAUD_HASH_SECRET?: string };

export const VISITOR_COOKIE = "ro_vid";
const VISITOR_MAX_AGE = 86400;

/** Time-ordered UUID (v7) so hits sort by arrival and the id doubles as a click id. */
export function uuidv7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let time = now;
  for (let index = 5; index >= 0; index -= 1) { bytes[index] = time % 256; time = Math.floor(time / 256); }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function readVisitorId(request: Request): string | undefined {
  const match = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)ro_vid=([0-9a-f-]{36})(?:;|$)/i);
  return match?.[1]?.toLowerCase();
}

export function visitorCookie(visitorId: string) {
  return `${VISITOR_COOKIE}=${visitorId}; Path=/; Max-Age=${VISITOR_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

async function hmacHash(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hostOf(location: string | null | undefined) {
  if (!location) return undefined;
  try { return new URL(location).host.slice(0, 120); } catch { return undefined; }
}

/** Default decision from the response when the route did not record a more specific one. */
export function defaultDecision(status: number, hop: RoutingHop) {
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "ERROR";
  if (status >= 300 && status < 400) return "ROUTED";
  if (status === 200 && hop !== "SUPPLIER_ENTRY") return "ROUTED";
  return "REJECTED";
}

export async function buildRoutingHit(input: { request: Request; env: RoutingHitEnv; trace: RoutingTrace; hop: RoutingHop; routeKind: string; status: number; clickId: string; visitorId: string; latencyMs: number }) {
  const { request, env, trace } = input;
  const cf = (request as Request & { cf?: { country?: string; asn?: number } }).cf;
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  const agent = request.headers.get("user-agent") ?? "";
  const secret = env.FRAUD_HASH_SECRET;
  return {
    click_id: input.clickId,
    hop: input.hop,
    decision: trace.decision ?? defaultDecision(input.status, input.hop),
    http_status: input.status,
    organization_id: trace.organizationId ?? null,
    supplier_id: trace.supplierId ?? null,
    project_id: trace.projectId ?? null,
    session_id: trace.sessionId ?? null,
    respondent_ref: trace.respondentRef ? trace.respondentRef.slice(0, 200) : null,
    route_kind: input.routeKind,
    target_host: trace.targetHost ?? null,
    visitor_id: input.visitorId,
    ip_hash: secret && ip ? await hmacHash(secret, ip) : null,
    user_agent_hash: secret && agent ? await hmacHash(secret, agent) : null,
    country_code: (request.headers.get("cf-ipcountry") ?? cf?.country ?? "").toUpperCase().slice(0, 2) || null,
    asn: cf?.asn ? String(cf.asn) : null,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
  };
}

/** Never throws: a logging failure must not affect the respondent's redirect. */
export async function insertRoutingHit(env: RoutingHitEnv, row: Record<string, unknown>) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/routing_hits`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch { /* swallowed by design */ }
}
