import { projects as mockProjects } from "../../src/features/projects/mockProjects";
import type { Project, ProjectStatus } from "../../src/features/projects/project.types";
import { isSupabaseConfigured, SupabaseRequestError, supabaseJson, supabaseRequest, type SupabaseEnv } from "../lib/supabase";
import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { canTransition } from "../domain/project-lifecycle";
import { validCountryCodes, validLanguageCodes } from "../../src/lib/market-options";
import { reconcileAbandoned } from "./analytics";
import { getProjectCapabilities } from "../lib/project-authorization";

export type ProjectApiEnv = SupabaseEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };

type DatabaseProject = {
  id: string;
  project_code: string;
  project_name: string;
  client_po: string | null;
  project_type: string | null;
  project_manager_id: string | null;
  project_manager_name: string | null;
  project_managers?: { display_name: string } | { display_name: string }[] | null;
  status: ProjectStatus;
  client_cpi: number | string | null;
  quota: number | null;
  category: string | null;
  start_date: string | null;
  end_date: string | null;
  survey_url: string | null;
  test_survey_url: string | null;
  survey_parameters: unknown;
  security_terminate_url: string | null;
  created_at: string;
  clients: { name: string } | { name: string }[] | null;
  project_markets: { country_code: string }[] | null;
};

type ProjectSortKey = "createdAt" | "code" | "name" | "status" | "cpi";
type SortDirection = "asc" | "desc";
type ProjectMarket = { id?: string; countryCode: string; languageCode: string; targetQuota: number; expectedLoiMinutes: number; expectedIr: number };
type SupplierAssignment = { id?: string; supplierId: string; supplierName?: string; supplierProjectId: string; supplierCpi: number; targetQuota: number; status: "PENDING" | "ACTIVE" | "PAUSED" | "CLOSED" };
type ProjectMetrics = { project_code: string; starts: number; reached: number; completes: number; terminates: number; over_quota: number; quality_term: number; abandons: number; in_progress: number; completes_l24: number; incidence_rate: number | string | null; conversion_rate: number | string | null; abandon_rate: number | string | null; average_duration_seconds: number | null; last_event_at: string | null; last_complete_at: string | null; test_starts?: number; test_completes?: number; test_terminates?: number; test_over_quota?: number; test_quality_term?: number };

type ProjectListQuery = {
  q: string;
  projectId: string;
  client: string;
  manager: string;
  statuses: ProjectStatus[];
  type: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  sortBy: ProjectSortKey;
  sortDirection: SortDirection;
  scope: "all" | "mine";
};

const statuses: ProjectStatus[] = ["PENDING", "LIVE", "PAUSED", "ID_SUBMITTED", "INVOICED", "CLOSED"];
const projectTypes = ["B2C", "B2B", "Healthcare", "Recontact", "Tracker", "Qualitative", "Quantitative", "Mixed method", "IHUT", "CLT"];
const sortKeys: ProjectSortKey[] = ["createdAt", "code", "name", "status", "cpi"];
const countryNames: Record<string, string> = { AU: "Australia", CA: "Canada", DE: "Germany", GB: "United Kingdom", IN: "India", SG: "Singapore", US: "United States" };

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function simpleText(value: string | null, maximum = 100) {
  return (value ?? "").trim().slice(0, maximum);
}

function postgrestText(value: string) {
  return value.replace(/[,%()*]/g, " ").replace(/\s+/g, " ").trim();
}

function dateValue(value: string | null) {
  const candidate = value ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const [year, month, day] = candidate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? candidate : "";
}

function readListQuery(request: Request): ProjectListQuery {
  const params = new URL(request.url).searchParams;
  const requestedStatuses = simpleText(params.get("status"), 120).toUpperCase().split(",").filter((status): status is ProjectStatus => statuses.includes(status as ProjectStatus));
  const requestedSort = simpleText(params.get("sortBy"), 20) as ProjectSortKey;
  return {
    q: simpleText(params.get("q")),
    projectId: simpleText(params.get("projectId"), 40).toUpperCase(),
    client: simpleText(params.get("client")),
    manager: simpleText(params.get("manager")),
    statuses: Array.from(new Set(requestedStatuses)),
    type: simpleText(params.get("type")),
    from: dateValue(params.get("from")),
    to: dateValue(params.get("to")),
    page: boundedInteger(params.get("page"), 1, 1, 100000),
    pageSize: boundedInteger(params.get("pageSize"), 10, 1, 100),
    sortBy: sortKeys.includes(requestedSort) ? requestedSort : "createdAt",
    sortDirection: params.get("sortDirection") === "asc" ? "asc" : "desc",
    scope: params.get("scope") === "mine" ? "mine" : "all",
  };
}

function relationName(relation: DatabaseProject["clients"]) {
  if (Array.isArray(relation)) return relation[0]?.name ?? "Unassigned client";
  return relation?.name ?? "Unassigned client";
}

function managerName(relation: DatabaseProject["project_managers"]) {
  if (Array.isArray(relation)) return relation[0]?.display_name ?? "Unassigned";
  return relation?.display_name ?? "Unassigned";
}

