import { ingestNormalizedEvent, type EventEnv } from "./events";
import { riskMetadata } from "../lib/fraud";
import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit";
import { standardSupplierRedirect } from "../domain/supplier-redirect";
import { outcomeRouteFromSession, parseClientRoute, parseOutcomeRoute, parseSupplierRoute, parseSupplierShortRoute, readClientAttemptId, readProjectCode, readRespondentRef, ROUTING_HELP } from "../domain/routing-links";
import { requestId, safeLog } from "../lib/observability";
import { eligibilityAnswers, evaluateEligibility, type EligibilityRule } from "../domain/eligibility";
import { matchingQuotaCellIds, type QuotaCell } from "../domain/quota";
import { buildSurveyUrl, type SurveyParameter } from "../domain/survey-url";
import { serviceRows } from "../lib/supabase-read";

type RedirectEnv = EventEnv;
type Outcome = "complete" | "terminate" | "quota-full" | "security-terminate";
type SupplierRow = { id: string; organization_id: string; status: string; redirect_mode: string; complete_url: string | null; terminate_url: string | null; quota_full_url: string | null; security_terminate_url: string | null };
type LiveProject = { id: string; project_code: string; status: string; survey_url: string | null; test_survey_url: string | null; survey_parameters: unknown; clients: { redirect_token: string } | { redirect_token: string }[]; project_markets: Array<{ country_code: string; language_code: string }> };
type LiveAssignment = { id: string; supplier_id: string; target_quota: number; status: string; projects: LiveProject | LiveProject[] };
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
async function supplierScopedRefReady(env: RedirectEnv) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/supplier_scoped_ref_ready`, { headers: serviceHeaders(env) });
  if (response.ok) return await response.json() === true;
  const error = await response.json().catch(() => null) as { code?: string } | null;
  if (response.status === 404 && error?.code === "PGRST202") return false;
  throw new Error(`Supplier reference scope check failed with upstream status ${response.status}`);
}
function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] : value; }
function clean(value: string | null, maximum = 160) { return (value ?? "").trim().replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, maximum); }
function redirect(url: string) { return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } }); }
function routingPage(title: string, message: string, status = 400, tone: "success" | "error" = "error") { return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ResearchOps</title><style>body{margin:0;background:#f4f1eb;color:#17221d;font:16px/1.5 system-ui,-apple-system,sans-serif}.card{max-width:560px;margin:12vh auto;padding:42px;border:1px solid #d8d5cd;border-radius:22px;background:#fff;box-shadow:0 18px 60px #17221d12}.mark{display:inline-block;padding:6px 10px;border-radius:999px;background:${tone === "success" ? "#dff4ed;color:#087761" : "#fae7df;color:#a53f25"};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:18px 0 8px;font-size:30px}p{margin:0;color:#59665f}.hint{margin-top:24px;padding-top:18px;border-top:1px solid #e5e2db;font-size:14px}</style></head><body><main class="card"><span class="mark">${tone === "success" ? "Test recorded" : "Routing unavailable"}</span><h1>${title}</h1><p>${message}</p><p class="hint">You can close this tab and return to the ResearchOps project workspace.</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }); }
function unavailable(message: string, status = 400) { return routingPage("We could not continue this respondent", message, status); }
function outcomePage(eventType: string) {
  const pages: Record<string, { eyebrow: string; title: string; message: string; symbol: string; color: string; soft: string }> = {
    COMPLETE: { eyebrow: "Complete", title: "Survey completed", message: "Thank you. Your response has been successfully recorded.", symbol: "✓", color: "#087761", soft: "#dff4ed" },
    TERMINATE: { eyebrow: "Screened out", title: "Survey ended", message: "Thank you for your time. This survey has now ended.", symbol: "—", color: "#9a5b18", soft: "#fff0d5" },
    QUOTA_FULL: { eyebrow: "Quota full", title: "Survey quota reached", message: "Thank you for your interest. The required responses have been collected.", symbol: "○", color: "#315e8a", soft: "#e4eef8" },
    QUALITY_TERMINATE: { eyebrow: "Quality check", title: "Survey ended", message: "Thank you for your time. This survey cannot be continued.", symbol: "×", color: "#a53f25", soft: "#fae7df" },
  };
  const page = pages[eventType] ?? { eyebrow: "Recorded", title: "Response recorded", message: "Thank you. Your response has been recorded.", symbol: "✓", color: "#087761", soft: "#dff4ed" };
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${page.title} | ResearchOps</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 0,${page.soft},transparent 42%),#f4f1eb;color:#17221d;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.card{width:min(620px,100%);padding:54px 50px;text-align:center;border:1px solid #d8d5cd;border-radius:28px;background:rgba(255,255,255,.94);box-shadow:0 24px 80px rgba(23,34,29,.1)}.brand{font:600 17px Georgia,serif;letter-spacing:.08em}.symbol{width:74px;height:74px;margin:34px auto 24px;display:grid;place-items:center;border-radius:50%;background:${page.soft};color:${page.color};font-size:38px;font-weight:700}.eyebrow{color:${page.color};font-size:12px;font-weight:850;letter-spacing:.14em;text-transform:uppercase}h1{margin:12px 0 14px;font:500 clamp(34px,7vw,48px)/1.05 Georgia,serif;letter-spacing:-.03em}p{max-width:440px;margin:0 auto;color:#59665f;font-size:16px;line-height:1.65}@media(max-width:560px){.card{padding:40px 24px;border-radius:22px}.symbol{margin-top:28px}}</style></head><body><main class="card"><div class="brand">ResearchOps</div><div class="symbol" aria-hidden="true">${page.symbol}</div><div class="eyebrow">${page.eyebrow}</div><h1>${page.title}</h1><p>${page.message}</p></main></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

function deviceType(request: Request) {
  const agent = request.headers.get("user-agent") ?? "";
  if (/bot|crawler|spider|headless/i.test(agent)) return "BOT";
  if (/ipad|tablet/i.test(agent)) return "TABLET";
  if (/mobile|android|iphone/i.test(agent)) return "MOBILE";
  return agent ? "DESKTOP" : "UNKNOWN";
}

async function recordEvent(request: Request, env: RedirectEnv, supplier: SupplierRow, projectCode: string, respondentRef: string, eventType: string, source = "redirect", isTest = false, context: Record<string, unknown> = {}) {
  const metadata = await riskMetadata(request, new URL(request.url).searchParams.get("device"), env.FRAUD_HASH_SECRET);
  return ingestNormalizedEvent({ organizationId: supplier.organization_id, projectCode, supplierId: supplier.id, respondentRef, eventType, providerTransactionId: `${eventType}:${respondentRef}`, isTest, metadata: { ...metadata, source, isTest, deviceType: deviceType(request), ...context } }, env);
}

async function supplierByToken(env: RedirectEnv, token: string) {
  const rows = await serviceRows<SupplierRow>(env, `/rest/v1/suppliers?select=id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url&redirect_token=eq.${encodeURIComponent(token)}&limit=1`);
  if (rows[0]) return rows[0];
  // Short-code links (/s/<8hex>) carry only the token prefix; resolve the full
  // supplier by matching the redirect_token prefix. The column is a uuid, so
  // PostgREST ilike cannot cast it — use a bounded uuid range instead.
  if (/^[0-9a-f]{8}$/i.test(token)) {
    const lower = `${token}-0000-0000-0000-000000000000`;
    const upper = `${token}-ffff-ffff-ffff-ffffffffffff`;
    const candidates = await serviceRows<SupplierRow>(env, `/rest/v1/suppliers?select=id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url&redirect_token=gte.${lower}&redirect_token=lte.${upper}&limit=2`);
    return candidates.length === 1 ? candidates[0] : undefined;
  }
  return undefined;
}

export async function handleRedirectApi(request: Request, pathname: string, env: RedirectEnv): Promise<Response | null> {
  const supplierRoute = parseSupplierRoute(pathname) ?? parseSupplierShortRoute(pathname);
  const clientRoute = parseClientRoute(pathname);
  const outcomeRoute = parseOutcomeRoute(pathname);
  if (!supplierRoute && !clientRoute && !outcomeRoute) return null;
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
    if (supplierRoute) {
      routingStage = "supplier lookup";
      const supplier = await supplierByToken(env, supplierRoute.token);
      if (!supplier || supplier.status !== "ACTIVE") return help("Supplier link is inactive", 404, { fix: "Set the supplier status to ACTIVE in the Supplier directory." });
      if (supplierRoute.mode === "test") {
        const outcome = (url.searchParams.get("outcome") ?? "complete").toLowerCase() as Outcome;
        const configuration = outcomes[outcome];
        if (!configuration) return help("Choose complete, terminate, quota-full, or security-terminate", 400, { fix: ROUTING_HELP.supplierTestExample });
        const target = supplier[configuration.field];
        return typeof target === "string" && target ? redirect(standardSupplierRedirect(target, "TEST-PROJECT", "TEST-RESPONDENT", configuration.eventType)) : help(`${outcome} redirect is not configured`, 422, { fix: "Add the supplier return URL in the Supplier directory before testing." });
      }

      const isTest = url.searchParams.get("mode") === "test";
      const limited = checkRateLimit(`supplier-live:${supplierRoute.token}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, 120, 60);
      if (!limited.allowed) return rateLimitResponse(limited);
      const projectCode = readProjectCode(url.searchParams);
      const respondentRef = readRespondentRef(url.searchParams);
      if (!/^[A-Z]{2,10}-[A-Z0-9-]+$/.test(projectCode) || !respondentRef) return help("Project and respondent are required", 400, { fix: ROUTING_HELP.supplierLiveExample });
      routingStage = "project assignment lookup";
      const rows = await serviceRows<LiveAssignment>(env, `/rest/v1/project_suppliers?select=id,supplier_id,target_quota,status,projects!inner(id,project_code,status,survey_url,test_survey_url,survey_parameters,clients(redirect_token),project_markets(country_code,language_code))&supplier_id=eq.${supplier.id}&projects.project_code=eq.${encodeURIComponent(projectCode)}&limit=1`);
      const assignment = rows[0]; const project = assignment ? first(assignment.projects) : undefined;
      if (!assignment || !project) return help("The supplier is not assigned to this project.", 404, { fix: "Assign this supplier to the project in Project details → Supplier delivery." });
      if (!await supplierScopedRefReady(env)) {
        const priorSessions = await serviceRows<{ project_supplier_id: string | null }>(env, `/rest/v1/survey_sessions?select=project_supplier_id&project_id=eq.${encodeURIComponent(project.id)}&respondent_ref=eq.${encodeURIComponent(respondentRef)}&limit=1`);
        if (priorSessions[0] && priorSessions[0].project_supplier_id !== assignment.id) return help("This supplier attempt ID is already used by another source on this project", 409, { fix: "Send a unique respondent value for every launch, or apply migration 039 for assignment-scoped IDs." });
      }
      if (!isTest && (assignment.status !== "ACTIVE" || project.status !== "LIVE")) {
        const target = supplier.terminate_url ?? supplier.security_terminate_url;
        return target ? redirect(standardSupplierRedirect(target, projectCode, respondentRef, "TERMINATE")) : help("Project traffic is not active", 409, { fix: "Set the project to LIVE and the supplier assignment to ACTIVE." });
      }
      routingStage = "eligibility lookup";
      const eligibilityRows = await serviceRows<EligibilityRow>(env, `/rest/v1/project_eligibility_rules?select=variable_key,operator,values,required,active&project_id=eq.${encodeURIComponent(project.id)}&active=eq.true&order=sort_order.asc`);
      const answers = eligibilityAnswers(url.searchParams);
      const market = project.project_markets?.[0]; const sessionContext = { countryCode: /^[A-Za-z]{2}$/.test(answers.country ?? "") ? answers.country!.toUpperCase() : market?.country_code, languageCode: /^[A-Za-z]{2}$/.test(answers.language ?? "") ? answers.language!.toLowerCase() : market?.language_code, responseVariables: answers };
      const eligibility = evaluateEligibility(eligibilityRows.map((rule) => ({ variableKey: rule.variable_key, operator: rule.operator, values: Array.isArray(rule.values) ? rule.values.map(String) : [], required: rule.required, active: rule.active })), answers);
      if (!eligibility.eligible) {
        const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START", isTest ? "test-redirect" : "redirect", isTest, sessionContext);
        if (!start.ok) return help("The respondent session could not be started", 502, { stage: routingStage });
        await recordEvent(request, env, supplier, projectCode, respondentRef, "TERMINATE", `eligibility:${eligibility.failedRule ?? "rule"}`, isTest, { reasonCode: "ELIGIBILITY_SCREEN_OUT" });
        return supplier.terminate_url ? redirect(standardSupplierRedirect(supplier.terminate_url, projectCode, respondentRef, "TERMINATE")) : help(eligibility.reason ?? "The respondent is not eligible for this study", 200);
      }
      let reservationId: string | null = null;
      if (!isTest) {
        const quotaRows = await serviceRows<QuotaCellRow>(env, `/rest/v1/project_quota_cells?select=id,name,target_quota,priority,active,conditions&project_id=eq.${encodeURIComponent(project.id)}&active=eq.true&order=priority.asc,name.asc`);
        const quotaCells: QuotaCell[] = quotaRows.map((cell) => ({ id: cell.id, name: cell.name, targetQuota: cell.target_quota, priority: cell.priority, active: cell.active, conditions: (Array.isArray(cell.conditions) ? cell.conditions : []).map((condition) => { const value = condition as Record<string, unknown>; return { variableKey: String(value.variable_key ?? ""), operator: String(value.operator ?? "EQ") as EligibilityRule["operator"], values: Array.isArray(value.values) ? value.values.map(String) : [], required: value.required !== false, active: true }; }) }));
        const reservations = await serviceRpc<QuotaReservationRow>(env, "reserve_project_quota", { p_organization_id: supplier.organization_id, p_project_code: projectCode, p_supplier_id: supplier.id, p_respondent_ref: respondentRef, p_matching_cell_ids: matchingQuotaCellIds(quotaCells, answers) });
        if (!reservations[0]?.allowed) {
          await recordEvent(request, env, supplier, projectCode, respondentRef, "QUOTA_FULL", `quota:${reservations[0]?.reason ?? "full"}`, false, { reasonCode: "QUOTA_FULL" });
          return supplier.quota_full_url ? redirect(standardSupplierRedirect(supplier.quota_full_url, projectCode, respondentRef, "QUOTA_FULL")) : unavailable("The requested quota is full", 409);
        }
        reservationId = reservations[0].reservation_id;
      }
      routingStage = "respondent start";
      const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START", isTest ? "test-redirect" : "redirect", isTest, sessionContext);
      const startBody = await start.json().catch(() => null) as { data?: { sessionId?: string } } | null;
      if (!start.ok) { if (reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []); return help("The respondent session could not be started", 502, { stage: routingStage }); }
      const surveyTemplate = isTest ? project.test_survey_url || project.survey_url : project.survey_url;
      if (!surveyTemplate) {
        if (!isTest && reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []);
        return isTest
          ? routingPage("The test hit was recorded", "ST has been added to supplier metrics. Add a valid client survey URL to test the onward redirect and RC metric.", 200, "success")
          : help("The client survey URL is not configured", 422, { fix: "Set the live survey URL in Project details → Survey routing setup." });
      }
      if (startBody?.data?.sessionId) {
        routingStage = "fraud check";
        const flags = await serviceRows<{ id: string }>(env, `/rest/v1/fraud_flags?select=id&session_id=eq.${startBody.data.sessionId}&status=eq.OPEN&severity=eq.HIGH&limit=1`);
        if (flags[0]) { await recordEvent(request, env, supplier, projectCode, respondentRef, "QUALITY_TERMINATE", "security", isTest, { reasonCode: "SECURITY_REJECT" }); return supplier.security_terminate_url ? redirect(standardSupplierRedirect(supplier.security_terminate_url, projectCode, respondentRef, "QUALITY_TERMINATE")) : help("The respondent did not pass security checks", 403); }
      }
      const sessionId = startBody?.data?.sessionId;
      if (!sessionId) return help("The respondent session could not be secured", 502, { stage: routingStage });
      routingStage = "outcome route lookup";
      const sessionRows = await serviceRows<{ outcome_token: string }>(env, `/rest/v1/survey_sessions?select=outcome_token&id=eq.${encodeURIComponent(sessionId)}&limit=1`);
      const outcomeToken = sessionRows[0]?.outcome_token;
      if (!outcomeToken) return help("The respondent outcome route could not be created", 502, { stage: routingStage });
      const callback = (outcome: Outcome) => outcomeRouteFromSession(url.origin, outcomeToken, outcome);
      const configuredParameters = Array.isArray(project.survey_parameters) ? project.survey_parameters.filter((value): value is SurveyParameter => { const item = value as Partial<SurveyParameter>; return typeof item?.name === "string" && typeof item?.value === "string"; }) : [];
      const surveyUrl = buildSurveyUrl(surveyTemplate, configuredParameters, { ...answers, project_id: projectCode, respondent_id: sessionId, session_id: sessionId, complete_url: callback("complete"), terminate_url: callback("terminate"), quota_full_url: callback("quota-full"), security_terminate_url: callback("security-terminate") });
      if (!surveyUrl.searchParams.has("rid")) surveyUrl.searchParams.set("rid", sessionId);
      if (!surveyUrl.searchParams.has("complete_url")) surveyUrl.searchParams.set("complete_url", callback("complete"));
      if (!surveyUrl.searchParams.has("terminate_url")) surveyUrl.searchParams.set("terminate_url", callback("terminate"));
      if (!surveyUrl.searchParams.has("quota_full_url")) surveyUrl.searchParams.set("quota_full_url", callback("quota-full"));
      if (!surveyUrl.searchParams.has("security_terminate_url")) surveyUrl.searchParams.set("security_terminate_url", callback("security-terminate"));
      routingStage = "client reached event";
      await recordEvent(request, env, supplier, projectCode, respondentRef, "REACHED_CLIENT", isTest ? "test-redirect" : "redirect", isTest);
      return redirect(surveyUrl.toString());
    }

    if (outcomeRoute) {
      const quotaReservationId = clean(url.searchParams.get("quota_reservation_id") ?? url.searchParams.get("reservation_id"), 80) || undefined;
      const outcomeSessions = await serviceRows<{ respondent_ref: string; status: string; is_test: boolean; projects: { project_code: string } | { project_code: string }[]; project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[] }>(env, `/rest/v1/survey_sessions?select=respondent_ref,status,is_test,projects!inner(project_code),project_suppliers(suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))&outcome_token=eq.${encodeURIComponent(outcomeRoute.token)}&limit=1`);
      const outcomeSession = outcomeSessions[0]; const outcomeProject = outcomeSession ? first(outcomeSession.projects) : undefined; const outcomeAssignment = outcomeSession ? first(outcomeSession.project_suppliers) : undefined; const outcomeSupplier = outcomeAssignment ? first(outcomeAssignment.suppliers) : undefined;
      if (!outcomeSession || !outcomeProject || !outcomeSupplier) return help("Respondent routing session was not found", 404, { fix: "Open this outcome link only from a fresh supplier launch; each session token works once." });
      const terminalStatuses = new Set(["COMPLETE", "TERMINATE", "QUOTA_FULL", "QUALITY_TERMINATE", "ABANDON"]);
      const expectedEvent = outcomes[outcomeRoute.outcome].eventType;
      if (terminalStatuses.has(outcomeSession.status) && outcomeSession.status !== expectedEvent) return help(`This respondent is already recorded as ${outcomeSession.status.toLowerCase().replaceAll("_", " ")}`, 409);
      const reasonCode = expectedEvent === "TERMINATE" ? "CLIENT_TERMINATE" : expectedEvent === "QUOTA_FULL" ? "QUOTA_FULL" : expectedEvent === "QUALITY_TERMINATE" ? "QUALITY_REJECT" : undefined;
      const result = await recordEvent(request, env, outcomeSupplier, outcomeProject.project_code, outcomeSession.respondent_ref, expectedEvent, "client-outcome", outcomeSession.is_test, reasonCode ? { reasonCode } : {});
      if (!result.ok) return help("The respondent outcome could not be recorded", 502, { stage: "respondent outcome" });
      if (quotaReservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: quotaReservationId }).catch(() => []);
      const target = outcomeSupplier[outcomes[outcomeRoute.outcome].field];
      if (typeof target === "string" && target) return redirect(standardSupplierRedirect(target, outcomeProject.project_code, outcomeSession.respondent_ref, expectedEvent));
      return outcomePage(expectedEvent);
    }

    const outcome = clientRoute!.outcome;
    const requestedProjectCode = readProjectCode(url.searchParams); const clientAttemptId = readClientAttemptId(url.searchParams);
    if (!clientAttemptId) return help("Respondent ID is required", 400, { fix: ROUTING_HELP.clientExample });
    const clients = await serviceRows<{ id: string }>(env, `/rest/v1/clients?select=id&redirect_token=eq.${encodeURIComponent(clientRoute!.token)}&limit=1`); if (!clients[0]) return help("Client link was not found", 404);
    const projectFilter = requestedProjectCode ? `projects.project_code=eq.${encodeURIComponent(requestedProjectCode)}` : `projects.client_id=eq.${clients[0].id}`;
    type ClientSession = { respondent_ref: string; is_test: boolean; projects: { project_code: string; client_id: string } | { project_code: string; client_id: string }[]; project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[] };
    const sessionSelect = "respondent_ref,is_test,projects!inner(project_code,client_id),project_suppliers(suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))";
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
    const projectCode = project.project_code;
    const eventType = outcomes[outcome].eventType; const reasonCode = eventType === "TERMINATE" ? "CLIENT_TERMINATE" : eventType === "QUOTA_FULL" ? "QUOTA_FULL" : eventType === "QUALITY_TERMINATE" ? "QUALITY_REJECT" : undefined;
    const result = await recordEvent(request, env, supplier, projectCode, session.respondent_ref, eventType, "client-outcome", session.is_test, reasonCode ? { reasonCode } : {}); if (!result.ok) return help("The respondent outcome could not be recorded", 502, { stage: "respondent outcome" });
    const target = supplier[outcomes[outcome].field];
    if (typeof target === "string" && target) return redirect(standardSupplierRedirect(target, projectCode, session.respondent_ref, outcomes[outcome].eventType));
    return outcomePage(outcomes[outcome].eventType);
  } catch (error) {
    const id = requestId(request);
    safeLog("error", "redirect_failed", { requestId: id, path: pathname, stage: routingStage, error: error instanceof Error ? error.message : "Unknown redirect failure" });
    const upstreamStatus = error instanceof Error ? error.message.match(/upstream status (\d{3})/)?.[1] : undefined;
    return unavailable(`The routing configuration failed during ${routingStage}${upstreamStatus ? ` (upstream ${upstreamStatus})` : ""}. Reference: ${id}`, 502);
  }
}
