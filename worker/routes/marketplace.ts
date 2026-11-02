import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization.ts";
import { isSupabaseConfigured, SupabaseRequestError, supabaseJson, supabaseRequest, type SupabaseEnv } from "../lib/supabase.ts";
import { checkSharedRateLimit, rateLimitResponse } from "../lib/rate-limit.ts";
import { requestId, safeLog } from "../lib/observability.ts";
import { estimateEarningsPerClick, isValidSecretEnvName } from "../domain/marketplace.ts";
import { adapterFor, marketplaceProviders, type MarketplaceConfig } from "../providers/marketplace.ts";
import { validSignature } from "./events.ts";

export type MarketplaceEnv = SupabaseEnv & { SUPABASE_SERVICE_ROLE_KEY?: string; CRON_SECRET?: string } & Record<string, string | undefined>;

type MarketplaceRow = {
  id: string; organization_id: string; client_id: string | null; name: string; provider: string; status: string; currency: string;
  reversal_window_days: number | null; config: MarketplaceConfig | null; last_synced_at: string | null;
};
type SurveyRow = {
  id: string; marketplace_id: string; external_id: string; title: string; country_code: string | null; language_code: string | null;
  cpi: number | string; currency: string; loi_minutes: number | null; incidence_pct: number | string | null; conversion_pct: number | string | null;
  quota_remaining: number | null; status: string; entry_url: string | null; qualifications: unknown[]; last_synced_at: string;
  marketplaces?: { name: string; provider: string } | { name: string; provider: string }[] | null;
  projects?: { project_code: string } | { project_code: string }[] | null;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maximumBodyBytes = 2_000_000;
const demoSource = { source: "mock" } as const;

const demoMarketplace = { id: "demo-marketplace", clientId: null, name: "Demo Marketplace", provider: "GENERIC", status: "ACTIVE", currency: "USD", reversalWindowDays: 14, lastSyncedAt: null, secretEnv: null, secretConfigured: false, entrySigning: null };
const demoSurveys = [
  { id: "demo-survey-1", marketplaceId: "demo-marketplace", marketplaceName: "Demo Marketplace", externalId: "DM-1001", title: "Digital wallet adoption", countryCode: "IN", languageCode: "en", cpi: 2.4, currency: "USD", loiMinutes: 10, incidencePct: 38, conversionPct: 52, quotaRemaining: 240, status: "OPEN", qualificationCount: 3, importedProjectCode: null, lastSyncedAt: null },
  { id: "demo-survey-2", marketplaceId: "demo-marketplace", marketplaceName: "Demo Marketplace", externalId: "DM-1002", title: "Streaming habits", countryCode: "US", languageCode: "en", cpi: 1.6, currency: "USD", loiMinutes: 7, incidencePct: 61, conversionPct: null, quotaRemaining: 1200, status: "OPEN", qualificationCount: 1, importedProjectCode: null, lastSyncedAt: null },
].map((survey) => ({ ...survey, estimatedEarningsPerClick: estimateEarningsPerClick({ cpi: survey.cpi, conversionPct: survey.conversionPct, incidencePct: survey.incidencePct }) }));

function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] : value ?? undefined; }
function numberOrNull(value: number | string | null | undefined) { return value === null || value === undefined ? null : Number(value); }
function json(data: unknown, meta: Record<string, unknown> = { source: "supabase" }, status = 200) { return Response.json({ data, meta }, { status }); }
function bad(error: string, status = 400, extra: Record<string, unknown> = {}) { return Response.json({ error, ...extra }, { status }); }

/** RPC `raise exception` messages are ours and safe to show; everything else is generic. */
function failure(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.code === "P0001" && error.detail) return bad(error.detail, 400);
    if (error.code === "23514" || error.code === "23505") return bad("The request conflicts with existing marketplace data or violates a rule", 409);
    if (error.status === 401 || error.status === 403 || error.code === "42501") return bad("Your workspace role does not allow this action", 403);
  }
  return bad("The marketplace service is unavailable", 502);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length") ?? 0) > maximumBodyBytes) return null;
  const body = await request.json().catch(() => null) as unknown;
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

function rpc<T>(env: SupabaseEnv, authorization: string, name: string, body: Record<string, unknown>) {
  return supabaseJson<T>(env, `/rest/v1/rpc/${name}`, authorization, { method: "POST", body: JSON.stringify(body) });
}