function toProject(row: DatabaseProject, metrics?: ProjectMetrics): Project {
  const countryCode = row.project_markets?.[0]?.country_code ?? "";
  return {
    id: row.project_code,
    name: row.project_name,
    client: relationName(row.clients),
    clientPo: row.client_po ?? "",
    market: (countryNames[countryCode] ?? countryCode) || "Not set",
    type: row.project_type ?? "Not set",
    manager: row.project_manager_name || managerName(row.project_managers),
    status: row.status,
    starts: metrics?.starts ?? 0,
    reached: metrics?.reached ?? 0,
    l24: metrics?.completes_l24 ?? 0,
    completes: metrics?.completes ?? 0,
    terminates: metrics?.terminates ?? 0,
    overQuota: metrics?.over_quota ?? 0,
    qualityTerm: metrics?.quality_term ?? 0,
    abandons: metrics?.abandons ?? 0,
    inProgress: metrics?.in_progress ?? 0,
    abandonRate: Number(metrics?.abandon_rate ?? 0),
    incidenceRate: Number(metrics?.incidence_rate ?? 0),
    conversionRate: Number(metrics?.conversion_rate ?? 0),
    testStarts: metrics?.test_starts ?? 0,
    testCompletes: metrics?.test_completes ?? 0,
    testTerminates: metrics?.test_terminates ?? 0,
    testOverQuota: metrics?.test_over_quota ?? 0,
    testQualityTerm: metrics?.test_quality_term ?? 0,
    cpi: Number(row.client_cpi ?? 0),
    quota: row.quota ?? undefined,
    category: row.category ?? undefined,
    createdAt: row.created_at,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    surveyUrl: row.survey_url ?? undefined,
    testSurveyUrl: row.test_survey_url ?? undefined,
    surveyParameters: Array.isArray(row.survey_parameters) ? row.survey_parameters as Array<{ name: string; value: string }> : [],
    securityTerminateUrl: row.security_terminate_url ?? undefined,
    averageDurationSeconds: metrics?.average_duration_seconds ?? 0,
    lastComplete: metrics?.last_complete_at ? new Date(metrics.last_complete_at).toISOString() : "Not started",
    lastEventAt: metrics?.last_event_at ? new Date(metrics.last_event_at).toISOString() : undefined,
  };
}

function statusSummary(projects: Array<Pick<Project, "status" | "completes">>) {
  const result: Record<ProjectStatus, number> = { PENDING: 0, LIVE: 0, PAUSED: 0, ID_SUBMITTED: 0, INVOICED: 0, CLOSED: 0 };
  for (const project of projects) result[project.status] += 1;
  return { statuses: result, totalCompletes: projects.reduce((total, project) => total + project.completes, 0) };
}

function facetsFor(projects: Project[]) {
  return {
    clients: Array.from(new Set(projects.map((project) => project.client))).sort(),
    managers: Array.from(new Set(projects.map((project) => project.manager))).sort().map((manager) => ({ value: manager, label: manager })),
    types: Array.from(new Set([...projectTypes, ...projects.map((project) => project.type)])).sort(),
    statuses,
  };
}

function mockList(query: ProjectListQuery) {
  const term = query.q.toLowerCase();
  const filtered = mockProjects.filter((project) => {
    const matchesTerm = !term || [project.name, project.client, project.clientPo, project.market].some((value) => value.toLowerCase().includes(term));
    const matchesProjectId = !query.projectId || project.id.toUpperCase().includes(query.projectId);
    return matchesTerm
      && matchesProjectId
      && (!query.client || project.client === query.client)
      && (!query.manager || project.manager === query.manager)
      && (!query.statuses.length || query.statuses.includes(project.status))
      && (!query.type || project.type === query.type);
  });
  const sortValue = (project: Project) => {
    if (query.sortBy === "code") return project.id;
    if (query.sortBy === "name") return project.name;
    if (query.sortBy === "status") return project.status;
    if (query.sortBy === "cpi") return project.cpi;
    return project.id;
  };
  filtered.sort((left, right) => {
    const a = sortValue(left);
    const b = sortValue(right);
    const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    return query.sortDirection === "asc" ? comparison : -comparison;
  });
  const start = (query.page - 1) * query.pageSize;
  const total = filtered.length;
  return {
    data: filtered.slice(start, start + query.pageSize),
    meta: {
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      source: "mock" as const,
      canOperate: true,
      facets: facetsFor(mockProjects),
      summary: statusSummary(filtered),
    },
  };
}

