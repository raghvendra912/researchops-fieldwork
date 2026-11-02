import { ingestNormalizedEvent, type EventEnv } from "./events";
import { riskMetadata } from "../lib/fraud";
import { checkSharedRateLimit, rateLimitResponse } from "../lib/rate-limit";
import { standardSupplierRedirect } from "../domain/supplier-redirect";
import { hasUnresolvedClientAttemptId, outcomeRouteFromSession, parseAssignmentRoute, parseClientRoute, parseOutcomeRoute, parseSupplierRoute, parseSupplierShortRoute, readClientAttemptId, readProjectCode, readRespondentRef, ROUTING_HELP } from "../domain/routing-links";
import { requestId, safeLog } from "../lib/observability";
import { checkClientReturn, type ClientSigningConfig, type ReturnCheck } from "../domain/client-signing";
import { buildRoutingHit, hostOf, insertRoutingHit, readVisitorId, uuidv7, visitorCookie, type RoutingHop, type RoutingTrace } from "../lib/routing-hits";
import { eligibilityAnswers, evaluateEligibility, type EligibilityRule } from "../domain/eligibility";
import { matchingQuotaCellIds, type QuotaCell } from "../domain/quota";
import { buildSurveyUrl, type SurveyParameter } from "../domain/survey-url";
import { serviceRows } from "../lib/supabase-read";
import { isValidSecretEnvName } from "../domain/marketplace";
import { adapterFor, type MarketplaceConfig } from "../providers/marketplace";
import { networkRiskContext } from "../domain/network-risk";
import { type ConfigCacheEnv, configCacheTtlMs, readConfigCache, writeConfigCache, cachedConfig } from "../lib/config-cache";
import { getSigningSecret, signOutcome, verifyOutcomeSignature } from "../lib/outcome-signatures";

// A project whose client belongs to a marketplace may need a signed entry link.
// The lookup is cached briefly; a missing `marketplaces` table (migration 053 not
// applied yet) simply means "not a marketplace", so routing never depends on it.
type MarketplaceEntry = { provider: string; config: MarketplaceConfig };
async function marketplaceEntry(env: EventEnv & ConfigCacheEnv, clientId: string | null | undefined): Promise<MarketplaceEntry | null> {
  if (!clientId) return null;
  const ttl = configCacheTtlMs(env);
  const cached = ttl > 0 ? readConfigCache<MarketplaceEntry | null>("marketplace", clientId) : { hit: false as const };
  if (cached.hit) return cached.value;
  try {
    const rows = await serviceRows<{ provider: string; config: MarketplaceConfig | null }>(env, `/rest/v1/marketplaces?select=provider,config&client_id=eq.${encodeURIComponent(clientId)}&status=eq.ACTIVE&limit=1`);
    const value = rows[0] ? { provider: rows[0].provider, config: rows[0].config ?? {} } : null;
    writeConfigCache("marketplace", clientId, value, ttl);
    return value;
  } catch (error) {
    const missingTable = error instanceof Error && /status 404/.test(error.message);
    if (missingTable) writeConfigCache("marketplace", clientId, null, ttl > 0 ? 300_000 : 0);
    else safeLog("warn", "marketplace_entry_lookup_failed", { error: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

type RedirectEnv = EventEnv & { NETWORK_RISK_ASNS?: string; ROUTER_CONFIG_CACHE_SECONDS?: string };
type Outcome = "complete" | "terminate" | "quota-full" | "security-terminate";
export type SupplierRow = { id: string; organization_id: string; status: string; redirect_mode: string; complete_url: string | null; terminate_url: string | null; quota_full_url: string | null; security_terminate_url: string | null };
type LiveProject = { id: string; client_id?: string | null; project_code: string; status: string; survey_url: string | null; test_survey_url: string | null; survey_parameters: unknown; geo_security_enabled?: boolean; clients: { redirect_token: string } | { redirect_token: string }[]; project_markets: Array<{ country_code: string; language_code: string }> };
type LiveAssignment = { id: string; supplier_id: string; target_quota: number; status: string; projects: LiveProject | LiveProject[]; suppliers?: SupplierRow | SupplierRow[] };
type EligibilityRow = { variable_key: string; operator: EligibilityRule["operator"]; values: unknown; required: boolean; active: boolean };
type QuotaCellRow = { id: string; name: string; target_quota: number; priority: number; active: boolean; conditions: unknown };
type QuotaReservationRow = { reservation_id: string | null; quota_cell_id: string | null; allowed: boolean; reason: string; reserved_until: string | null };

const outcomes: Record<Outcome, { eventType: string; field: keyof SupplierRow }> = {
  complete: { eventType: "COMPLETE", field: "complete_url" },
  terminate: { eventType: "TERMINATE", field: "terminate_url" },
  "quota-full": { eventType: "QUOTA_FULL", field: "quota_full_url" },
  "security-terminate": { eventType: "QUALITY_TERMINATE", field: "security_terminate_url" },
};

function serviceHeaders(env: RedirectEnv) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }; }
async function serviceRpc<T>(env: RedirectEnv, name: string, body: Record<string, unknown>): Promise<T[]> { const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: serviceHeaders(env), body: JSON.stringify(body) }); if (!response.ok) throw new Error(`Routing reservation failed with upstream status ${response.status}`); return response.json() as Promise<T[]>; }
function supplierExit(trace: RoutingTrace, target: string, projectCode: string, respondentRef: string, eventType: string, decision: string) {
  const url = standardSupplierRedirect(target, projectCode, respondentRef, eventType);
  trace.extraHops = [...(trace.extraHops ?? []), { hop: "SUPPLIER_EXIT", decision, targetHost: hostOf(url) }];
  return redirect(url);
}
/**
 * outcomePage hands the respondent to the supplier through a page with a Continue button and
 * countdown, so there is no 302 to observe. SUPPLIER_EXIT is logged when the page is rendered
 * with a supplier destination (HANDOFF_OFFERED); we cannot know whether the respondent clicks.
 */
