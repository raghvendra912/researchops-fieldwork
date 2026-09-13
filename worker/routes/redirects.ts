import { ingestNormalizedEvent, type EventEnv } from "./events";
import { riskMetadata } from "../lib/fraud";
import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit";
import { standardSupplierRedirect } from "../domain/supplier-redirect";
import { requestId, safeLog } from "../lib/observability";
import { eligibilityAnswers, evaluateEligibility, type EligibilityRule } from "../domain/eligibility";
import { matchingQuotaCellIds, type QuotaCell } from "../domain/quota";
import { buildSurveyUrl, type SurveyParameter } from "../domain/survey-url";

type RedirectEnv = EventEnv;
type Outcome = "complete" | "terminate" | "quota-full" | "security-terminate";
type SupplierRow = { id: string; organization_id: string; status: string; redirect_mode: string; complete_url: string | null; terminate_url: string | null; quota_full_url: string | null; security_terminate_url: string | null };
type LiveAssignment = { id: string; supplier_id: string; target_quota: number; status: string; projects: { id: string; project_code: string; status: string; survey_url: string | null; test_survey_url: string | null; survey_parameters: unknown; clients: { redirect_token: string } | { redirect_token: string }[] } | { id: string; project_code: string; status: string; survey_url: string | null; test_survey_url: string | null; survey_parameters: unknown; clients: { redirect_token: string } | { redirect_token: string }[] }[] };
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
async function serviceRows<T>(env: RedirectEnv, path: string): Promise<T[]> { const response = await fetch(`${env.SUPABASE_URL}${path}`, { headers: serviceHeaders(env) }); if (!response.ok) throw new Error("Redirect lookup failed"); return response.json() as Promise<T[]>; }
async function serviceRpc<T>(env: RedirectEnv, name: string, body: Record<string, unknown>): Promise<T[]> { const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: serviceHeaders(env), body: JSON.stringify(body) }); if (!response.ok) throw new Error("Routing reservation failed"); return response.json() as Promise<T[]>; }
function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] : value; }
function clean(value: string | null, maximum = 160) { return (value ?? "").trim().replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, maximum); }
function redirect(url: string) { return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } }); }
function routingPage(title: string, message: string, status = 400, tone: "success" | "error" = "error") { return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ResearchOps</title><style>body{margin:0;background:#f4f1eb;color:#17221d;font:16px/1.5 system-ui,-apple-system,sans-serif}.card{max-width:560px;margin:12vh auto;padding:42px;border:1px solid #d8d5cd;border-radius:22px;background:#fff;box-shadow:0 18px 60px #17221d12}.mark{display:inline-block;padding:6px 10px;border-radius:999px;background:${tone === "success" ? "#dff4ed;color:#087761" : "#fae7df;color:#a53f25"};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:18px 0 8px;font-size:30px}p{margin:0;color:#59665f}.hint{margin-top:24px;padding-top:18px;border-top:1px solid #e5e2db;font-size:14px}</style></head><body><main class="card"><span class="mark">${tone === "success" ? "Test recorded" : "Routing unavailable"}</span><h1>${title}</h1><p>${message}</p><p class="hint">You can close this tab and return to the ResearchOps project workspace.</p></main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }); }
function unavailable(message: string, status = 400) { return routingPage("We could not continue this respondent", message, status); }

async function recordEvent(request: Request, env: RedirectEnv, supplier: SupplierRow, projectCode: string, respondentRef: string, eventType: string, source = "redirect", isTest = false) {
  const metadata = await riskMetadata(request, new URL(request.url).searchParams.get("device"), env.FRAUD_HASH_SECRET);
  return ingestNormalizedEvent({ organizationId: supplier.organization_id, projectCode, supplierId: supplier.id, respondentRef, eventType, providerTransactionId: `${eventType}:${respondentRef}`, isTest, metadata: { ...metadata, source, isTest } }, env);
}

async function supplierByToken(env: RedirectEnv, token: string) {
  const rows = await serviceRows<SupplierRow>(env, `/rest/v1/suppliers?select=id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url&redirect_token=eq.${encodeURIComponent(token)}&limit=1`);
  return rows[0];
}

export async function handleRedirectApi(request: Request, pathname: string, env: RedirectEnv): Promise<Response | null> {
  const supplierMatch = pathname.match(/^\/r\/supplier\/([0-9a-f-]{36})\/(test|live)$/i);
  const clientMatch = pathname.match(/^\/r\/client\/([0-9a-f-]{36})\/(complete|terminate|quota-full|security-terminate)$/i);
  const outcomeMatch = pathname.match(/^\/r\/outcome\/([0-9a-f-]{36})\/(complete|terminate|quota-full|security-terminate)$/i);
  if (!supplierMatch && !clientMatch && !outcomeMatch) return null;
  if (request.method !== "GET") return unavailable("Method not allowed", 405);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return unavailable("Routing is not configured", 503);

  try {
    const url = new URL(request.url);
    if (supplierMatch) {
      const supplier = await supplierByToken(env, supplierMatch[1]);
      if (!supplier || supplier.status !== "ACTIVE") return unavailable("Supplier link is inactive", 404);
      if (supplierMatch[2] === "test") {
        const outcome = (url.searchParams.get("outcome") ?? "complete") as Outcome;
        const configuration = outcomes[outcome];
        if (!configuration) return unavailable("Choose complete, terminate, quota-full, or security-terminate", 400);
        const target = supplier[configuration.field];
        return typeof target === "string" && target ? redirect(standardSupplierRedirect(target, "TEST-PROJECT", "TEST-RESPONDENT", configuration.eventType)) : unavailable(`${outcome} redirect is not configured`, 422);
      }

      const isTest = url.searchParams.get("mode") === "test";
      const limited = checkRateLimit(`supplier-live:${supplier.id}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, 120, 60);
      if (!limited.allowed) return rateLimitResponse(limited);
      const projectCode = clean(url.searchParams.get("project"), 40).toUpperCase();
      const respondentRef = clean(url.searchParams.get("respondent"));
      if (!/^[A-Z]{2,10}-[A-Z0-9-]+$/.test(projectCode) || !respondentRef) return unavailable("Project and respondent are required", 400);
      const rows = await serviceRows<LiveAssignment>(env, `/rest/v1/project_suppliers?select=id,supplier_id,target_quota,status,projects!inner(id,project_code,status,survey_url,test_survey_url,survey_parameters,clients(redirect_token))&supplier_id=eq.${supplier.id}&projects.project_code=eq.${encodeURIComponent(projectCode)}&limit=1`);
      const assignment = rows[0]; const project = assignment ? first(assignment.projects) : undefined;
      if (!assignment || !project) return unavailable("The supplier is not assigned to this project.", 404);
      if (!isTest && (assignment.status !== "ACTIVE" || project.status !== "LIVE")) {
        const target = supplier.terminate_url ?? supplier.security_terminate_url;
        return target ? redirect(standardSupplierRedirect(target, projectCode, respondentRef, "TERMINATE")) : unavailable("Project traffic is not active", 409);
      }
      const eligibilityRows = await serviceRows<EligibilityRow>(env, `/rest/v1/project_eligibility_rules?select=variable_key,operator,values,required,active&project_id=eq.${encodeURIComponent(project.id)}&active=eq.true&order=sort_order.asc`);
      const answers = eligibilityAnswers(url.searchParams);
      const eligibility = evaluateEligibility(eligibilityRows.map((rule) => ({ variableKey: rule.variable_key, operator: rule.operator, values: Array.isArray(rule.values) ? rule.values.map(String) : [], required: rule.required, active: rule.active })), answers);
      if (!eligibility.eligible) {
        const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START", isTest ? "test-redirect" : "redirect", isTest);
        if (!start.ok) return unavailable("The respondent session could not be started", 502);
        await recordEvent(request, env, supplier, projectCode, respondentRef, "TERMINATE", `eligibility:${eligibility.failedRule ?? "rule"}`, isTest);
        return supplier.terminate_url ? redirect(standardSupplierRedirect(supplier.terminate_url, projectCode, respondentRef, "TERMINATE")) : unavailable(eligibility.reason ?? "The respondent is not eligible for this study", 200);
      }
      let reservationId: string | null = null;
      if (!isTest) {
        const quotaRows = await serviceRows<QuotaCellRow>(env, `/rest/v1/project_quota_cells?select=id,name,target_quota,priority,active,conditions&project_id=eq.${encodeURIComponent(project.id)}&active=eq.true&order=priority.asc,name.asc`);
        const quotaCells: QuotaCell[] = quotaRows.map((cell) => ({ id: cell.id, name: cell.name, targetQuota: cell.target_quota, priority: cell.priority, active: cell.active, conditions: (Array.isArray(cell.conditions) ? cell.conditions : []).map((condition) => { const value = condition as Record<string, unknown>; return { variableKey: String(value.variable_key ?? ""), operator: String(value.operator ?? "EQ") as EligibilityRule["operator"], values: Array.isArray(value.values) ? value.values.map(String) : [], required: value.required !== false, active: true }; }) }));
        const reservations = await serviceRpc<QuotaReservationRow>(env, "reserve_project_quota", { p_organization_id: supplier.organization_id, p_project_code: projectCode, p_supplier_id: supplier.id, p_respondent_ref: respondentRef, p_matching_cell_ids: matchingQuotaCellIds(quotaCells, answers) });
        if (!reservations[0]?.allowed) {
          await recordEvent(request, env, supplier, projectCode, respondentRef, "QUOTA_FULL", `quota:${reservations[0]?.reason ?? "full"}`);
          return supplier.quota_full_url ? redirect(standardSupplierRedirect(supplier.quota_full_url, projectCode, respondentRef, "QUOTA_FULL")) : unavailable("The requested quota is full", 409);
        }
        reservationId = reservations[0].reservation_id;
      }
      const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START", isTest ? "test-redirect" : "redirect", isTest);
      const startBody = await start.json().catch(() => null) as { data?: { sessionId?: string } } | null;
      if (!start.ok) { if (reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []); return unavailable("The respondent session could not be started", 502); }
      const surveyTemplate = isTest ? project.test_survey_url || project.survey_url : project.survey_url;
      if (!surveyTemplate) {
        if (!isTest && reservationId) await serviceRpc(env, "release_quota_reservation", { p_reservation_id: reservationId }).catch(() => []);
        return isTest
          ? routingPage("The test hit was recorded", "ST has been added to supplier metrics. Add a valid client survey URL to test the onward redirect and RC metric.", 200, "success")
          : unavailable("The client survey URL is not configured", 422);
      }
      if (startBody?.data?.sessionId) {
        const flags = await serviceRows<{ id: string }>(env, `/rest/v1/fraud_flags?select=id&session_id=eq.${startBody.data.sessionId}&status=eq.OPEN&severity=eq.HIGH&limit=1`);
        if (flags[0]) { await recordEvent(request, env, supplier, projectCode, respondentRef, "QUALITY_TERMINATE"); return supplier.security_terminate_url ? redirect(standardSupplierRedirect(supplier.security_terminate_url, projectCode, respondentRef, "QUALITY_TERMINATE")) : unavailable("The respondent did not pass security checks", 403); }
      }
      const sessionId = startBody?.data?.sessionId;
      if (!sessionId) return unavailable("The respondent session could not be secured", 502);
      const sessionRows = await serviceRows<{ outcome_token: string }>(env, `/rest/v1/survey_sessions?select=outcome_token&id=eq.${encodeURIComponent(sessionId)}&limit=1`);
      const outcomeToken = sessionRows[0]?.outcome_token;
      if (!outcomeToken) return unavailable("The respondent outcome route could not be created", 502);
      const callback = (outcome: Outcome) => `${url.origin}/r/outcome/${outcomeToken}/${outcome}`;
      const configuredParameters = Array.isArray(project.survey_parameters) ? project.survey_parameters.filter((value): value is SurveyParameter => { const item = value as Partial<SurveyParameter>; return typeof item?.name === "string" && typeof item?.value === "string"; }) : [];
      const surveyUrl = buildSurveyUrl(surveyTemplate, configuredParameters, { ...answers, project_id: projectCode, respondent_id: respondentRef, session_id: sessionId, complete_url: callback("complete"), terminate_url: callback("terminate"), quota_full_url: callback("quota-full"), security_terminate_url: callback("security-terminate") });
      if (!surveyUrl.searchParams.has("rid")) surveyUrl.searchParams.set("rid", respondentRef);
      if (!surveyUrl.searchParams.has("complete_url")) surveyUrl.searchParams.set("complete_url", callback("complete"));
      if (!surveyUrl.searchParams.has("terminate_url")) surveyUrl.searchParams.set("terminate_url", callback("terminate"));
      if (!surveyUrl.searchParams.has("quota_full_url")) surveyUrl.searchParams.set("quota_full_url", callback("quota-full"));
      if (!surveyUrl.searchParams.has("security_terminate_url")) surveyUrl.searchParams.set("security_terminate_url", callback("security-terminate"));
      await recordEvent(request, env, supplier, projectCode, respondentRef, "REACHED_CLIENT", isTest ? "test-redirect" : "redirect", isTest);
      return redirect(surveyUrl.toString());
    }

    if (outcomeMatch) {
      const outcome = outcomeMatch[2].toLowerCase() as Outcome;
      const sessions = await serviceRows<{ respondent_ref: string; status: string; projects: { project_code: string } | { project_code: string }[]; project_suppliers: { suppliers: SupplierRow | SupplierRow[] } | { suppliers: SupplierRow | SupplierRow[] }[] }>(env, `/rest/v1/survey_sessions?select=respondent_ref,status,projects!inner(project_code),project_suppliers(suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))&outcome_token=eq.${outcomeMatch[1]}&limit=1`);
      const session = sessions[0]; const project = session ? first(session.projects) : undefined; const assignment = session ? first(session.project_suppliers) : undefined; const supplier = assignment ? first(assignment.suppliers) : undefined;
      if (!session || !project || !supplier) return unavailable("Respondent routing session was not found", 404);
      const terminalStatuses = new Set(["COMPLETE", "TERMINATE", "QUOTA_FULL", "QUALITY_TERMINATE", "ABANDON"]);
      const expectedEvent = outcomes[outcome].eventType;
      if (terminalStatuses.has(session.status) && session.status !== expectedEvent) return unavailable(`This respondent is already recorded as ${session.status.toLowerCase().replaceAll("_", " ")}`, 409);
      const result = await recordEvent(request, env, supplier, project.project_code, session.respondent_ref, expectedEvent);
      if (!result.ok) return unavailable("The respondent outcome could not be recorded", 502);
      const target = supplier[outcomes[outcome].field];
      return typeof target === "string" && target ? redirect(standardSupplierRedirect(target, project.project_code, session.respondent_ref, expectedEvent)) : unavailable(`${outcome} redirect is not configured`, 422);
    }

    const outcome = clientMatch![2].toLowerCase() as Outcome;
    const requestedProjectCode = clean(url.searchParams.get("project_id") ?? url.searchParams.get("project") ?? url.searchParams.get("survey_id"), 40).toUpperCase(); const respondentRef = clean(url.searchParams.get("respondent_id") ?? url.searchParams.get("transaction_id") ?? url.searchParams.get("respondent") ?? url.searchParams.get("rid") ?? url.searchParams.get("uid"));
    if (!respondentRef) return unavailable("Respondent ID is required", 400);
    const clients = await serviceRows<{ id: string }>(env, `/rest/v1/clients?select=id&redirect_token=eq.${clientMatch![1]}&limit=1`); if (!clients[0]) return unavailable("Client link was not found", 404);
    const projectFilter = requestedProjectCode ? `projects.project_code=eq.${encodeURIComponent(requestedProjectCode)}` : `projects.client_id=eq.${clients[0].id}`;
    const sessions = await serviceRows<{ organization_id: string; project_supplier_id: string; projects: { project_code: string; client_id: string } | { project_code: string; client_id: string }[]; project_suppliers: { supplier_id: string; suppliers: SupplierRow | SupplierRow[] } | { supplier_id: string; suppliers: SupplierRow | SupplierRow[] }[] }>(env, `/rest/v1/survey_sessions?select=organization_id,project_supplier_id,started_at,projects!inner(project_code,client_id),project_suppliers(supplier_id,suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))&respondent_ref=eq.${encodeURIComponent(respondentRef)}&${projectFilter}&order=started_at.desc&limit=1`);
    const session = sessions[0]; const project = session ? first(session.projects) : undefined; const assignment = session ? first(session.project_suppliers) : undefined; const supplier = assignment ? first(assignment.suppliers) : undefined;
    if (!session || !project || project.client_id !== clients[0].id || !supplier) return unavailable("Respondent routing session was not found", 404);
    const projectCode = project.project_code;
    const result = await recordEvent(request, env, supplier, projectCode, respondentRef, outcomes[outcome].eventType); if (!result.ok) return unavailable("The respondent outcome could not be recorded", 502);
    const target = supplier[outcomes[outcome].field]; return typeof target === "string" && target ? redirect(standardSupplierRedirect(target, projectCode, respondentRef, outcomes[outcome].eventType)) : unavailable(`${outcome} redirect is not configured`, 422);
  } catch (error) {
    safeLog("error", "redirect_failed", { requestId: requestId(request), path: pathname, error: error instanceof Error ? error.message : "Unknown redirect failure" });
    return unavailable("The routing configuration could not be completed. The operations team can use the request log to identify the failed step.", 502);
  }
}