function parseCreatePayload(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload.projectName !== "string" || !payload.projectName.trim()) return null;
  const quota = Number(payload.quota);
  const clientCpi = Number(payload.clientCpi);
  const loi = payload.loi === null || payload.loi === undefined || payload.loi === "" ? null : Number(payload.loi);
  const incidence = payload.incidence === null || payload.incidence === undefined || payload.incidence === "" ? null : Number(payload.incidence);
  const countryCode = String(payload.countryCode ?? "IN").trim().toUpperCase();
  const languageCode = String(payload.languageCode ?? "en").trim().toLowerCase();
  if (!Number.isInteger(quota) || quota < 1 || !Number.isFinite(clientCpi) || clientCpi < 0
    || (loi !== null && (!Number.isInteger(loi) || loi < 1))
    || (incidence !== null && (!Number.isFinite(incidence) || incidence < 0 || incidence > 100))
    || !validCountryCodes.has(countryCode) || !validLanguageCodes.has(languageCode)) return null;
  const urls = [payload.surveyUrl, payload.testSurveyUrl].map((value) => String(value ?? "").trim());
  if (urls.some((value) => value && (!/^https?:\/\//i.test(value) || value.length > 2048))) return null;
  const surveyParameters = parseSurveyParameters(payload.surveyParameters); if (!surveyParameters) return null;
  const supplierAssignments = Array.isArray(payload.supplierAssignments) ? payload.supplierAssignments.map((value) => { const item = value as Record<string, unknown>; return { name: String(item.name ?? "").trim(), supplier_cpi: Number(item.supplierCpi ?? 0) }; }) : [];
  if (supplierAssignments.length > 100 || supplierAssignments.some((item) => !item.name || !Number.isFinite(item.supplier_cpi) || item.supplier_cpi < 0) || new Set(supplierAssignments.map((item) => item.name.toLowerCase())).size !== supplierAssignments.length) return null;
  return {
    p_project_name: payload.projectName.trim(),
    p_client_name: String(payload.client ?? "").trim(),
    p_client_po: String(payload.clientPo ?? "").trim() || null,
    p_project_type: String(payload.type ?? "Consumer").trim(),
    p_category: String(payload.category ?? "").trim() || null,
    p_client_cpi: clientCpi,
    p_quota: quota,
    p_country_code: countryCode,
    p_language_code: languageCode,
    p_expected_loi_minutes: loi,
    p_expected_ir: incidence,
    p_supplier_assignments: supplierAssignments,
    p_survey_url: urls[0] || null, p_test_survey_url: urls[1] || null, p_survey_parameters: surveyParameters,
  };
}

function parseSurveyParameters(value: unknown) {
  if (value === undefined) return [{ name: "PID", value: "{{project_id}}" }, { name: "RID", value: "{{respondent_id}}" }];
  if (!Array.isArray(value) || value.length > 30) return null;
  const parameters = value.map((entry) => { const item = entry as Record<string, unknown>; return { name: String(item.name ?? "").trim(), value: String(item.value ?? "").trim() }; });
  const valid = parameters.every((item) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(item.name) && item.value.length > 0 && item.value.length <= 500);
  return valid && new Set(parameters.map((item) => item.name.toLowerCase())).size === parameters.length ? parameters : null;
}

function parseUpdatePayload(payload: Record<string, unknown> | null) {
  if (!payload || typeof payload.projectName !== "string" || !payload.projectName.trim()) return null;
  const quota = Number(payload.quota);
  const clientCpi = Number(payload.clientCpi);
  const endDate = dateValue(String(payload.endDate ?? "")) || null;
  if (!Number.isFinite(quota) || quota < 1 || !Number.isFinite(clientCpi) || clientCpi < 0) return null;
  return {
    p_project_name: payload.projectName.trim(), p_client_po: String(payload.clientPo ?? "").trim(),
    p_project_type: String(payload.type ?? "").trim(), p_category: String(payload.category ?? "").trim(),
    p_client_cpi: clientCpi, p_quota: quota, p_end_date: endDate,
  };
}

function requestedTransition(payload: Record<string, unknown> | null) {
  const status = String(payload?.status ?? "").toUpperCase() as ProjectStatus;
  return statuses.includes(status) ? status : null;
}

function parseMarkets(payload: Record<string, unknown> | null): ProjectMarket[] | null {
  if (!payload || !Array.isArray(payload.markets) || payload.markets.length < 1 || payload.markets.length > 50) return null;
  const markets = payload.markets.map((value) => {
    const market = value as Record<string, unknown>;
    return { countryCode: String(market.countryCode ?? "").trim().toUpperCase(), languageCode: String(market.languageCode ?? "").trim().toLowerCase(), targetQuota: Number(market.targetQuota), expectedLoiMinutes: Number(market.expectedLoiMinutes), expectedIr: Number(market.expectedIr) };
  });
  const valid = markets.every((market) => validCountryCodes.has(market.countryCode) && validLanguageCodes.has(market.languageCode) && Number.isInteger(market.targetQuota) && market.targetQuota > 0 && Number.isInteger(market.expectedLoiMinutes) && market.expectedLoiMinutes > 0 && Number.isFinite(market.expectedIr) && market.expectedIr >= 0 && market.expectedIr <= 100);
  const keys = new Set(markets.map((market) => `${market.countryCode}:${market.languageCode}`));
  return valid && keys.size === markets.length ? markets : null;
}

function marketRow(row: { id?: string; country_code: string; language_code: string; target_quota: number; expected_loi_minutes: number; expected_ir: number | string }) {
  return { id: row.id, countryCode: row.country_code, languageCode: row.language_code, targetQuota: row.target_quota, expectedLoiMinutes: row.expected_loi_minutes, expectedIr: Number(row.expected_ir) };
}

function parseAssignments(payload: Record<string, unknown> | null): SupplierAssignment[] | null {
  if (!payload || !Array.isArray(payload.assignments) || payload.assignments.length > 100) return null;
  const assignments = payload.assignments.map((value) => {
    const item = value as Record<string, unknown>;
    return { supplierId: String(item.supplierId ?? ""), supplierProjectId: String(item.supplierProjectId ?? "").trim(), supplierCpi: Number(item.supplierCpi), targetQuota: Number(item.targetQuota), status: String(item.status ?? "PENDING").toUpperCase() as SupplierAssignment["status"] };
  });
  const validStatuses = ["PENDING", "ACTIVE", "PAUSED", "CLOSED"];
  const valid = assignments.every((item) => item.supplierId.length > 0 && Number.isFinite(item.supplierCpi) && item.supplierCpi >= 0 && Number.isInteger(item.targetQuota) && item.targetQuota > 0 && validStatuses.includes(item.status));
  return valid && new Set(assignments.map((item) => item.supplierId)).size === assignments.length ? assignments : null;
}

function assignmentRow(row: { id?: string; supplier_id: string; supplier_project_id: string | null; supplier_cpi: number | string; target_quota: number; status: SupplierAssignment["status"]; suppliers?: { name: string; redirect_token?: string; redirect_mode?: string } | { name: string; redirect_token?: string; redirect_mode?: string }[] | null; supplier_name?: string; test_starts?: number; test_completes?: number; test_terminates?: number; test_over_quota?: number; test_quality_term?: number; starts?: number; reached?: number; completes?: number; terminates?: number; over_quota?: number; quality_term?: number; incidence_rate?: number | string | null; conversion_rate?: number | string | null; cost?: number | string }, origin?: string, projectCode?: string) {
  const relation = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers;
  const linkBase = origin && relation?.redirect_token ? `${origin}/r/supplier/${relation.redirect_token}` : "";
  const liveLink = linkBase && projectCode ? `${linkBase}/live?project=${encodeURIComponent(projectCode)}&respondent={{respondent_id}}` : "";
  return { id: row.id, supplierId: row.supplier_id, supplierName: row.supplier_name ?? relation?.name ?? "Supplier", supplierProjectId: row.supplier_project_id ?? "", supplierCpi: Number(row.supplier_cpi), targetQuota: row.target_quota, status: row.status, redirectMode: relation?.redirect_mode ?? "STATIC", testLink: liveLink ? `${liveLink}&mode=test` : "", liveLink, testStarts: row.test_starts ?? 0, testCompletes: row.test_completes ?? 0, testTerminates: row.test_terminates ?? 0, testOverQuota: row.test_over_quota ?? 0, testQualityTerm: row.test_quality_term ?? 0, starts: row.starts ?? 0, reached: row.reached ?? 0, completes: row.completes ?? 0, terminates: row.terminates ?? 0, overQuota: row.over_quota ?? 0, qualityTerm: row.quality_term ?? 0, incidenceRate: Number(row.incidence_rate ?? 0), conversionRate: Number(row.conversion_rate ?? 0), cost: Number(row.cost ?? 0) };
}

const databaseSortColumns: Record<ProjectSortKey, string> = { createdAt: "created_at", code: "project_code", name: "project_name", status: "status", cpi: "client_cpi" };

async function supabaseList(env: ProjectApiEnv, authorization: string, query: ProjectListQuery, canOperate: boolean, userId: string) {
  const clientFilter = postgrestText(query.client);
  const select = `id,project_code,project_name,client_po,project_type,category,project_manager_id,project_manager_name,status,client_cpi,quota,start_date,end_date,survey_url,test_survey_url,survey_parameters,security_terminate_url,created_at,${clientFilter ? "clients!inner(name)" : "clients(name)"},project_managers:user_profiles(display_name),project_markets(country_code)`;
  const params = new URLSearchParams({ select, order: `${databaseSortColumns[query.sortBy]}.${query.sortDirection}` });
  const search = postgrestText(query.q);
  if (search) params.set("or", `(project_name.ilike.*${search}*,client_po.ilike.*${search}*)`);
  const projectIdSearch = postgrestText(query.projectId);
  if (projectIdSearch) params.set("project_code", `ilike.*${projectIdSearch}*`);
  if (clientFilter) params.set("clients.name", `eq.${clientFilter}`);
  if (query.statuses.length === 1) params.set("status", `eq.${query.statuses[0]}`);
  else if (query.statuses.length > 1) params.set("status", `in.(${query.statuses.join(",")})`);
  if (query.type) params.set("project_type", `eq.${postgrestText(query.type)}`);
  if (query.from) params.set("created_at", `gte.${query.from}T00:00:00Z`);
  if (query.to) params.set("created_at", `lte.${query.to}T23:59:59.999Z`);
  if (query.manager === "UNASSIGNED") params.set("project_manager_id", "is.null");
  else if (query.manager.startsWith("NAME:")) params.set("project_manager_name", `eq.${postgrestText(query.manager.slice(5))}`);
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.manager)) params.set("project_manager_id", `eq.${query.manager}`);
  if (query.scope === "mine" && userId) params.set("project_manager_id", `eq.${userId}`);

  const rangeStart = (query.page - 1) * query.pageSize;
  const response = await supabaseRequest(env, `/rest/v1/projects?${params}`, authorization, {
    headers: { Prefer: "count=exact", Range: `${rangeStart}-${rangeStart + query.pageSize - 1}` },
  });
  const rows = await response.json() as DatabaseProject[];
  const countHeader = response.headers.get("content-range") ?? "";
  const total = Number.parseInt(countHeader.split("/")[1] ?? "", 10);

  const codes = rows.map((row) => row.project_code);
  const metricRows = codes.length ? await supabaseJson<ProjectMetrics[]>(env, `/rest/v1/project_event_metrics?select=*&project_code=in.(${codes.join(",")})`, authorization) : [];
  const metrics = new Map(metricRows.map((row) => [row.project_code, row]));
  const facetScope = query.scope === "mine" && userId ? `&project_manager_id=eq.${encodeURIComponent(userId)}` : "";
  const facetRows = await supabaseJson<Array<Pick<DatabaseProject, "project_type" | "project_manager_id" | "project_manager_name" | "project_managers" | "status" | "clients">>>(
    env,
    `/rest/v1/projects?select=project_type,project_manager_id,project_manager_name,status,clients(name),project_managers:user_profiles(display_name)&order=created_at.desc&limit=1000${facetScope}`,
    authorization,
  );
  const facetProjects = facetRows.map((row) => ({
    client: relationName(row.clients), manager: { value: row.project_manager_id ?? (row.project_manager_name ? `NAME:${row.project_manager_name}` : "UNASSIGNED"), label: row.project_manager_name || managerName(row.project_managers) }, type: row.project_type ?? "Not set", status: row.status, completes: 0,
  }));
  const allClients = await supabaseJson<Array<{ name: string }>>(env, "/rest/v1/clients?select=name&order=name.asc&limit=1000", authorization);
  const resolvedTotal = Number.isFinite(total) ? total : rows.length;
  return {
    data: rows.map((row) => toProject(row, metrics.get(row.project_code))),
    meta: {
      total: resolvedTotal,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(resolvedTotal / query.pageSize)),
      source: "supabase" as const,
      canOperate,
      facets: {
        clients: Array.from(new Set(allClients.map((item) => item.name))).sort(),
        managers: Array.from(new Map(facetProjects.map((project) => [project.manager.value, project.manager])).values()).sort((a, b) => a.label.localeCompare(b.label)),
        types: Array.from(new Set([...projectTypes, ...facetProjects.map((project) => project.type)])).sort(),
        statuses,
      },
      summary: statusSummary(facetProjects),
    },
  };
}