async function serviceRequest<T>(env: MarketplaceEnv, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) throw new Error(`Marketplace service request failed with upstream status ${response.status}`);
  return response.json() as Promise<T>;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function marketplaceView(row: MarketplaceRow, env: MarketplaceEnv) {
  const config = row.config ?? {};
  const secretEnv = isValidSecretEnvName(config.secretEnv) ? config.secretEnv : null;
  return {
    id: row.id, clientId: row.client_id, name: row.name, provider: row.provider, status: row.status, currency: row.currency,
    reversalWindowDays: row.reversal_window_days, lastSyncedAt: row.last_synced_at, secretEnv,
    secretConfigured: Boolean(secretEnv && env[secretEnv]), entrySigning: config.entrySigning ?? null,
  };
}

function surveyView(row: SurveyRow) {
  const cpi = Number(row.cpi); const incidencePct = numberOrNull(row.incidence_pct); const conversionPct = numberOrNull(row.conversion_pct);
  return {
    id: row.id, marketplaceId: row.marketplace_id, marketplaceName: first(row.marketplaces)?.name ?? "", externalId: row.external_id, title: row.title,
    countryCode: row.country_code, languageCode: row.language_code, cpi, currency: row.currency, loiMinutes: row.loi_minutes, incidencePct, conversionPct,
    quotaRemaining: row.quota_remaining, status: row.status, qualificationCount: Array.isArray(row.qualifications) ? row.qualifications.length : 0,
    importedProjectCode: first(row.projects)?.project_code ?? null, lastSyncedAt: row.last_synced_at,
    estimatedEarningsPerClick: estimateEarningsPerClick({ cpi, conversionPct, incidencePct }),
  };
}

function sanitizeConfig(body: Record<string, unknown>, existing: MarketplaceConfig = {}): { config?: MarketplaceConfig; error?: string } {
  const config: MarketplaceConfig = { ...existing };
  if ("secretEnv" in body) {
    if (body.secretEnv === null || body.secretEnv === "") delete config.secretEnv;
    else if (isValidSecretEnvName(body.secretEnv)) config.secretEnv = body.secretEnv;
    else return { error: "The secret name must look like MARKETPLACE_<NAME>_SECRET" };
  }
  if ("entrySigning" in body) {
    const value = body.entrySigning as Record<string, unknown> | null;
    if (value === null) delete config.entrySigning;
    else if (typeof value === "object") {
      const algorithm = value.algorithm === "SHA-1" ? "SHA-1" : "SHA-256";
      const param = typeof value.param === "string" && /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(value.param) ? value.param : "hash";
      config.entrySigning = { enabled: value.enabled === true, algorithm, param };
    } else return { error: "Entry signing settings are invalid" };
  }
  if (config.entrySigning?.enabled && !config.secretEnv) return { error: "Set a secret name before enabling entry-link signing" };
  return { config };
}

const demoWrite = () => bad("Marketplace changes need a configured database. Demo mode is read-only.", 503);

