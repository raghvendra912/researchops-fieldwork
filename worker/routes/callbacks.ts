import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit";
import { requestId, safeLog } from "../lib/observability";
import { providerAdapters } from "../providers/adapters";
import type { ProviderName } from "../providers/types";
import { ingestNormalizedEvent, validSignature, type EventEnv } from "./events";
import { riskMetadata } from "../lib/fraud";

export type CallbackEnv = EventEnv & { CPX_CALLBACK_SECRET?: string; BITLABS_CALLBACK_SECRET?: string; PURESPECTRUM_CALLBACK_SECRET?: string };
const secretKeys: Record<ProviderName, keyof CallbackEnv> = { cpx: "CPX_CALLBACK_SECRET", bitlabs: "BITLABS_CALLBACK_SECRET", purespectrum: "PURESPECTRUM_CALLBACK_SECRET" };

export async function handleCallbacksApi(request: Request, pathname: string, env: CallbackEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/callbacks\/(cpx|bitlabs|purespectrum)$/);
  if (!match || request.method !== "POST") return null;
  const provider = match[1] as ProviderName; const id = requestId(request); const started = Date.now();
  const limited = checkRateLimit(`callback:${provider}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, 60, 60);
  if (!limited.allowed) { safeLog("warn", "provider_callback_rate_limited", { requestId: id, provider }); return rateLimitResponse(limited); }
  const secret = env[secretKeys[provider]];
  if (typeof secret !== "string" || !secret) return Response.json({ error: `${provider} callback is not configured` }, { status: 503 });
  const rawBody = await request.text();
  if (!await validSignature(rawBody, request, secret)) { safeLog("warn", "provider_callback_rejected", { requestId: id, provider, reason: "signature" }); return Response.json({ error: "Invalid or expired callback signature" }, { status: 401, headers: { "x-request-id": id } }); }
  let input: Record<string, unknown>;
  try { input = JSON.parse(rawBody) as Record<string, unknown>; } catch { return Response.json({ error: "Invalid JSON payload" }, { status: 400 }); }
  const event = providerAdapters[provider].parseTestCallback(input);
  if (!event) return Response.json({ error: "Unsupported callback payload" }, { status: 400 });
  event.metadata = { ...(event.metadata ?? {}), ...await riskMetadata(request, input.deviceRef, env.FRAUD_HASH_SECRET), qualityViolation: input.qualityViolation === true };
  const response = await ingestNormalizedEvent(event, env);
  safeLog(response.ok ? "info" : "error", "provider_callback_processed", { requestId: id, provider, status: response.status, latencyMs: Date.now() - started });
  response.headers.set("x-request-id", id); return response;
}