export async function handleProjectsApi(request: Request, pathname: string, env: ProjectApiEnv): Promise<Response | null> {
  if (!isSupabaseConfigured(env)) {
    if (pathname === "/api/projects/specifications" && request.method === "GET") { const codes = new URL(request.url).searchParams.get("codes")?.split(",").map((code) => code.toUpperCase()) ?? []; return Response.json({ data: mockProjects.filter((project) => !codes.length || codes.includes(project.id)).map((project) => ({ projectCode: project.id, liveSurveyUrl: project.surveyUrl ?? "", testSurveyUrl: project.testSurveyUrl ?? "", surveyParameters: project.surveyParameters ?? [{ name: "PID", value: "{{project_id}}" }, { name: "RID", value: "{{respondent_id}}" }], markets: [{ countryCode: "IN", languageCode: "en", targetQuota: project.quota ?? 500, expectedLoiMinutes: 12, expectedIr: 40 }], suppliers: [{ supplierName: "CPX Research", supplierProjectId: "CPX-1048", supplierCpi: 7.5, targetQuota: 250, status: "ACTIVE" }], eligibilityRules: [], quotaCells: [] })) }); }
    if (pathname === "/api/projects" && request.method === "GET") return Response.json(mockList(readListQuery(request)));
    if (pathname === "/api/projects" && request.method === "POST") {
      const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
      if (!parseCreatePayload(payload)) return Response.json({ error: "Valid project name, quota and CPI are required" }, { status: 400 });
      return Response.json({ data: { id: "ROP-1049", status: "PENDING", createdAt: new Date().toISOString() }, meta: { source: "mock" } }, { status: 201 });
    }
    const mockDetail = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)$/i);
    if (mockDetail && request.method === "GET") {
      const project = mockProjects.find((item) => item.id.toLowerCase() === mockDetail[1].toLowerCase());
      return project ? Response.json({ data: project, meta: { source: "mock", canOperate: true } }) : Response.json({ error: "Project not found" }, { status: 404 });
    }
    if (mockDetail && request.method === "PATCH") {
      const project = mockProjects.find((item) => item.id.toLowerCase() === mockDetail[1].toLowerCase());
      if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
      const update = parseUpdatePayload(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!update) return Response.json({ error: "Valid project name, quota, CPI and dates are required" }, { status: 400 });
      return Response.json({ data: { ...project, name: update.p_project_name, clientPo: update.p_client_po, type: update.p_project_type, category: update.p_category, cpi: update.p_client_cpi, quota: update.p_quota, endDate: update.p_end_date ?? undefined }, meta: { source: "mock" } });
    }
    const mockTransition = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/transitions$/i);
    if (mockTransition && request.method === "POST") {
      const project = mockProjects.find((item) => item.id.toLowerCase() === mockTransition[1].toLowerCase());
      if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
      const status = requestedTransition(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!status || !canTransition(project.status, status)) return Response.json({ error: `Cannot move a ${project.status} project to ${status ?? "that status"}` }, { status: 409 });
      return Response.json({ data: { id: project.id, previousStatus: project.status, status }, meta: { source: "mock" } });
    }
    const mockMarkets = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/markets$/i);
    if (mockMarkets && request.method === "GET") return Response.json({ data: [{ id: "market-demo", countryCode: "IN", languageCode: "en", targetQuota: 500, expectedLoiMinutes: 12, expectedIr: 40 }], meta: { source: "mock" } });
    if (mockMarkets && request.method === "PUT") {
      const markets = parseMarkets(await request.json().catch(() => null) as Record<string, unknown> | null);
      return markets ? Response.json({ data: markets, meta: { source: "mock" } }) : Response.json({ error: "Valid, unique market rows are required" }, { status: 400 });
    }
    const mockAssignments = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/suppliers$/i);
    if (mockAssignments && request.method === "GET") { const base = `${new URL(request.url).origin}/r/supplier/00000000-0000-4000-8000-000000000001/live?project=${mockAssignments[1].toUpperCase()}&respondent={{respondent_id}}`; return Response.json({ data: [{ id: "assignment-cpx", supplierId: "supplier-cpx", supplierName: "CPX Research", supplierProjectId: "CPX-1048", supplierCpi: 7.5, targetQuota: 250, status: "ACTIVE", testLink: `${base}&mode=test`, liveLink: base, testStarts: 0, starts: 0, reached: 0, completes: 0, terminates: 0, overQuota: 0, qualityTerm: 0, incidenceRate: 0, cost: 0 }], meta: { source: "mock" } }); }
    if (mockAssignments && request.method === "PUT") {
      const assignments = parseAssignments(await request.json().catch(() => null) as Record<string, unknown> | null);
      return assignments ? Response.json({ data: assignments, meta: { source: "mock" } }) : Response.json({ error: "Valid, unique supplier assignments are required" }, { status: 400 });
    }
    return null;
  }

  try {
    if (pathname === "/api/projects/specifications" && request.method === "GET") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.read); if (!access.ok) return authorizationError(access);
      const codes = (new URL(request.url).searchParams.get("codes") ?? "").split(",").map((code) => code.trim().toUpperCase()).filter((code) => /^[A-Z]{2,10}-[A-Z0-9-]+$/.test(code)).slice(0, 100);
      if (!codes.length) return Response.json({ data: [] });
      type SpecRow = { project_code: string; survey_url: string | null; test_survey_url: string | null; survey_parameters: unknown; project_markets: Array<{ country_code: string; language_code: string; target_quota: number; expected_loi_minutes: number; expected_ir: number | string }>; project_suppliers: Array<{ supplier_project_id: string | null; supplier_cpi: number | string; target_quota: number; status: string; suppliers: { name: string } | { name: string }[] }>; project_eligibility_rules: Array<{ variable_key: string; operator: string; values: string[]; required: boolean; active: boolean }>; project_quota_cells: Array<{ name: string; target_quota: number; priority: number; active: boolean; conditions: unknown }> };
      const rows = await supabaseJson<SpecRow[]>(env, `/rest/v1/projects?select=project_code,survey_url,test_survey_url,survey_parameters,project_markets(country_code,language_code,target_quota,expected_loi_minutes,expected_ir),project_suppliers(supplier_project_id,supplier_cpi,target_quota,status,suppliers(name)),project_eligibility_rules(variable_key,operator,values,required,active),project_quota_cells(name,target_quota,priority,active,conditions)&project_code=in.(${codes.join(",")})`, access.authorization);
      const data = rows.map((row) => ({ projectCode: row.project_code, liveSurveyUrl: row.survey_url ?? "", testSurveyUrl: row.test_survey_url ?? "", surveyParameters: Array.isArray(row.survey_parameters) ? row.survey_parameters : [], markets: row.project_markets.map((market) => ({ countryCode: market.country_code, languageCode: market.language_code, targetQuota: market.target_quota, expectedLoiMinutes: market.expected_loi_minutes, expectedIr: Number(market.expected_ir) })), suppliers: row.project_suppliers.map((assignment) => ({ supplierName: (Array.isArray(assignment.suppliers) ? assignment.suppliers[0] : assignment.suppliers)?.name ?? "Supplier", supplierProjectId: assignment.supplier_project_id ?? "", supplierCpi: Number(assignment.supplier_cpi), targetQuota: assignment.target_quota, status: assignment.status })), eligibilityRules: row.project_eligibility_rules.map((rule) => ({ variableKey: rule.variable_key, operator: rule.operator, values: rule.values, required: rule.required, active: rule.active })), quotaCells: row.project_quota_cells.map((cell) => ({ name: cell.name, targetQuota: cell.target_quota, priority: cell.priority, active: cell.active, conditions: cell.conditions })) }));
      return Response.json({ data, meta: { source: "supabase" } });
    }
    if (pathname === "/api/projects" && request.method === "GET") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.read);
      if (!access.ok) return authorizationError(access);
      await reconcileAbandoned(env);
      const result = await supabaseList(env, access.authorization, readListQuery(request), workspacePermissions.operate.includes(access.membership.role as "OWNER" | "ADMIN" | "PM"), access.membership.user_id ?? "");
      return Response.json(result, { headers: { "cache-control": "private, no-store" } });
    }
    if (pathname === "/api/projects" && request.method === "POST") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.operate);
      if (!access.ok) return authorizationError(access);
      const payload = parseCreatePayload(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!payload || !payload.p_client_name) return Response.json({ error: "Valid project name, client, quota and CPI are required" }, { status: 400 });
      const rows = await supabaseJson<Array<{ project_id: string; project_code: string; status: ProjectStatus }>>(env, "/rest/v1/rpc/create_project_with_market_v4", access.authorization, { method: "POST", body: JSON.stringify(payload) });
      const created = rows[0];
      if (!created) throw new Error("Supabase did not return the created project");
      return Response.json({ data: { id: created.project_code, databaseId: created.project_id, status: created.status }, meta: { source: "supabase" } }, { status: 201 });
    }
    const detailMatch = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)$/i);
    if (detailMatch && request.method === "GET") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.read);
      if (!access.ok) return authorizationError(access);
      await reconcileAbandoned(env);
      const code = encodeURIComponent(detailMatch[1]);
      const rows = await supabaseJson<DatabaseProject[]>(env, `/rest/v1/projects?select=id,project_code,project_name,client_po,project_type,category,project_manager_id,project_manager_name,status,client_cpi,quota,start_date,end_date,survey_url,test_survey_url,survey_parameters,security_terminate_url,created_at,clients(name),project_managers:user_profiles(display_name),project_markets(country_code)&project_code=eq.${code}&limit=1`, access.authorization);
      if (!rows[0]) return Response.json({ error: "Project not found" }, { status: 404 });
      const metricRows = await supabaseJson<ProjectMetrics[]>(env, `/rest/v1/project_event_metrics?select=*&project_code=eq.${code}&limit=1`, access.authorization);
      const capability = await getProjectCapabilities(env, access.authorization, detailMatch[1]);
      return Response.json({ data: toProject(rows[0], metricRows[0]), meta: { source: "supabase", canOperate: capability?.can_operate === true, canReview: capability?.can_review === true, canManageAccess: capability?.can_manage_access === true } });
    }
    const marketsMatch = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/markets$/i);
    if (marketsMatch && request.method === "GET") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.read);
      if (!access.ok) return authorizationError(access);
      const rows = await supabaseJson<Array<{ id: string; country_code: string; language_code: string; target_quota: number; expected_loi_minutes: number; expected_ir: number | string }>>(env, `/rest/v1/project_markets?select=id,country_code,language_code,target_quota,expected_loi_minutes,expected_ir,projects!inner(project_code)&projects.project_code=eq.${encodeURIComponent(marketsMatch[1].toUpperCase())}&order=country_code.asc,language_code.asc`, access.authorization);
      return Response.json({ data: rows.map(marketRow), meta: { source: "supabase" } });
    }
    if (marketsMatch && request.method === "PUT") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.operate);
      if (!access.ok) return authorizationError(access);
      const capability = await getProjectCapabilities(env, access.authorization, marketsMatch[1]);
      if (!capability?.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
      const markets = parseMarkets(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!markets) return Response.json({ error: "Valid, unique market rows are required" }, { status: 400 });
      const rows = await supabaseJson<Array<{ id: string; country_code: string; language_code: string; target_quota: number; expected_loi_minutes: number; expected_ir: number | string }>>(env, "/rest/v1/rpc/replace_project_markets", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: marketsMatch[1].toUpperCase(), p_markets: markets.map((market) => ({ country_code: market.countryCode, language_code: market.languageCode, target_quota: market.targetQuota, expected_loi_minutes: market.expectedLoiMinutes, expected_ir: market.expectedIr })) }) });
      return Response.json({ data: rows.map(marketRow), meta: { source: "supabase" } });
    }
    const assignmentsMatch = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/suppliers$/i);
    if (assignmentsMatch && request.method === "GET") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.read);
      if (!access.ok) return authorizationError(access);
      const projectCode = assignmentsMatch[1].toUpperCase();
      const rows = await supabaseJson<Array<{ id: string; supplier_id: string; supplier_project_id: string | null; supplier_cpi: number | string; target_quota: number; status: SupplierAssignment["status"]; suppliers: { name: string; redirect_token?: string; redirect_mode?: string } | { name: string; redirect_token?: string; redirect_mode?: string }[]; projects: { project_code: string } }>>(env, `/rest/v1/project_suppliers?select=id,supplier_id,supplier_project_id,supplier_cpi,target_quota,status,suppliers(name,redirect_token,redirect_mode),projects!inner(project_code)&projects.project_code=eq.${encodeURIComponent(projectCode)}&order=created_at.asc`, access.authorization);
      let metricRows: Array<{ supplier_id: string; test_starts?: number; starts: number; reached: number; completes: number; terminates: number; over_quota: number; quality_term: number; incidence_rate: number | string | null; cost: number | string }>;
      try {
        metricRows = await supabaseJson(env, `/rest/v1/project_supplier_event_metrics?select=supplier_id,test_starts,test_completes,test_terminates,test_over_quota,test_quality_term,starts,reached,completes,terminates,over_quota,quality_term,incidence_rate,conversion_rate,cost&project_code=eq.${encodeURIComponent(projectCode)}`, access.authorization);
      } catch {
        // Keep supplier delivery readable during a staged Worker-before-schema rollout.
        // Test traffic remains unavailable until migration 023 is applied.
        metricRows = await supabaseJson(env, `/rest/v1/project_supplier_event_metrics?select=supplier_id,starts,reached,completes,terminates,over_quota,quality_term,incidence_rate,cost&project_code=eq.${encodeURIComponent(projectCode)}`, access.authorization);
      }
      const metrics = new Map(metricRows.map((row) => [row.supplier_id, row]));
      return Response.json({ data: rows.map((row) => assignmentRow({ ...row, ...metrics.get(row.supplier_id) }, new URL(request.url).origin, projectCode)), meta: { source: "supabase" } });
    }
    if (assignmentsMatch && request.method === "PUT") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.operate);
      if (!access.ok) return authorizationError(access);
      const capability = await getProjectCapabilities(env, access.authorization, assignmentsMatch[1]);
      if (!capability?.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
      const assignments = parseAssignments(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!assignments) return Response.json({ error: "Valid, unique supplier assignments are required" }, { status: 400 });
      const rows = await supabaseJson<Array<{ id: string; supplier_id: string; supplier_name: string; supplier_project_id: string | null; supplier_cpi: number | string; target_quota: number; status: SupplierAssignment["status"] }>>(env, "/rest/v1/rpc/replace_project_suppliers", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: assignmentsMatch[1].toUpperCase(), p_assignments: assignments.map((item) => ({ supplier_id: item.supplierId, supplier_project_id: item.supplierProjectId, supplier_cpi: item.supplierCpi, target_quota: item.targetQuota, status: item.status })) }) });
      return Response.json({ data: rows.map(assignmentRow), meta: { source: "supabase" } });
    }
    if (detailMatch && request.method === "PATCH") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.operate);
      if (!access.ok) return authorizationError(access);
      const capability = await getProjectCapabilities(env, access.authorization, detailMatch[1]);
      if (!capability?.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
      const update = parseUpdatePayload(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!update) return Response.json({ error: "Valid project name, quota, CPI and dates are required" }, { status: 400 });
      await supabaseJson(env, "/rest/v1/rpc/update_project_core_v4", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: detailMatch[1].toUpperCase(), ...update }) });
      return Response.json({ data: { id: detailMatch[1].toUpperCase(), ...update }, meta: { source: "supabase" } });
    }
    const transitionMatch = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/transitions$/i);
    if (transitionMatch && request.method === "POST") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.operate);
      if (!access.ok) return authorizationError(access);
      const capability = await getProjectCapabilities(env, access.authorization, transitionMatch[1]);
      if (!capability?.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
      const status = requestedTransition(await request.json().catch(() => null) as Record<string, unknown> | null);
      if (!status) return Response.json({ error: "A valid target status is required" }, { status: 400 });
      const rows = await supabaseJson<Array<{ project_code: string; previous_status: ProjectStatus; status: ProjectStatus }>>(env, "/rest/v1/rpc/transition_project_state", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: transitionMatch[1].toUpperCase(), p_next_status: status }) });
      const changed = rows[0];
      return Response.json({ data: { id: changed?.project_code, previousStatus: changed?.previous_status, status: changed?.status }, meta: { source: "supabase" } });
    }
  } catch (error) {
    const databaseError = error instanceof SupabaseRequestError ? error : null;
    console.error("project_database_request_failed", { pathname, status: databaseError?.status, code: databaseError?.code, message: error instanceof Error ? error.message : "Unknown error" });
    const reference = databaseError?.code ? ` (${databaseError.code})` : "";
    const message = databaseError?.status === 404
      ? `The project creation function is unavailable while the database schema cache refreshes${reference}`
      : databaseError?.detail
          ? `The database rejected the project: ${databaseError.detail}${reference}`
          : `The project database request failed${reference}`;
    return Response.json({ error: message }, { status: 502 });
  }
  return null;
}
