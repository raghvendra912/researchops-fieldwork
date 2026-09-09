import { ingestNormalizedEvent, type EventEnv } from "./events";
import { riskMetadata } from "../lib/fraud";
import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit";

type RedirectEnv = EventEnv;
type Outcome = "complete" | "terminate" | "quota-full" | "security-terminate";
type SupplierRow = { id: string; organization_id: string; status: string; redirect_mode: string; complete_url: string | null; terminate_url: string | null; quota_full_url: string | null; security_terminate_url: string | null };
type LiveAssignment = { id: string; supplier_id: string; target_quota: number; status: string; projects: { project_code: string; status: string; survey_url: string | null; clients: { redirect_token: string } | { redirect_token: string }[] } | { project_code: string; status: string; survey_url: string | null; clients: { redirect_token: string } | { redirect_token: string }[] }[] };

const outcomes: Record<Outcome, { eventType: string; field: keyof SupplierRow }> = {
  complete: { eventType: "COMPLETE", field: "complete_url" },
  terminate: { eventType: "TERMINATE", field: "terminate_url" },
  "quota-full": { eventType: "QUOTA_FULL", field: "quota_full_url" },
  "security-terminate": { eventType: "QUALITY_TERMINATE", field: "security_terminate_url" },
};

function serviceHeaders(env: RedirectEnv) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }; }
async function serviceRows<T>(env: RedirectEnv, path: string): Promise<T[]> { const response = await fetch(`${env.SUPABASE_URL}${path}`, { headers: serviceHeaders(env) }); if (!response.ok) throw new Error("Redirect lookup failed"); return response.json() as Promise<T[]>; }
function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] : value; }
function clean(value: string | null, maximum = 160) { return (value ?? "").trim().replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, maximum); }
function expand(template: string, project: string, respondent: string) { return template.replaceAll("{{project_id}}", encodeURIComponent(project)).replaceAll("{{respondent_id}}", encodeURIComponent(respondent)); }
function redirect(url: string) { return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" } }); }
function unavailable(message: string, status = 400) { return new Response(`<!doctype html><html><body><h1>ResearchOps routing</h1><p>${message}</p></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }

async function recordEvent(request: Request, env: RedirectEnv, supplier: SupplierRow, projectCode: string, respondentRef: string, eventType: string, source = "redirect") {
  const metadata = await riskMetadata(request, new URL(request.url).searchParams.get("device"), env.FRAUD_HASH_SECRET);
  return ingestNormalizedEvent({ organizationId: supplier.organization_id, projectCode, supplierId: supplier.id, respondentRef, eventType, providerTransactionId: `${eventType}:${respondentRef}`, metadata: { ...metadata, source } }, env);
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
        return typeof target === "string" && target ? redirect(expand(target, "TEST-PROJECT", "TEST-RESPONDENT")) : unavailable(`${outcome} redirect is not configured`, 422);
      }

      const limited = checkRateLimit(`supplier-live:${supplier.id}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`, 120, 60);
      if (!limited.allowed) return rateLimitResponse(limited);
      const projectCode = clean(url.searchParams.get("project"), 40).toUpperCase();
      const respondentRef = clean(url.searchParams.get("respondent"));
      if (!/^[A-Z]{2,10}-[A-Z0-9-]+$/.test(projectCode) || !respondentRef) return unavailable("Project and respondent are required", 400);
      const rows = await serviceRows<LiveAssignment>(env, `/rest/v1/project_suppliers?select=id,supplier_id,target_quota,status,projects!inner(project_code,status,survey_url,clients(redirect_token))&supplier_id=eq.${supplier.id}&projects.project_code=eq.${encodeURIComponent(projectCode)}&limit=1`);
      const assignment = rows[0]; const project = assignment ? first(assignment.projects) : undefined;
      if (!assignment || !project || assignment.status !== "ACTIVE" || project.status !== "LIVE") {
        const target = supplier.terminate_url ?? supplier.security_terminate_url;
        return target ? redirect(expand(target, projectCode, respondentRef)) : unavailable("Project traffic is not active", 409);
      }
      const metricRows = await serviceRows<{ completes: number }>(env, `/rest/v1/project_supplier_event_metrics?select=completes&project_supplier_id=eq.${assignment.id}&limit=1`);
      if (Number(metricRows[0]?.completes ?? 0) >= assignment.target_quota) {
        await recordEvent(request, env, supplier, projectCode, respondentRef, "QUOTA_FULL");
        return supplier.quota_full_url ? redirect(expand(supplier.quota_full_url, projectCode, respondentRef)) : unavailable("Supplier quota is full", 409);
      }
      if (!project.survey_url) return unavailable("The client survey URL is not configured", 422);
      const start = await recordEvent(request, env, supplier, projectCode, respondentRef, "START");
      const startBody = await start.json().catch(() => null) as { data?: { sessionId?: string } } | null;
      if (!start.ok) return unavailable("The respondent session could not be started", 502);
      if (startBody?.data?.sessionId) {
        const flags = await serviceRows<{ id: string }>(env, `/rest/v1/fraud_flags?select=id&session_id=eq.${startBody.data.sessionId}&status=eq.OPEN&severity=eq.HIGH&limit=1`);
        if (flags[0]) { await recordEvent(request, env, supplier, projectCode, respondentRef, "QUALITY_TERMINATE"); return supplier.security_terminate_url ? redirect(expand(supplier.security_terminate_url, projectCode, respondentRef)) : unavailable("The respondent did not pass security checks", 403); }
      }
      const sessionId = startBody?.data?.sessionId;
      if (!sessionId) return unavailable("The respondent session could not be secured", 502);
      const sessionRows = await serviceRows<{ outcome_token: string }>(env, `/rest/v1/survey_sessions?select=outcome_token&id=eq.${encodeURIComponent(sessionId)}&limit=1`);
      const outcomeToken = sessionRows[0]?.outcome_token;
      if (!outcomeToken) return unavailable("The respondent outcome route could not be created", 502);
      const callback = (outcome: Outcome) => `${url.origin}/r/outcome/${outcomeToken}/${outcome}`;
      const survey = project.survey_url.replaceAll("{{respondent_id}}", encodeURIComponent(respondentRef)).replaceAll("{{project_id}}", encodeURIComponent(projectCode)).replaceAll("{{complete_url}}", encodeURIComponent(callback("complete"))).replaceAll("{{terminate_url}}", encodeURIComponent(callback("terminate"))).replaceAll("{{quota_full_url}}", encodeURIComponent(callback("quota-full"))).replaceAll("{{security_terminate_url}}", encodeURIComponent(callback("security-terminate")));
      const surveyUrl = new URL(survey);
      if (!surveyUrl.searchParams.has("rid")) surveyUrl.searchParams.set("rid", respondentRef);
      if (!surveyUrl.searchParams.has("complete_url")) surveyUrl.searchParams.set("complete_url", callback("complete"));
      if (!surveyUrl.searchParams.has("terminate_url")) surveyUrl.searchParams.set("terminate_url", callback("terminate"));
      if (!surveyUrl.searchParams.has("quota_full_url")) surveyUrl.searchParams.set("quota_full_url", callback("quota-full"));
      if (!surveyUrl.searchParams.has("security_terminate_url")) surveyUrl.searchParams.set("security_terminate_url", callback("security-terminate"));
      await recordEvent(request, env, supplier, projectCode, respondentRef, "REACHED_CLIENT");
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
      return typeof target === "string" && target ? redirect(expand(target, project.project_code, session.respondent_ref)) : unavailable(`${outcome} redirect is not configured`, 422);
    }

    const outcome = clientMatch![2].toLowerCase() as Outcome;
    const projectCode = clean(url.searchParams.get("project_id") ?? url.searchParams.get("project"), 40).toUpperCase(); const respondentRef = clean(url.searchParams.get("respondent_id") ?? url.searchParams.get("respondent"));
    if (!projectCode || !respondentRef) return unavailable("Project and respondent are required", 400);
    const clients = await serviceRows<{ id: string }>(env, `/rest/v1/clients?select=id&redirect_token=eq.${clientMatch![1]}&limit=1`); if (!clients[0]) return unavailable("Client link was not found", 404);
    const sessions = await serviceRows<{ organization_id: string; project_supplier_id: string; projects: { project_code: string; client_id: string } | { project_code: string; client_id: string }[]; project_suppliers: { supplier_id: string; suppliers: SupplierRow | SupplierRow[] } | { supplier_id: string; suppliers: SupplierRow | SupplierRow[] }[] }>(env, `/rest/v1/survey_sessions?select=organization_id,project_supplier_id,projects!inner(project_code,client_id),project_suppliers(supplier_id,suppliers(id,organization_id,status,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url))&respondent_ref=eq.${encodeURIComponent(respondentRef)}&projects.project_code=eq.${encodeURIComponent(projectCode)}&limit=1`);
    const session = sessions[0]; const project = session ? first(session.projects) : undefined; const assignment = session ? first(session.project_suppliers) : undefined; const supplier = assignment ? first(assignment.suppliers) : undefined;
    if (!session || !project || project.client_id !== clients[0].id || !supplier) return unavailable("Respondent routing session was not found", 404);
    const result = await recordEvent(request, env, supplier, projectCode, respondentRef, outcomes[outcome].eventType); if (!result.ok) return unavailable("The respondent outcome could not be recorded", 502);
    const target = supplier[outcomes[outcome].field]; return typeof target === "string" && target ? redirect(expand(target, projectCode, respondentRef)) : unavailable(`${outcome} redirect is not configured`, 422);
  } catch { return unavailable("The redirect could not be completed", 502); }
}
