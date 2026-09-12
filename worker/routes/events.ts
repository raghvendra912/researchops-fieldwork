import type { SupabaseEnv } from "../lib/supabase";
import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit";
import { requestId, safeLog } from "../lib/observability";
import type { NormalizedEvent } from "../providers/types";
import { riskMetadata } from "../lib/fraud";

export type EventEnv = SupabaseEnv & { SUPABASE_SERVICE_ROLE_KEY?: string; EVENT_INGESTION_SECRET?: string; FRAUD_HASH_SECRET?: string };
const eventTypes = ["START", "REACHED_CLIENT", "COMPLETE", "TERMINATE", "QUOTA_FULL", "QUALITY_TERMINATE", "ABANDON"];

function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function constantTimeEqual(left: string, right: string) { if (left.length !== right.length) return false; let result = 0; for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index); return result === 0; }

export async function validSignature(rawBody: string, request: Request, secret: string) {
  const timestamp = request.headers.get("x-researchops-timestamp") ?? "";
  const signature = (request.headers.get("x-researchops-signature") ?? "").toLowerCase().replace(/^sha256=/, "");
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  return constantTimeEqual(signature, expected);
}

export async function ingestNormalizedEvent(body: NormalizedEvent, env: EventEnv) {
  const eventType = String(body.eventType ?? "").toUpperCase();
  const respondentRef = String(body.respondentRef ?? "").trim();
  const organizationId = String(body.organizationId ?? "").trim();
  const projectCode = String(body.projectCode ?? "").trim().toUpperCase();
  if (!eventTypes.includes(eventType) || !respondentRef || !organizationId || !/^[A-Z]{2,10}-[A-Z0-9-]+$/.test(projectCode)) return Response.json({ error: "Invalid event payload" }, { status: 400 });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ data: { accepted: true, created: true, eventType }, meta: { source: "mock" } }, { status: 202 });
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ingest_survey_event`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_organization_id: organizationId, p_project_code: projectCode, p_supplier_id: body.supplierId || null, p_respondent_ref: respondentRef, p_event_type: eventType, p_provider_transaction_id: body.providerTransactionId || null, p_occurred_at: body.occurredAt || null, p_metadata: body.metadata ?? {}, p_is_test: body.isTest === true }) });
    if (!response.ok) throw new Error("Event RPC failed");
    const rows = await response.json() as Array<{ session_id: string; event_id: string; created: boolean }>;
    if (rows[0]?.session_id && !rows[0]?.event_id) return Response.json({ error: "The respondent already has a different terminal outcome" }, { status: 409 });
    return Response.json({ data: { sessionId: rows[0]?.session_id, eventId: rows[0]?.event_id, created: rows[0]?.created, eventType }, meta: { source: "supabase" } }, { status: rows[0]?.created ? 201 : 200 });
  } catch { return Response.json({ error: "Event ingestion failed" }, { status: 502 }); }
}

export async function handleEventsApi(request: Request, pathname: string, env: EventEnv): Promise<Response | null> {
  if (pathname !== "/api/events" || request.method !== "POST") return null;
  const id = requestId(request);
  const limited = checkRateLimit(`event:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, 120, 60);
  if (!limited.allowed) { safeLog("warn", "event_rate_limited", { requestId: id }); return rateLimitResponse(limited); }
  if (!env.EVENT_INGESTION_SECRET) return Response.json({ error: "Event ingestion is not configured" }, { status: 503 });
  const rawBody = await request.text();
  if (!await validSignature(rawBody, request, env.EVENT_INGESTION_SECRET)) return Response.json({ error: "Invalid or expired event signature" }, { status: 401 });
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(rawBody || "null") as Record<string, unknown> | null; } catch { return Response.json({ error: "Invalid JSON payload" }, { status: 400 }); }
  if (!body) return Response.json({ error: "Invalid event payload" }, { status: 400 });
  const risk = await riskMetadata(request, body.deviceRef, env.FRAUD_HASH_SECRET);
  const normalized = body as unknown as NormalizedEvent; normalized.metadata = { ...(normalized.metadata ?? {}), ...risk };
  const response = await ingestNormalizedEvent(normalized, env);
  safeLog(response.ok ? "info" : "warn", "event_processed", { requestId: id, status: response.status });
  response.headers.set("x-request-id", id);
  return response;
}