export async function handleMarketplaceApi(request: Request, pathname: string, env: MarketplaceEnv): Promise<Response | null> {
  if (pathname === "/api/cron/marketplace") return handleCron(request, env);
  const callback = pathname.match(/^\/api\/marketplace-callbacks\/([0-9a-f-]{36})$/i);
  if (callback) return handleCallback(request, callback[1].toLowerCase(), env);

  const isMarketplaces = pathname === "/api/marketplaces" || pathname.startsWith("/api/marketplaces/");
  const isSurveys = pathname === "/api/marketplace-surveys" || pathname.startsWith("/api/marketplace-surveys/");
  const isFinance = pathname.startsWith("/api/finance/");
  if (!isMarketplaces && !isSurveys && !isFinance) return null;

  const url = new URL(request.url);
  if (!isSupabaseConfigured(env)) {
    if (request.method !== "GET") return demoWrite();
    if (pathname === "/api/marketplaces") return json([demoMarketplace], demoSource);
    if (pathname === "/api/marketplace-surveys") return json(demoSurveys, demoSource);
    return json([], demoSource);
  }

  const administerOnly = isMarketplaces && request.method !== "GET" && !/\/(sync)$/.test(pathname);
  const access = await authorizeWorkspace(request, env, administerOnly ? workspacePermissions.administer : workspacePermissions.operate);
  if (!access.ok) return authorizationError(access);
  const authorization = access.authorization;

  try {
    if (pathname === "/api/marketplaces") {
      if (request.method === "GET") {
        const rows = await supabaseJson<MarketplaceRow[]>(env, "/rest/v1/marketplaces?select=id,organization_id,client_id,name,provider,status,currency,reversal_window_days,config,last_synced_at&order=name.asc", authorization);
        return json(rows.map((row) => marketplaceView(row, env)), { source: "supabase", canAdminister: workspacePermissions.administer.includes(access.membership.role as "OWNER" | "ADMIN") });
      }
      if (request.method === "POST") {
        const body = await readJson(request); if (!body) return bad("A valid JSON body is required");
        const name = String(body.name ?? "").trim(); const provider = String(body.provider ?? "GENERIC").toUpperCase(); const currency = String(body.currency ?? "USD").toUpperCase();
        const windowDays = body.reversalWindowDays === null || body.reversalWindowDays === undefined || body.reversalWindowDays === "" ? null : Number(body.reversalWindowDays);
        if (name.length < 2 || name.length > 80) return bad("Marketplace name must be 2-80 characters");
        if (!(marketplaceProviders as readonly string[]).includes(provider)) return bad("Choose a supported marketplace provider");
        if (!/^[A-Z]{3}$/.test(currency)) return bad("Currency must be a 3-letter code");
        if (windowDays !== null && !(Number.isInteger(windowDays) && windowDays >= 0 && windowDays <= 365)) return bad("The reversal window must be 0-365 days");
        const sanitized = sanitizeConfig(body); if (!sanitized.config) return bad(sanitized.error ?? "Invalid settings");
        const rows = await rpc<Array<{ new_marketplace_id: string; new_client_id: string }>>(env, authorization, "create_marketplace", { p_name: name, p_provider: provider, p_currency: currency, p_reversal_window_days: windowDays, p_config: sanitized.config });
        return json({ id: rows[0].new_marketplace_id, clientId: rows[0].new_client_id }, { source: "supabase" }, 201);
      }
      return bad("Method not allowed", 405);
    }

    const one = pathname.match(/^\/api\/marketplaces\/([0-9a-f-]{36})$/i);
    if (one && request.method === "PATCH") {
      if (!uuidPattern.test(one[1])) return bad("Invalid marketplace id");
      const body = await readJson(request); if (!body) return bad("A valid JSON body is required");
      const existing = (await supabaseJson<MarketplaceRow[]>(env, `/rest/v1/marketplaces?id=eq.${one[1]}&select=id,config`, authorization))[0];
      if (!existing) return bad("Marketplace not found", 404);
      const patch: Record<string, unknown> = {};
      if ("status" in body) { if (body.status !== "ACTIVE" && body.status !== "PAUSED") return bad("Status must be ACTIVE or PAUSED"); patch.status = body.status; }
      if ("reversalWindowDays" in body) {
        const days = body.reversalWindowDays === null || body.reversalWindowDays === "" ? null : Number(body.reversalWindowDays);
        if (days !== null && !(Number.isInteger(days) && days >= 0 && days <= 365)) return bad("The reversal window must be 0-365 days");
        patch.reversal_window_days = days;
      }
      if ("secretEnv" in body || "entrySigning" in body) {
        const sanitized = sanitizeConfig(body, existing.config ?? {}); if (!sanitized.config) return bad(sanitized.error ?? "Invalid settings");
        patch.config = sanitized.config;
      }
      if (Object.keys(patch).length === 0) return bad("Nothing to update");
      const rows = await supabaseJson<MarketplaceRow[]>(env, `/rest/v1/marketplaces?id=eq.${one[1]}&select=id,organization_id,client_id,name,provider,status,currency,reversal_window_days,config,last_synced_at`, authorization, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      return rows[0] ? json(marketplaceView(rows[0], env)) : bad("Workspace owner or admin access is required", 403);
    }

    const sync = pathname.match(/^\/api\/marketplaces\/([0-9a-f-]{36})\/sync$/i);
    if (sync && request.method === "POST") {
      const body = await readJson(request); if (!body) return bad("A valid JSON body (up to 2 MB) is required");
      const format = body.format === "csv" ? "csv" : "json";
      const marketplace = (await supabaseJson<MarketplaceRow[]>(env, `/rest/v1/marketplaces?id=eq.${sync[1]}&select=id,provider,status`, authorization))[0];
      if (!marketplace) return bad("Marketplace not found", 404);
      const parsed = adapterFor(marketplace.provider).parseInventory({ format, data: body.data });
      const fullSnapshot = body.fullSnapshot === true;
      // A full snapshot closes every survey missing from it, so a partly invalid
      // feed must never be applied or healthy surveys would be wrongly closed.
      if (parsed.errors.length && (fullSnapshot || parsed.surveys.length === 0)) return bad(fullSnapshot ? "Fix the listed rows before running a full snapshot sync" : "No valid surveys were found", 400, { errors: parsed.errors.slice(0, 50) });
      const rows = await rpc<Array<{ inserted_count: number; updated_count: number; closed_count: number; paused_projects: number }>>(env, authorization, "upsert_marketplace_surveys", { p_marketplace_id: sync[1], p_surveys: parsed.surveys, p_full_snapshot: fullSnapshot });
      return json({ inserted: rows[0].inserted_count, updated: rows[0].updated_count, closed: rows[0].closed_count, pausedProjects: rows[0].paused_projects, skipped: parsed.errors.length, errors: parsed.errors.slice(0, 50) });
    }

    const map = pathname.match(/^\/api\/marketplaces\/([0-9a-f-]{36})\/qualification-map$/i);
    if (map) {
      if (request.method === "GET") {
        const rows = await supabaseJson<Array<{ external_code: string; variable_key: string; operator_default: string; value_map: Record<string, string> }>>(env, `/rest/v1/marketplace_qualification_map?marketplace_id=eq.${map[1]}&select=external_code,variable_key,operator_default,value_map&order=external_code.asc`, authorization);
        return json(rows.map((row) => ({ externalCode: row.external_code, variableKey: row.variable_key, operatorDefault: row.operator_default, valueMap: row.value_map })));
      }
      if (request.method === "PUT") {
        const body = await readJson(request); const list = body?.mappings;
        if (!Array.isArray(list) || list.length > 100) return bad("Provide up to 100 qualification mappings");
        const marketplace = (await supabaseJson<MarketplaceRow[]>(env, `/rest/v1/marketplaces?id=eq.${map[1]}&select=id,organization_id`, authorization))[0];
        if (!marketplace) return bad("Marketplace not found", 404);
        const operators = new Set(["EQ", "NE", "IN", "NOT_IN", "GTE", "LTE", "BETWEEN"]);
        const rows: Record<string, unknown>[] = [];
        for (const item of list) {
          const entry = item as Record<string, unknown>;
          const externalCode = String(entry.externalCode ?? "").trim(); const variableKey = String(entry.variableKey ?? "").trim().toLowerCase(); const operatorDefault = String(entry.operatorDefault ?? "IN").toUpperCase();
          const valueMap = typeof entry.valueMap === "object" && entry.valueMap !== null && !Array.isArray(entry.valueMap) ? entry.valueMap as Record<string, unknown> : {};
          if (!externalCode || externalCode.length > 80 || !/^[a-z][a-z0-9_]{0,49}$/.test(variableKey) || !operators.has(operatorDefault) || Object.values(valueMap).some((value) => typeof value !== "string")) return bad(`Invalid mapping for "${externalCode || "(blank)"}"`);
          rows.push({ organization_id: marketplace.organization_id, marketplace_id: map[1], external_code: externalCode, variable_key: variableKey, operator_default: operatorDefault, value_map: valueMap });
        }
        if (rows.length) await supabaseRequest(env, "/rest/v1/marketplace_qualification_map?on_conflict=marketplace_id,external_code", authorization, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
        return json({ saved: rows.length });
      }
      if (request.method === "DELETE") {
        const code = url.searchParams.get("code")?.trim();
        if (!code || code.length > 80) return bad("A qualification code is required");
        await supabaseRequest(env, `/rest/v1/marketplace_qualification_map?marketplace_id=eq.${map[1]}&external_code=eq.${encodeURIComponent(code)}`, authorization, { method: "DELETE" });
        return json({ deleted: code });
      }
      return bad("Method not allowed", 405);
    }

    if (pathname === "/api/marketplace-surveys" && request.method === "GET") {
      const params = new URLSearchParams({ select: "id,marketplace_id,external_id,title,country_code,language_code,cpi,currency,loi_minutes,incidence_pct,conversion_pct,quota_remaining,status,entry_url,qualifications,last_synced_at,marketplaces(name,provider),projects(project_code)", order: "cpi.desc,last_synced_at.desc", limit: "500" });
      const marketplaceId = url.searchParams.get("marketplace"); const status = url.searchParams.get("status")?.toUpperCase(); const country = url.searchParams.get("country")?.toUpperCase();
      const query = (url.searchParams.get("q") ?? "").replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 80); const minimum = Number(url.searchParams.get("minCpi"));
      if (marketplaceId) { if (!uuidPattern.test(marketplaceId)) return bad("Invalid marketplace id"); params.set("marketplace_id", `eq.${marketplaceId}`); }
      if (status) { if (!["OPEN", "PAUSED", "CLOSED"].includes(status)) return bad("Invalid status"); params.set("status", `eq.${status}`); }
      if (country) { if (!/^[A-Z]{2}$/.test(country)) return bad("Invalid country"); params.set("country_code", `eq.${country}`); }
      if (query) params.set("title", `ilike.*${query}*`);
      if (Number.isFinite(minimum) && minimum > 0) params.set("cpi", `gte.${minimum}`);
      const rows = await supabaseJson<SurveyRow[]>(env, `/rest/v1/marketplace_surveys?${params}`, authorization);
      const views = rows.map(surveyView);
      if (url.searchParams.get("sort") === "epc") views.sort((a, b) => (b.estimatedEarningsPerClick.value ?? -1) - (a.estimatedEarningsPerClick.value ?? -1));
      return json(views, { source: "supabase", truncated: rows.length === 500 });
    }

    const importMatch = pathname.match(/^\/api\/marketplace-surveys\/([0-9a-f-]{36})\/import$/i);
    if (importMatch && request.method === "POST") {
      const body = await readJson(request); if (!body) return bad("A valid JSON body is required");
      const suppliers = Array.isArray(body.suppliers) ? body.suppliers : [];
      const assignments = suppliers.map((item) => { const entry = item as Record<string, unknown>; return { supplier_id: String(entry.supplierId ?? ""), supplier_cpi: Number(entry.supplierCpi) }; });
      if (assignments.length > 100 || assignments.some((entry) => !uuidPattern.test(entry.supplier_id) || !Number.isFinite(entry.supplier_cpi) || entry.supplier_cpi < 0)) return bad("Each supplier needs an id and a non-negative CPI");
      const quota = body.quota === undefined || body.quota === null || body.quota === "" ? null : Number(body.quota);
      if (quota !== null && !(Number.isInteger(quota) && quota >= 1 && quota <= 1_000_000)) return bad("Quota must be a whole number of at least 1");
      const projectName = typeof body.projectName === "string" ? body.projectName.trim().slice(0, 200) : null;
      const rows = await rpc<Array<{ new_project_id: string; new_project_code: string; new_status: string; mapped_rules: number; unmapped_codes: string[] }>>(env, authorization, "import_marketplace_survey", { p_survey_id: importMatch[1], p_project_name: projectName, p_quota: quota, p_supplier_assignments: assignments });
      return json({ projectId: rows[0].new_project_id, projectCode: rows[0].new_project_code, status: rows[0].new_status, mappedRules: rows[0].mapped_rules, unmappedCodes: rows[0].unmapped_codes }, { source: "supabase" }, 201);
    }

    if (pathname === "/api/finance/summary" && request.method === "GET") {
      const from = url.searchParams.get("from"); const to = url.searchParams.get("to"); const project = url.searchParams.get("project")?.toUpperCase() ?? null;
      const dateOk = (value: string | null) => value === null || !Number.isNaN(Date.parse(value));
      if (!dateOk(from) || !dateOk(to)) return bad("Dates must be valid ISO dates");
      if (project && !/^[A-Z]{2,10}-[A-Z0-9-]+$/.test(project)) return bad("Invalid project code");
      const rows = await rpc<Array<Record<string, unknown>>>(env, authorization, "finance_summary", { p_from: from, p_to: to, p_project_code: project });
      return json(rows.map((row) => ({
        projectId: row.project_id, projectCode: row.project_code, projectName: row.project_name, marketplaceName: row.marketplace_name, currency: row.currency,
        completes: Number(row.completes), reversals: Number(row.reversals), revenue: Number(row.revenue), supplierCost: Number(row.supplier_cost), margin: Number(row.margin),
        pendingRevenue: Number(row.pending_revenue), confirmedRevenue: Number(row.confirmed_revenue),
      })));
    }

    if (pathname === "/api/finance/suppliers" && request.method === "GET") {
      const marketplaceId = url.searchParams.get("marketplace");
      if (marketplaceId && !uuidPattern.test(marketplaceId)) return bad("Invalid marketplace id");
      const rows = await rpc<Array<Record<string, unknown>>>(env, authorization, "marketplace_supplier_kpis", { p_marketplace_id: marketplaceId });
      return json(rows.map((row) => ({
        marketplaceId: row.marketplace_id, marketplaceName: row.marketplace_name, supplierId: row.supplier_id, supplierName: row.supplier_name, currency: row.currency,
        starts: Number(row.starts), completes: Number(row.completes), reversals: Number(row.reversals), conversionPct: numberOrNull(row.conversion_pct as string | null),
        reversalRatePct: numberOrNull(row.reversal_rate_pct as string | null), revenue: Number(row.revenue), supplierCost: Number(row.supplier_cost), margin: Number(row.margin),
        earningsPerClick: numberOrNull(row.earnings_per_click as string | null),
      })));
    }

    if (pathname === "/api/finance/reversals" && request.method === "POST") {
      const body = await readJson(request); const items = body?.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 100) return bad("Provide 1-100 sessions to reverse");
      const results: Array<{ sessionId: string; reversedEntries: number; error?: string }> = [];
      for (const item of items) {
        const entry = item as Record<string, unknown>; const sessionId = String(entry.sessionId ?? "");
        if (!uuidPattern.test(sessionId)) { results.push({ sessionId, reversedEntries: 0, error: "Invalid session id" }); continue; }
        try {
          const rows = await rpc<Array<{ reversed_entries: number }>>(env, authorization, "reverse_session_ledger", { p_session_id: sessionId, p_reason: String(entry.reason ?? "").slice(0, 500) });
          results.push({ sessionId, reversedEntries: rows[0]?.reversed_entries ?? 0 });
        } catch (error) { results.push({ sessionId, reversedEntries: 0, error: error instanceof SupabaseRequestError && error.code === "P0001" ? error.detail : "Could not reverse this session" }); }
      }
      return json(results);
    }

    if (pathname === "/api/finance/confirmations" && request.method === "POST") {
      const body = await readJson(request); const ids = body?.sessionIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500 || ids.some((id) => !uuidPattern.test(String(id)))) return bad("Provide 1-500 valid session ids");
      const rows = await rpc<Array<{ confirmed_count: number }>>(env, authorization, "confirm_ledger_entries", { p_session_ids: ids });
      return json({ confirmedEntries: rows[0]?.confirmed_count ?? 0 });
    }
  } catch (error) {
    safeLog("error", "marketplace_request_failed", { path: pathname, status: error instanceof SupabaseRequestError ? error.status : undefined, code: error instanceof SupabaseRequestError ? error.code : undefined });
    return failure(error);
  }
  return null;
}

