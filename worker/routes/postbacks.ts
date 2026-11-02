// Server-to-server outcome postbacks from client survey platforms.
//
// POST /api/postbacks/:clientRedirectToken
//   headers: x-researchops-timestamp, x-researchops-signature = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
//   body:    { "rid": "<session uuid>", "status": "complete|terminate|quota-full|security-terminate" }
//
// The secret is the Worker env var named by clients.signing_secret_env. Because the request is
// signed with a secret the respondent never sees, it is the authoritative proof of an outcome:
// any open UNVERIFIED_RETURN hold on that session is reconciled (dismissed) automatically.

import { recordEvent, type SupplierRow } from "./redirects";
import { validSignature, type EventEnv } from "./events";
import { isValidClientSecretEnvName } from "../domain/client-signing";
import { serviceRows } from "../lib/supabase-read";
import { checkSharedRateLimit, rateLimitResponse } from "../lib/rate-limit";
import { requestId, safeLog } from "../lib/observability";

const outcomes = {
  complete: "COMPLETE",
  terminate: "TERMINATE",
  "quota-full": "QUOTA_FULL",
  "security-terminate": "QUALITY_TERMINATE",
} as const;

const terminalStatuses = new Set(["COMPLETE", "TERMINATE", "QUOTA_FULL", "QUALITY_TERMINATE", "ABANDON"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = <T,>(value: T | T[] | null | undefined) => (Array.isArray(value) ? value[0] : value ?? undefined);
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

type SessionRow = {
  id: string;
  respondent_ref: string;
  status: string;
  is_test: boolean;
  projects: { project_code: string; client_id: string } | { project_code: string; client_id: string }[];
  project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[];
};

export async function handleClientPostbackApi(request: Request, pathname: string, env: EventEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/postbacks\/([A-Za-z0-9_-]{8,128})$/);
  if (!match) return null;
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return reply({ error: "Postbacks are not configured" }, 503);

  const id = requestId(request);
  const limited = await checkSharedRateLimit(env, `postback:${match[1]}`, 300, 60, { ip: request.headers.get("cf-connecting-ip") ?? "unknown" });
  if (!limited.allowed) return rateLimitResponse(limited);

  const rawBody = await request.text();
  if (rawBody.length > 4096) return reply({ error: "Payload too large" }, 413);

  try {
    let clients: { id: string; signing_secret_env: string | null }[];
    try {
      clients = await serviceRows<{ id: string; signing_secret_env: string | null }>(env, `/rest/v1/clients?select=id,signing_secret_env&redirect_token=eq.${encodeURIComponent(match[1])}&limit=1`);
    } catch (error) {
      if (error instanceof Error && /upstream status 400\b/.test(error.message)) return reply({ error: "Signed postbacks are not available until migration 055 is applied" }, 501);
      throw error;
    }
    const client = clients[0];
    // Unknown client and bad signature are indistinguishable to the caller.
    if (!client) return reply({ error: "Invalid or expired signature" }, 401);
    const secretName = client.signing_secret_env;
    const secret = isValidClientSecretEnvName(secretName) ? (env as unknown as Record<string, unknown>)[secretName] : undefined;
    if (typeof secret !== "string" || secret.length < 16) return reply({ error: "Signed postbacks are not enabled for this client" }, 409);
    if (!await validSignature(rawBody, request, secret)) {
      safeLog("warn", "client_postback_rejected", { requestId: id, clientId: client.id });
      return reply({ error: "Invalid or expired signature" }, 401);
    }

    let body: { rid?: unknown; status?: unknown };
    try { body = JSON.parse(rawBody); } catch { return reply({ error: "Invalid JSON" }, 400); }
    const rid = typeof body.rid === "string" ? body.rid.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
    if (!uuid.test(rid) || !(status in outcomes)) return reply({ error: "rid (session id) and a valid status are required" }, 400);
    const eventType = outcomes[status as keyof typeof outcomes];

    const select = "id,respondent_ref,status,is_test,projects!inner(project_code,client_id),project_suppliers(suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))";
    const sessions = await serviceRows<SessionRow>(env, `/rest/v1/survey_sessions?select=${select}&id=eq.${rid.toLowerCase()}&projects.client_id=eq.${client.id}&limit=1`);
    const session = sessions[0];
    const project = session ? first(session.projects) : undefined;
    const supplier = session ? first(first(session.project_suppliers)?.suppliers) : undefined;
    if (!session || !project || project.client_id !== client.id || !supplier) return reply({ error: "Session not found" }, 404);
    if (terminalStatuses.has(session.status) && session.status !== eventType) return reply({ error: `Session is already ${session.status}` }, 409);

    const reasonCode = eventType === "TERMINATE" ? "CLIENT_TERMINATE" : eventType === "QUOTA_FULL" ? "QUOTA_FULL" : eventType === "QUALITY_TERMINATE" ? "QUALITY_REJECT" : undefined;
    const result = await recordEvent(request, env, supplier, project.project_code, session.respondent_ref, eventType, "client-postback", session.is_test, { ...(reasonCode ? { reasonCode } : {}), returnVerification: "VERIFIED" });
    if (!result.ok) return reply({ error: "The outcome could not be recorded" }, 502);

    // A verified server-to-server complete reconciles any hold raised by an earlier unsigned browser return.
    let reconciled = false;
    if (eventType === "COMPLETE") {
      const patch = await fetch(`${env.SUPABASE_URL}/rest/v1/fraud_flags?session_id=eq.${session.id}&rule_code=eq.UNVERIFIED_RETURN&status=eq.OPEN`, {
        method: "PATCH",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify({ status: "DISMISSED", reviewed_at: new Date().toISOString() }),
      }).catch(() => null);
      reconciled = Boolean(patch?.ok && (await patch.json().catch(() => [])).length);
    }
    return reply({ ok: true, rid: session.id, status: eventType, reconciled }, 200);
  } catch (error) {
    safeLog("error", "client_postback_failed", { requestId: id, error: error instanceof Error ? error.message : "Unknown postback failure" });
    return reply({ error: "The postback could not be processed", reference: id }, 502);
  }
}