function noteHandoff(trace: RoutingTrace, supplierReturn: string | undefined) {
  if (supplierReturn) trace.extraHops = [...(trace.extraHops ?? []), { hop: "SUPPLIER_EXIT", decision: "HANDOFF_OFFERED", targetHost: hostOf(supplierReturn) }];
}
function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] : value; }
function clean(value: string | null, maximum = 160) { return (value ?? "").trim().replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, maximum); }
function redirect(url: string, headers: Record<string, string> = {}) { return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer", ...headers } }); }
function routingSessionCookieName(sessionId: string) { return `rops_route_${sessionId.replaceAll("-", "")}`; }
function routingSessionCookie(sessionId: string, clientToken: string, clear = false) {
  return `${routingSessionCookieName(sessionId)}=${clear ? "" : sessionId}; Path=/r/client/${clientToken}/; Max-Age=${clear ? 0 : 21600}; HttpOnly; Secure; SameSite=Lax`;
}
function routingSessionIds(request: Request) {
  const ids = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim().split("=", 2)).filter(([name]) => name.startsWith("rops_route_")).map(([, value]) => value ?? "").filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
  return [...new Set(ids)].slice(0, 2);
}
function routingPage(title: string, message: string, status = 400, tone: "success" | "error" = "error") { return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ResearchOps</title><style>body{margin:0;background:#f4f1eb;color:#17221d;font:16px/1.5 system-ui,-apple-system,sans-serif}.card{max-width:560px;margin:12vh auto;padding:42px;border:1px solid #d8d5cd;border-radius:22px;background:#fff;box-shadow:0 18px 60px #17221d12}.mark{display:inline-block;padding:6px 10px;border-radius:999px;background:${tone === "success" ? "#dff4ed;color:#087761" : "#fae7df;color:#a53f25"};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:18px 0 8px;font-size:30px}p{margin:0;color:#59665f}.hint{margin-top:24px;padding-top:18px;border-top:1px solid #e5e2db;font-size:14px}</style></head><body><main class="card"><span class="mark">${tone === "success" ? "Test recorded" : "Routing unavailable"}</span><h1>${title}</h1><p>${message}</p><p class="hint">You can close this tab and return to the ResearchOps project workspace.</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }); }
function unavailable(message: string, status = 400) { return routingPage("We could not continue this respondent", message, status); }
function html(value: string) { return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function outcomePage(eventType: string, headers: Record<string, string> = {}, supplierReturnUrl?: string) {
  const pages: Record<string, { eyebrow: string; title: string; message: string; symbol: string; color: string; soft: string }> = {
    COMPLETE: { eyebrow: "Complete", title: "Survey completed", message: "Thank you. Your response has been successfully recorded.", symbol: "✓", color: "#087761", soft: "#dff4ed" },
    TERMINATE: { eyebrow: "Screened out", title: "Survey ended", message: "Thank you for your time. This survey has now ended.", symbol: "—", color: "#9a5b18", soft: "#fff0d5" },
    QUOTA_FULL: { eyebrow: "Quota full", title: "Survey quota reached", message: "Thank you for your interest. The required responses have been collected.", symbol: "○", color: "#315e8a", soft: "#e4eef8" },
    QUALITY_TERMINATE: { eyebrow: "Quality check", title: "Survey ended", message: "Thank you for your time. This survey cannot be continued.", symbol: "×", color: "#a53f25", soft: "#fae7df" },
  };
  const page = pages[eventType] ?? { eyebrow: "Recorded", title: "Response recorded", message: "Thank you. Your response has been recorded.", symbol: "✓", color: "#087761", soft: "#dff4ed" };
  const returnUrl = supplierReturnUrl ? html(supplierReturnUrl) : "";
  const handoff = returnUrl ? `<p class="handoff">Returning to your panel in <strong id="countdown">5</strong> seconds.</p><a class="continue" href="${returnUrl}" rel="noreferrer">Continue now</a><script>let n=5;const el=document.getElementById('countdown');const timer=setInterval(()=>{n-=1;el.textContent=String(n);if(n<=0){clearInterval(timer);location.replace(document.querySelector('.continue').href)}},1000)</script>` : "";
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page.title} | ResearchOps</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,${page.soft},transparent 42%),#f4f1eb;color:#17221d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.card{width:min(620px,100%);padding:54px 50px;text-align:center;border:1px solid #d8d5cd;border-radius:28px;background:rgba(255,255,255,.94);box-shadow:0 24px 80px rgba(23,34,29,.1)}.brand{font:600 17px Georgia,serif;letter-spacing:.08em}.symbol{width:74px;height:74px;margin:34px auto 24px;display:grid;place-items:center;border-radius:50%;background:${page.soft};color:${page.color};font-size:38px;font-weight:700}.eyebrow{color:${page.color};font-size:12px;font-weight:850;letter-spacing:.14em;text-transform:uppercase}h1{margin:12px 0 14px;font:500 clamp(34px,7vw,48px)/1.05 Georgia,serif;letter-spacing:-.03em}p{max-width:440px;margin:0 auto;color:#59665f;font-size:16px;line-height:1.65}.handoff{margin-top:24px}.continue{display:inline-flex;margin-top:14px;padding:11px 18px;border-radius:10px;background:${page.color};color:#fff;text-decoration:none;font-weight:750}@media(max-width:560px){.card{padding:40px 24px;border-radius:22px}.symbol{margin-top:28px}}</style></head><body><main class="card"><div class="brand">ResearchOps</div><div class="symbol" aria-hidden="true">${page.symbol}</div><div class="eyebrow">${page.eyebrow}</div><h1>${page.title}</h1><p>${page.message}</p>${handoff}</main></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...headers } });
}

function deviceType(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  if (/bot|crawler|spider|headless/i.test(agent)) return "BOT";
  if (/ipad|tablet/i.test(agent)) return "TABLET";
  if (/mobile|android|iphone/i.test(agent)) return "MOBILE";
  return agent ? "DESKTOP" : "UNKNOWN";
}

function browserType(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  if (/brave/i.test(agent)) return "BRAVE";
  if (/edg\//i.test(agent)) return "EDGE";
  if (/opr\//i.test(agent)) return "OPERA";
  if (/firefox|fxios/i.test(agent)) return "FIREFOX";
  if (/chrome|crios/i.test(agent)) return "CHROME";
  if (/safari/i.test(agent)) return "SAFARI";
  return agent ? "OTHER" : "UNKNOWN";
}

function operatingSystem(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  if (/android/i.test(agent)) return "ANDROID";
  if (/iphone|ipad|ipod/i.test(agent)) return "IOS";
  if (/windows/i.test(agent)) return "WINDOWS";
  if (/macintosh|mac os x/i.test(agent)) return "MAC";
  if (/linux/i.test(agent)) return "LINUX";
  return agent ? "OTHER" : "UNKNOWN";
}

function geoEvidence(request: Request, enabled: boolean, targetCountries: string[]) {
  const cf = (request as Request & { cf?: { country?: string; regionCode?: string; region?: string; city?: string } }).cf;
  const countryCode = clean(request.headers.get("x-vercel-ip-country") ?? request.headers.get("cf-ipcountry") ?? cf?.country ?? "", 2).toUpperCase();
  const regionCode = clean(request.headers.get("x-vercel-ip-country-region") ?? cf?.regionCode ?? cf?.region ?? "", 80);
  const city = clean(request.headers.get("x-vercel-ip-city") ?? cf?.city ?? "", 120);
  const targets = targetCountries.map((value) => value.toUpperCase());
  const status = !enabled ? "NOT_ENABLED" : !/^[A-Z]{2}$/.test(countryCode) ? "UNKNOWN" : targets.includes(countryCode) ? "MATCH" : "MISMATCH";
  return { countryCode, regionCode, city, status };
}

function clientIpAddress(request: Request) {
  const candidate = [request.headers.get("cf-connecting-ip"), request.headers.get("x-real-ip"), request.headers.get("x-vercel-forwarded-for"), request.headers.get("x-forwarded-for")]
    .map((value) => value?.split(",", 1)[0]?.trim() ?? "")
    .find(Boolean) ?? "";
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(candidate) && candidate.split(".").every((part) => Number(part) <= 255);
  const ipv6 = candidate.length <= 45 && candidate.includes(":") && /^[0-9a-f:]+$/i.test(candidate);
  return ipv4 || ipv6 ? candidate : "";
}

export async function recordEvent(request: Request, env: RedirectEnv, supplier: SupplierRow, projectCode: string, respondentRef: string, eventType: string, source = "redirect", isTest = false, context: Record<string, unknown> = {}) {
  const metadata = await riskMetadata(request, new URL(request.url).searchParams.get("device"), env.FRAUD_HASH_SECRET);
  return ingestNormalizedEvent({ organizationId: supplier.organization_id, projectCode, supplierId: supplier.id, respondentRef, eventType, providerTransactionId: `${eventType}:${respondentRef}`, isTest, metadata: { ...metadata, source, isTest, deviceType: deviceType(request), browserType: browserType(request), osType: operatingSystem(request), ...context } }, env);
}

const SUPPLIER_COLUMNS = "id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url";

async function supplierByToken(env: RedirectEnv, token: string) {
  // Short-code links (/s/<8 hex>) carry only the token prefix. The column is a
  // uuid, so an equality filter on a partial token fails upstream in PostgreSQL
  // (invalid input syntax for type uuid). Resolve short codes with a bounded
  // uuid range instead, and keep the exact-match path for full tokens.
  const shortCode = /^[0-9a-f]{8}$/i.test(token);
  const filter = shortCode
    ? `redirect_token=gte.${token}-0000-0000-0000-000000000000&redirect_token=lte.${token}-ffff-ffff-ffff-ffffffffffff`
    : `redirect_token=eq.${encodeURIComponent(token)}`;
  const rows = await serviceRows<SupplierRow>(env, `/rest/v1/suppliers?select=${SUPPLIER_COLUMNS}&${filter}&limit=2`);
  if (!shortCode) return rows[0];
  return rows.length === 1 ? rows[0] : undefined;
}

type RedirectContext = { waitUntil(promise: Promise<unknown>): void };

/**
 * Reads the client's return-signing policy. A 400 from PostgREST means migration 055 is not
 * applied yet (unknown column), which behaves as policy OFF; any other failure propagates so a
 * client that requires signatures is never silently downgraded.
 */
async function clientReturnCheck(env: RedirectEnv, clientId: string | null | undefined, sessionId: string, outcome: string, provided: string | null): Promise<ReturnCheck> {
  let config: ClientSigningConfig | undefined;
  if (clientId) {
    try { config = (await serviceRows<ClientSigningConfig>(env, `/rest/v1/clients?select=signing_secret_env,signed_return_policy&id=eq.${encodeURIComponent(clientId)}&limit=1`))[0]; }
    catch (error) { if (!(error instanceof Error && /upstream status 400\b/.test(error.message))) throw error; }
  }
  return checkClientReturn(config, env as unknown as Record<string, unknown>, sessionId, outcome, provided);
}

/**
 * Routes the request, then logs one routing_hits row (accepted or rejected) without
 * delaying the response. Logging only happens when an execution context is supplied.
 */
export async function handleRedirectApi(request: Request, pathname: string, env: RedirectEnv, ctx?: RedirectContext): Promise<Response | null> {
  const startedAt = Date.now();
  const trace: RoutingTrace = {};
  let response = await routeRedirect(request, pathname, env, trace);
  if (!response) return null;
  const isEntry = Boolean(parseSupplierRoute(pathname) ?? parseSupplierShortRoute(pathname) ?? parseAssignmentRoute(pathname));
  // Duration only: no ids, hosts or secrets.
  if (isEntry) { try { response.headers.set("server-timing", `entry;dur=${Date.now() - startedAt}`); } catch { /* immutable headers: skip */ } }
  const hop: RoutingHop = isEntry ? "SUPPLIER_ENTRY" : "CLIENT_RETURN";
  const existingVisitor = readVisitorId(request);
  const visitorId = existingVisitor ?? uuidv7();
  if (isEntry && !existingVisitor) {
    const tagged = new Response(response.body, response);
    tagged.headers.append("set-cookie", visitorCookie(visitorId));
    response = tagged;
  }
  if (ctx && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const finalResponse = response;
    const routeKind = isEntry ? (parseAssignmentRoute(pathname) ? "assignment" : "supplier") : parseOutcomeRoute(pathname) ? "outcome" : "client";
    if (!trace.targetHost) trace.targetHost = hostOf(finalResponse.headers.get("location"));
    ctx.waitUntil((async () => {
      const row = await buildRoutingHit({ request, env, trace, hop, routeKind, status: finalResponse.status, clickId: uuidv7(), visitorId, latencyMs: Date.now() - startedAt });
      await insertRoutingHit(env, row);
      for (const extra of trace.extraHops ?? []) {
        try {
          const extraRow = await buildRoutingHit({ request, env, trace: { ...trace, decision: extra.decision, targetHost: extra.targetHost }, hop: extra.hop, routeKind, status: finalResponse.status, clickId: uuidv7(), visitorId, latencyMs: Date.now() - startedAt });
          await insertRoutingHit(env, extraRow);
        } catch { /* logging must never affect the respondent */ }
      }
    })());
  }
  return response;
}

async function routeRedirect(request: Request, pathname: string, env: RedirectEnv, trace: RoutingTrace): Promise<Response | null> {
  const supplierRoute = parseSupplierRoute(pathname) ?? parseSupplierShortRoute(pathname);
  const assignmentRoute = parseAssignmentRoute(pathname);
  const clientRoute = parseClientRoute(pathname);
  const outcomeRoute = parseOutcomeRoute(pathname);
  if (!supplierRoute && !assignmentRoute && !clientRoute && !outcomeRoute) return null;
  if (request.method !== "GET") return unavailable("Method not allowed", 405);
  const url = new URL(request.url);
  const diagnose = url.searchParams.get("diagnose") === "1" || url.searchParams.get("format") === "json";
  const help = (message: string, status: number, extra: Record<string, unknown> = {}) => {
    if (!diagnose) return unavailable(message, status);
    return Response.json({ ok: false, error: message, status, route: pathname, expected: ROUTING_HELP, ...extra }, { status, headers: { "cache-control": "no-store" } });
  };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return help("Routing is not configured", 503, { fix: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker, then retry the link." });

  let routingStage = "route initialization";
  try {
    if (supplierRoute || assignmentRoute) {
      let assignment: LiveAssignment | undefined;
      let project: LiveProject | undefined;
      let supplier: SupplierRow | undefined;
      if (assignmentRoute) {
        routingStage = "masked assignment lookup";
        const rows = await serviceRows<LiveAssignment>(env, `/rest/v1/project_suppliers?select=id,supplier_id,target_quota,status,suppliers(${SUPPLIER_COLUMNS}),projects!inner(id,client_id,project_code,status,survey_url,test_survey_url,survey_parameters,geo_security_enabled,clients(redirect_token),project_markets(country_code,language_code))&id=eq.${encodeURIComponent(assignmentRoute.token)}&limit=1`);
        assignment = rows[0];
        project = assignment ? first(assignment.projects) ?? undefined : undefined;
        supplier = assignment ? first(assignment.suppliers) ?? undefined : undefined;
      } else {
        routingStage = "supplier lookup";
        supplier = await supplierByToken(env, supplierRoute!.token);
      }
      if (supplier) { trace.organizationId = supplier.organization_id; trace.supplierId = supplier.id; }
      if (!supplier || supplier.status !== "ACTIVE") trace.decision = "INACTIVE";
      if (!supplier || supplier.status !== "ACTIVE") return help("Supplier link is inactive", 404, { fix: "Set the supplier status to ACTIVE in the Supplier directory." });
      if (supplierRoute?.mode === "test") {
        const outcome = (url.searchParams.get("outcome") ?? "complete").toLowerCase() as Outcome;
        const configuration = outcomes[outcome];
        if (!configuration) return help("Choose complete, terminate, quota-full, or security-terminate", 400, { fix: ROUTING_HELP.supplierTestExample });
        const target = supplier[configuration.field];
        return typeof target === "string" && target ? redirect(standardSupplierRedirect(target, "TEST-PROJECT", "TEST-RESPONDENT", configuration.eventType)) : help(`${outcome} redirect is not configured`, 422, { fix: "Add the supplier return URL in the Supplier directory before testing." });
      }

      const isTest = url.searchParams.get("mode") === "test";
      const routeToken = assignmentRoute?.token ?? supplierRoute!.token;
      const projectCode = project?.project_code ?? readProjectCode(url.searchParams);
      const respondentRef = readRespondentRef(url.searchParams);
      const inputsValid = /^[A-Z]{2,10}-[A-Z0-9-]+$/.test(projectCode) && Boolean(respondentRef);
      // The rate-limit check and the assignment lookup do not depend on each other, so they run
      // concurrently. The lookup is only started for well-formed input, and its outcome (even a
      // failure) is only consulted after the rate limit has passed, so the order of decisions is
      // unchanged: rate limit, then input validation, then assignment.
      const lookup = !assignment && inputsValid
        ? serviceRows<LiveAssignment>(env, `/rest/v1/project_suppliers?select=id,supplier_id,target_quota,status,projects!inner(id,client_id,project_code,status,survey_url,test_survey_url,survey_parameters,geo_security_enabled,clients(redirect_token),project_markets(country_code,language_code))&supplier_id=eq.${supplier.id}&projects.project_code=eq.${encodeURIComponent(projectCode)}&limit=1`).then((rows) => ({ rows }), (error: unknown) => ({ error }))
        : undefined;
      const limited = await checkSharedRateLimit(env, `supplier-live:${routeToken}`, 120, 60, { ip: request.headers.get("cf-connecting-ip") ?? "unknown" });
      if (!limited.allowed) return rateLimitResponse(limited);
      trace.respondentRef = respondentRef || undefined;
      if (!inputsValid) trace.decision = "INVALID";
      if (!inputsValid) return help(assignmentRoute ? "ARID is required" : "Project and respondent are required", 400, { fix: assignmentRoute ? `/l/${assignmentRoute.token}?arid=UNIQUE-ID` : ROUTING_HELP.supplierLiveExample });
      if (!assignment) {
        routingStage = "project assignment lookup";
        const looked = await lookup!;
        if ("error" in looked) throw looked.error;
        assignment = looked.rows[0]; project = assignment ? first(assignment.projects) ?? undefined : undefined;
      }
      if (!assignment || !project) trace.decision = "NOT_ASSIGNED"; else trace.projectId = project.id;
      if (!assignment || !project) return help("The supplier is not assigned to this project.", 404, { fix: "Assign this supplier to the project in Project details → Supplier delivery." });
      if (!isTest && (assignment.status !== "ACTIVE" || project.status !== "LIVE")) {
        trace.decision = "PAUSED";
        const target = supplier.terminate_url ?? supplier.security_terminate_url;
        return target ? supplierExit(trace, target, projectCode, respondentRef, "TERMINATE", "PAUSED_EXIT") : help("Project traffic is not active", 409, { fix: "Set the project to LIVE and the supplier assignment to ACTIVE." });
      }
      routingStage = "eligibility lookup";
      // Eligibility rules, quota cells and the marketplace entry config are independent reads of
      // slow-changing configuration (cached up to ROUTER_CONFIG_CACHE_SECONDS, see lib/config-cache.ts),
      // so they run concurrently. Quota cells and the marketplace entry are speculative: failures are
      // captured and only surface at the point the sequential code used to read them.
      const projectId = project.id;
      const settle = <T,>(promise: Promise<T>) => promise.then((value) => ({ value }), (error: unknown) => ({ error }));
      const quotaCellsRead = isTest ? undefined : settle(cachedConfig(env, "quota-cells", projectId, () => serviceRows<QuotaCellRow>(env, `/rest/v1/project_quota_cells?select=id,name,target_quota,priority,active,conditions&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true&order=priority.asc,name.asc`)));
      const marketplaceRead = marketplaceEntry(env, project.client_id);
      const eligibilityRows = await cachedConfig(env, "eligibility-rules", projectId, () => serviceRows<EligibilityRow>(env, `/rest/v1/project_eligibility_rules?select=variable_key,operator,values,required,active&project_id=eq.${encodeURIComponent(projectId)}&active=eq.true&order=sort_order.asc`));
      const answers = eligibilityAnswers(url.searchParams);
      const market = project.project_markets?.[0]; const sessionContext = { countryCode: /^[A-Za-z]{2}$/.test(answers.country ?? "") ? answers.country!.toUpperCase() : market?.country_code, languageCode: /^[A-Za-z]{2}$/.test(answers.language ?? "") ? answers.language!.toLowerCase() : market?.language_code, responseVariables: answers };
      const eligibility = evaluateEligibility(eligibilityRows.map((rule) => ({ variableKey: rule.variable_key, operator: rule.operator, values: Array.isArray(rule.values) ? rule.values.map(String) : [], required: rule.required, active: rule.active })), answers);
      if (!eligibility.eligible) {
        trace.decision = "INELIGIBLE";
        const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START", isTest ? "test-redirect" : "redirect", isTest, { ...sessionContext, ...networkRiskContext(request, env, isTest) });
        if (!start.ok) return help("The respondent session could not be started", 502, { stage: routingStage });
        await recordEvent(request, env, supplier, projectCode, respondentRef, "TERMINATE", `eligibility:${eligibility.failedRule ?? "rule"}`, isTest, { reasonCode: "ELIGIBILITY_SCREEN_OUT" });
        return supplier.terminate_url ? supplierExit(trace, supplier.terminate_url, projectCode, respondentRef, "TERMINATE", "INELIGIBLE_EXIT") : help(eligibility.reason ?? "The respondent is not eligible for this study", 200);
      }
      let reservationId: string | null = null;
      if (!isTest) {
        const quotaRead = await quotaCellsRead!;
        if ("error" in quotaRead) throw quotaRead.error;
        const quotaRows = quotaRead.value;
        const quotaCells: QuotaCell[] = quotaRows.map((cell) => ({ id: cell.id, name: cell.name, targetQuota: cell.target_quota, priority: cell.priority, active: cell.active, conditions: (Array.isArray(cell.conditions) ? cell.conditions : []).map((condition) => { const value = condition as Record<string, unknown>; return { variableKey: String(value.variable_key ?? ""), operator: String(value.operator ?? "EQ") as EligibilityRule["operator"], values: Array.isArray(value.values) ? value.values.map(String) : [], required: value.required !== false, active: true }; }) }));
        const reservations = await serviceRpc<QuotaReservationRow>(env, "reserve_project_quota", { p_organization_id: supplier.organization_id, p_project_code: projectCode, p_supplier_id: supplier.id, p_respondent_ref: respondentRef, p_matching_cell_ids: matchingQuotaCellIds(quotaCells, answers) });
        if (!reservations[0]?.allowed) {
        trace.decision = "QUOTA_FULL";
          await recordEvent(request, env, supplier, projectCode, respondentRef, "QUOTA_FULL", `quota:${reservations[0]?.reason ?? "full"}`, false, { reasonCode: "QUOTA_FULL" });
          return supplier.quota_full_url ? supplierExit(trace, supplier.quota_full_url, projectCode, respondentRef, "QUOTA_FULL", "QUOTA_FULL_EXIT") : unavailable("The requested quota is full", 409);
        }
        reservationId = reservations[0].reservation_id;
      }
      routingStage = "respondent start";
      const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START", isTest ? "test-redirect" : "redirect", isTest, { ...sessionContext, ...networkRiskContext(request, env, isTest) });
      const startBody = await start.json().catch(() => null) as { data?: { sessionId?: string } } | null;
      trace.sessionId = startBody?.data?.sessionId;
      if (!start.ok) { if (reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []); return help("The respondent session could not be started", 502, { stage: routingStage }); }
      const geo = geoEvidence(request, project.geo_security_enabled === true, project.project_markets.map((item) => item.country_code));
      const surveyTemplate = isTest ? project.test_survey_url || project.survey_url : project.survey_url;
      // Network-context capture, the open-HIGH-flag check and the outcome-token read depend only on
      // the session id, not on each other (capture does not raise fraud flags), so they overlap.
      // The two reads are only started when the code below is going to need them, and their failures
      // are captured and raised where the sequential code used to raise them. Capture finishes
      // before any further event is written.
      const sessionIdForReads = startBody?.data?.sessionId;
      const proceeds = Boolean(sessionIdForReads) && geo.status !== "MISMATCH" && Boolean(surveyTemplate);
      const flagsRead = proceeds ? settle(serviceRows<{ id: string }>(env, `/rest/v1/fraud_flags?select=id&session_id=eq.${sessionIdForReads}&status=eq.OPEN&severity=eq.HIGH&limit=1`)) : undefined;
      const tokenRead = proceeds ? settle(serviceRows<{ outcome_token: string }>(env, `/rest/v1/survey_sessions?select=outcome_token&id=eq.${encodeURIComponent(sessionIdForReads!)}&limit=1`)) : undefined;
      if (sessionIdForReads) {
        try { await serviceRpc(env, "capture_session_network_context", { p_session_id: sessionIdForReads, p_ip_address: clientIpAddress(request), p_country_code: geo.countryCode, p_region_code: geo.regionCode, p_city: geo.city, p_check_status: geo.status }); }
        catch (error) { safeLog("warn", "session_network_context_capture_failed", { path: pathname, error: error instanceof Error ? error.message : "Unknown network-context failure" }); }
      }
      if (geo.status === "MISMATCH") {
        trace.decision = "SECURITY";
        if (reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []);
        await recordEvent(request, env, supplier, projectCode, respondentRef, "QUALITY_TERMINATE", "geo-security", isTest, { reasonCode: "GEO_COUNTRY_MISMATCH", detectedCountry: geo.countryCode });
        return supplier.security_terminate_url ? supplierExit(trace, supplier.security_terminate_url, projectCode, respondentRef, "QUALITY_TERMINATE", "SECURITY_EXIT") : help("The respondent location does not match the project market", 403);
      }
      if (!surveyTemplate) {
        if (!isTest && reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []);
        await recordEvent(request, env, supplier, projectCode, respondentRef, "ABANDON", "routing", isTest, { reasonCode: "CLIENT_SURVEY_URL_MISSING" });
        return isTest
          ? routingPage("The test hit was recorded", "ST has been added to supplier metrics. Add a valid client survey URL to test the onward redirect and RC metric.", 200, "success")
          : help("The client survey URL is not configured", 422, { fix: "Set the live survey URL in Project details → Survey routing setup." });
      }
      if (startBody?.data?.sessionId) {
        routingStage = "fraud check";
        const flagsResult = await flagsRead!;
        if ("error" in flagsResult) throw flagsResult.error;
        const flags = flagsResult.value;
        if (flags[0]) { await recordEvent(request, env, supplier, projectCode, respondentRef, "QUALITY_TERMINATE", "security", isTest, { reasonCode: "SECURITY_REJECT" }); return supplier.security_terminate_url ? supplierExit(trace, supplier.security_terminate_url, projectCode, respondentRef, "QUALITY_TERMINATE", "SECURITY_EXIT") : help("The respondent did not pass security checks", 403); }
      }
      const sessionId = startBody?.data?.sessionId;
      if (!sessionId) return help("The respondent session could not be secured", 502, { stage: routingStage });
      routingStage = "outcome route lookup";
      const tokenResult = await tokenRead!;
      if ("error" in tokenResult) throw tokenResult.error;
      const sessionRows = tokenResult.value;
      const outcomeToken = sessionRows[0]?.outcome_token;
      if (!outcomeToken) return help("The respondent outcome route could not be created", 502, { stage: routingStage });
      const secret = getSigningSecret(env);
      const [completeSig, terminateSig, quotaFullSig, securityTerminateSig] = await Promise.all([
        signOutcome(outcomeToken, "complete", secret),
        signOutcome(outcomeToken, "terminate", secret),
        signOutcome(outcomeToken, "quota-full", secret),
        signOutcome(outcomeToken, "security-terminate", secret),
      ]);
      const callback = (outcome: Outcome) => {
        const sig = outcome === "complete" ? completeSig
          : outcome === "terminate" ? terminateSig
          : outcome === "quota-full" ? quotaFullSig
          : securityTerminateSig;
        return outcomeRouteFromSession(url.origin, outcomeToken, outcome, sig);
      };
      const configuredParameters = Array.isArray(project.survey_parameters) ? project.survey_parameters.filter((value): value is SurveyParameter => { const item = value as Partial<SurveyParameter>; return typeof item?.name === "string" && typeof item?.value === "string"; }) : [];
      const surveyUrl = buildSurveyUrl(surveyTemplate, configuredParameters, { ...answers, project_id: projectCode, transaction_id: sessionId, respondent_id: respondentRef, session_id: sessionId, complete_url: callback("complete"), terminate_url: callback("terminate"), quota_full_url: callback("quota-full"), security_terminate_url: callback("security-terminate") });
      if (!surveyUrl.searchParams.has("rid")) surveyUrl.searchParams.set("rid", sessionId);
      if (!surveyUrl.searchParams.has("complete_url")) surveyUrl.searchParams.set("complete_url", callback("complete"));
      if (!surveyUrl.searchParams.has("terminate_url")) surveyUrl.searchParams.set("terminate_url", callback("terminate"));
      if (!surveyUrl.searchParams.has("quota_full_url")) surveyUrl.searchParams.set("quota_full_url", callback("quota-full"));
      if (!surveyUrl.searchParams.has("security_terminate_url")) surveyUrl.searchParams.set("security_terminate_url", callback("security-terminate"));
      let destination = surveyUrl.toString();
      const marketplace = await marketplaceRead;
      if (marketplace?.config.entrySigning?.enabled) {
        routingStage = "marketplace entry link";
        const secretEnv = marketplace.config.secretEnv;
        destination = await adapterFor(marketplace.provider).buildEntryUrl(destination, marketplace.config, isValidSecretEnvName(secretEnv) ? (env as unknown as Record<string, string | undefined>)[secretEnv] : undefined);
      }
      routingStage = "client reached event";
      await recordEvent(request, env, supplier, projectCode, respondentRef, "REACHED_CLIENT", isTest ? "test-redirect" : "redirect", isTest);
      const clientToken = first(project.clients)?.redirect_token;
      trace.extraHops = [{ hop: "CLIENT_REDIRECT", decision: "ROUTED", targetHost: hostOf(destination) }];
      return redirect(destination, clientToken ? { "set-cookie": routingSessionCookie(sessionId, clientToken) } : {});
    }

    if (outcomeRoute) {
      const quotaReservationId = clean(url.searchParams.get("quota_reservation_id") ?? url.searchParams.get("reservation_id"), 80) || undefined;
      const signature = url.searchParams.get("sig");
      const secret = getSigningSecret(env);
      if (signature) {
        const isValid = await verifyOutcomeSignature(outcomeRoute.token, outcomeRoute.outcome, signature, secret);
        if (!isValid) return help("The respondent outcome signature is invalid", 403, { stage: "outcome signature verification" });
      }
      const tokenField = outcomeRoute.outcome === "complete" ? "complete_token"
        : outcomeRoute.outcome === "terminate" ? "terminate_token"
        : outcomeRoute.outcome === "quota-full" ? "quota_full_token"
        : "security_terminate_token";
      const sessionSelect = "id,respondent_ref,status,is_test,projects!inner(project_code,client_id),project_suppliers(suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))";
      let outcomeSessions = await serviceRows<{ respondent_ref: string; status: string; is_test: boolean; projects: { project_code: string } | { project_code: string }[]; project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[] }>(env, `/rest/v1/survey_sessions?select=${sessionSelect}&${tokenField}=eq.${encodeURIComponent(outcomeRoute.token)}&limit=1`).catch(() => []);
      if (!outcomeSessions.length) {
        outcomeSessions = await serviceRows<{ respondent_ref: string; status: string; is_test: boolean; projects: { project_code: string } | { project_code: string }[]; project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[] }>(env, `/rest/v1/survey_sessions?select=${sessionSelect}&outcome_token=eq.${encodeURIComponent(outcomeRoute.token)}&limit=1`);
      }
      const outcomeSession = outcomeSessions[0]; const outcomeProject = outcomeSession ? first(outcomeSession.projects) : undefined; const outcomeAssignment = outcomeSession ? first(outcomeSession.project_suppliers) : undefined; const outcomeSupplier = outcomeAssignment ? first(outcomeAssignment.suppliers) : undefined;
      if (!outcomeSession || !outcomeProject || !outcomeSupplier) return help("Respondent routing session was not found", 404, { fix: "Open this outcome link only from a fresh supplier launch; each session token works once." });
      trace.organizationId = outcomeSupplier.organization_id; trace.supplierId = outcomeSupplier.id; trace.respondentRef = outcomeSession.respondent_ref; trace.sessionId = (outcomeSession as unknown as { id?: string }).id;
      const terminalStatuses = new Set(["COMPLETE", "TERMINATE", "QUOTA_FULL", "QUALITY_TERMINATE", "ABANDON"]);
      const expectedEvent = outcomes[outcomeRoute.outcome].eventType;
      if (terminalStatuses.has(outcomeSession.status) && outcomeSession.status !== expectedEvent) return help(`This respondent is already recorded as ${outcomeSession.status.toLowerCase().replaceAll("_", " ")}`, 409);
      const reasonCode = expectedEvent === "TERMINATE" ? "CLIENT_TERMINATE" : expectedEvent === "QUOTA_FULL" ? "QUOTA_FULL" : expectedEvent === "QUALITY_TERMINATE" ? "QUALITY_REJECT" : undefined;
      let returnVerification: string | undefined;
      if (outcomeSession.status !== expectedEvent) {
        routingStage = "client return verification";
        const check = await clientReturnCheck(env, (outcomeProject as unknown as { client_id?: string }).client_id, trace.sessionId ?? "", outcomeRoute.outcome, url.searchParams.get("h"));
        if (!check.ok) { trace.decision = "SECURITY"; return help(check.reason, check.status, { stage: routingStage }); }
        returnVerification = check.verification;
      }
      const result = await recordEvent(request, env, outcomeSupplier, outcomeProject.project_code, outcomeSession.respondent_ref, expectedEvent, "client-outcome", outcomeSession.is_test, { ...(reasonCode ? { reasonCode } : {}), ...(returnVerification ? { returnVerification } : {}) });
      if (!result.ok) return help("The respondent outcome could not be recorded", 502, { stage: "respondent outcome" });
      if (quotaReservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: quotaReservationId }).catch(() => []);
      const target = outcomeSupplier[outcomes[outcomeRoute.outcome].field];
      const supplierReturn = typeof target === "string" && target ? standardSupplierRedirect(target, outcomeProject.project_code, outcomeSession.respondent_ref, expectedEvent) : undefined;
      noteHandoff(trace, supplierReturn);
      return outcomePage(expectedEvent, {}, supplierReturn);
    }

    const outcome = clientRoute!.outcome;
    const requestedProjectCode = readProjectCode(url.searchParams); let clientAttemptId = readClientAttemptId(url.searchParams);
    if (hasUnresolvedClientAttemptId(url.searchParams)) {
      const browserSessions = routingSessionIds(request);
      if (browserSessions.length === 1) clientAttemptId = browserSessions[0];
      else return help("The client returned an unresolved respondent placeholder", 400, { fix: browserSessions.length > 1 ? "More than one respondent session is open in this browser. Use the signed per-session outcome URL supplied on launch." : "Start from the ResearchOps supplier link in this browser, or replace xxxx with the ResearchOps session UUID received as pid/rid at survey entry." });
    }
    if (!clientAttemptId) return help("Respondent ID is required", 400, { fix: ROUTING_HELP.clientExample });
    const clients = await serviceRows<{ id: string }>(env, `/rest/v1/clients?select=id&redirect_token=eq.${encodeURIComponent(clientRoute!.token)}&limit=1`); if (!clients[0]) return help("Client link was not found", 404);
    const projectFilter = requestedProjectCode ? `projects.project_code=eq.${encodeURIComponent(requestedProjectCode)}` : `projects.client_id=eq.${clients[0].id}`;
    type ClientSession = { respondent_ref: string; is_test: boolean; projects: { project_code: string; client_id: string } | { project_code: string; client_id: string }[]; project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[] };
    const sessionSelect = "id,respondent_ref,status,is_test,projects!inner(project_code,client_id),project_suppliers(suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))";
    const sessionQuery = (field: "id" | "respondent_ref") => `/rest/v1/survey_sessions?select=${sessionSelect}&${field}=eq.${encodeURIComponent(clientAttemptId)}&${projectFilter}&order=started_at.desc&limit=${field === "id" ? 1 : 2}`;
    const isSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientAttemptId);
    let sessions = isSessionId ? await serviceRows<ClientSession>(env, sessionQuery("id")) : [];
    // Surveys launched before this separation still return the supplier reference.
    if (!sessions.length) {
      sessions = await serviceRows<ClientSession>(env, sessionQuery("respondent_ref"));
      if (sessions.length > 1) return help("This legacy respondent ID matches more than one survey attempt", 409, { fix: "Return the ResearchOps session UUID from the survey instead of the supplier reference." });
    }
    const session = sessions[0]; const project = session ? first(session.projects) : undefined; const assignment = session ? first(session.project_suppliers) : undefined; const supplier = assignment ? first(assignment.suppliers) : undefined;
    if (!session || !project || project.client_id !== clients[0].id || !supplier) return help("Respondent routing session was not found", 404, { fix: "Return the ResearchOps session UUID received at survey entry, and include ?project=ROP-XXX." });
    trace.organizationId = supplier.organization_id; trace.supplierId = supplier.id; trace.respondentRef = session.respondent_ref; trace.sessionId = (session as unknown as { id?: string }).id;
    const projectCode = project.project_code;
    const eventType = outcomes[outcome].eventType; const reasonCode = eventType === "TERMINATE" ? "CLIENT_TERMINATE" : eventType === "QUOTA_FULL" ? "QUOTA_FULL" : eventType === "QUALITY_TERMINATE" ? "QUALITY_REJECT" : undefined;
    let returnVerification: string | undefined;
    if ((session as unknown as { status?: string }).status !== eventType) {
      routingStage = "client return verification";
      const check = await clientReturnCheck(env, clients[0].id, trace.sessionId ?? "", outcome, url.searchParams.get("h"));
      if (!check.ok) { trace.decision = "SECURITY"; return help(check.reason, check.status, { stage: routingStage }); }
      returnVerification = check.verification;
    }
    const result = await recordEvent(request, env, supplier, projectCode, session.respondent_ref, eventType, "client-outcome", session.is_test, { ...(reasonCode ? { reasonCode } : {}), ...(returnVerification ? { returnVerification } : {}) }); if (!result.ok) return help("The respondent outcome could not be recorded", 502, { stage: "respondent outcome" });
    const target = supplier[outcomes[outcome].field];
    const supplierReturn = typeof target === "string" && target ? standardSupplierRedirect(target, projectCode, session.respondent_ref, outcomes[outcome].eventType) : undefined;
    noteHandoff(trace, supplierReturn);
    return outcomePage(outcomes[outcome].eventType, { "set-cookie": routingSessionCookie(clientAttemptId, clientRoute!.token, true) }, supplierReturn);
  } catch (error) {
    const id = requestId(request);
    safeLog("error", "redirect_failed", { requestId: id, path: pathname, stage: routingStage, error: error instanceof Error ? error.message : "Unknown redirect failure" });
    const upstreamStatus = error instanceof Error ? error.message.match(/upstream status (\d{3})/)?.[1] : undefined;
    return unavailable(`The routing configuration failed during ${routingStage}${upstreamStatus ? ` (upstream ${upstreamStatus})` : ""}. Reference: ${id}`, 502);
  }
}