/**
 * Server-to-server confirmations and reversals from a marketplace. The
 * marketplace's own record decides what we are paid, so this is the trusted
 * path for confirming or reversing ledger entries (not browser redirects).
 */
async function handleCallback(request: Request, marketplaceId: string, env: MarketplaceEnv): Promise<Response> {
  if (request.method !== "POST") return bad("Method not allowed", 405);
  const id = requestId(request);
  const limited = await checkSharedRateLimit(env, `marketplace-callback:${marketplaceId}`, 60, 60, { ip: request.headers.get("cf-connecting-ip") ?? "unknown" });
  if (!limited.allowed) return rateLimitResponse(limited);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return bad("Marketplace callbacks are not configured", 503);
  try {
    const marketplace = (await serviceRequest<MarketplaceRow[]>(env, `/rest/v1/marketplaces?id=eq.${marketplaceId}&select=id,provider,status,config`))[0];
    if (!marketplace) return bad("Marketplace not found", 404);
    const secretEnv = marketplace.config?.secretEnv;
    const secret = isValidSecretEnvName(secretEnv) ? env[secretEnv] : undefined;
    if (!secret) return bad("This marketplace has no callback secret configured", 503);
    const rawBody = await request.text();
    if (rawBody.length > maximumBodyBytes) return bad("Payload too large", 413);
    if (!await validSignature(rawBody, request, secret)) { safeLog("warn", "marketplace_callback_rejected", { requestId: id, marketplaceId, reason: "signature" }); return bad("Invalid or expired callback signature", 401); }
    let payload: unknown;
    try { payload = JSON.parse(rawBody); } catch { return bad("Invalid JSON payload"); }
    const { actions, errors } = adapterFor(marketplace.provider).parseConfirmations(payload);

    // Only act on sessions this marketplace actually earned money on.
    const ids = [...new Set(actions.map((action) => action.sessionId))];
    const known = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 100) {
      const slice = ids.slice(offset, offset + 100);
      const rows = await serviceRequest<Array<{ session_id: string }>>(env, `/rest/v1/finance_ledger_entries?select=session_id&marketplace_id=eq.${marketplaceId}&entry_type=eq.COMPLETE&session_id=in.(${slice.join(",")})`);
      rows.forEach((row) => known.add(row.session_id.toLowerCase()));
    }
    const rpcCall = <T>(name: string, body: Record<string, unknown>) => serviceRequest<T>(env, `/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
    const confirmIds = actions.filter((action) => action.action === "CONFIRM" && known.has(action.sessionId)).map((action) => action.sessionId);
    let confirmed = 0; let reversed = 0;
    for (let offset = 0; offset < confirmIds.length; offset += 500) {
      const rows = await rpcCall<Array<{ confirmed_count: number }>>("confirm_ledger_entries", { p_session_ids: confirmIds.slice(offset, offset + 500) });
      confirmed += rows[0]?.confirmed_count ?? 0;
    }
    for (const action of actions.filter((entry) => entry.action === "REVERSE" && known.has(entry.sessionId))) {
      const rows = await rpcCall<Array<{ reversed_entries: number }>>("reverse_session_ledger", { p_session_id: action.sessionId, p_reason: action.reason ?? "Marketplace reversal" });
      if ((rows[0]?.reversed_entries ?? 0) > 0) reversed += 1;
    }
    const unknown = actions.length - actions.filter((action) => known.has(action.sessionId)).length;
    safeLog("info", "marketplace_callback_processed", { requestId: id, marketplaceId, confirmed, reversed, unknown });
    return Response.json({ data: { confirmedEntries: confirmed, reversedSessions: reversed, unknownSessions: unknown, errors: errors.slice(0, 50) } }, { headers: { "x-request-id": id } });
  } catch (error) {
    safeLog("error", "marketplace_callback_failed", { requestId: id, marketplaceId, error: error instanceof Error ? error.message : "unknown" });
    return bad("The marketplace callback could not be processed", 502);
  }
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; anything else is refused. */
async function handleCron(request: Request, env: MarketplaceEnv): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") return bad("Method not allowed", 405);
  if (!env.CRON_SECRET) return bad("Scheduled maintenance is not configured", 503);
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!constantTimeEqual(supplied, env.CRON_SECRET)) return bad("Unauthorized", 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return bad("Scheduled maintenance needs the database", 503);
  const id = requestId(request);
  try {
    const rows = await serviceRequest<Array<{ confirmed_entries: number; paused_projects: number }>>(env, "/rest/v1/rpc/maintain_marketplace_supply", { method: "POST", body: JSON.stringify({}) });
    safeLog("info", "marketplace_maintenance_completed", { requestId: id, confirmedEntries: rows[0]?.confirmed_entries, pausedProjects: rows[0]?.paused_projects });
    return Response.json({ data: { confirmedEntries: rows[0]?.confirmed_entries ?? 0, pausedProjects: rows[0]?.paused_projects ?? 0 } });
  } catch (error) {
    safeLog("error", "marketplace_maintenance_failed", { requestId: id, error: error instanceof Error ? error.message : "unknown" });
    return bad("Marketplace maintenance failed", 502);
  }
}
