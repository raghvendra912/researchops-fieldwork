import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import type { EligibilityOperator, EligibilityRule } from "../domain/eligibility";
import type { QuotaCell } from "../domain/quota";
import { getProjectCapabilities } from "../lib/project-authorization";

const operators = new Set<EligibilityOperator>(["EQ", "NE", "IN", "NOT_IN", "GTE", "LTE", "BETWEEN"]);
const demo: QuotaCell[] = [
  { id: "quota-in-21-34", name: "India · age 21–34", targetQuota: 120, priority: 10, active: true, completes: 47, reserved: 3, remaining: 70, conditions: [{ variableKey: "country", operator: "EQ", values: ["IN"], required: true }, { variableKey: "age", operator: "BETWEEN", values: ["21", "34"], required: true }] },
];

function parseCondition(value: unknown): EligibilityRule | null {
  const item = value as Record<string, unknown>;
  const variableKey = String(item?.variableKey ?? "").trim().toLowerCase();
  const operator = String(item?.operator ?? "") as EligibilityOperator;
  const values = Array.isArray(item?.values) ? item.values.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 50) : [];
  if (!/^[a-z][a-z0-9_]{0,49}$/.test(variableKey) || !operators.has(operator) || values.length < 1 || (operator === "BETWEEN" && values.length !== 2)) return null;
  return { variableKey, operator, values, required: item.required !== false, active: true };
}

function parseCells(body: Record<string, unknown> | null) {
  if (!body || !Array.isArray(body.cells) || body.cells.length > 50) return null;
  const cells = body.cells.map((value, index) => {
    const item = value as Record<string, unknown>;
    const name = String(item.name ?? "").trim();
    const targetQuota = Number(item.targetQuota);
    const priority = Number(item.priority ?? index * 10);
    const sourceConditions = Array.isArray(item.conditions) ? item.conditions : [];
    const conditions = sourceConditions.map(parseCondition);
    if (!name || name.length > 100 || !Number.isInteger(targetQuota) || targetQuota < 1 || targetQuota > 10_000_000 || !Number.isInteger(priority) || priority < 0 || priority > 10_000 || !conditions.every(Boolean)) return null;
    const uniqueKeys = new Set(conditions.map((condition) => condition!.variableKey));
    if (uniqueKeys.size !== conditions.length) return null;
    return { name, targetQuota, priority, active: item.active !== false, conditions: conditions as EligibilityRule[] };
  });
  return cells.every(Boolean) && new Set(cells.map((cell) => cell!.name.toLowerCase())).size === cells.length ? cells : null;
}

function mapped(row: Record<string, unknown>, metrics?: Record<string, unknown>): QuotaCell {
  const conditions = Array.isArray(row.conditions) ? row.conditions as Array<Record<string, unknown>> : [];
  return { id: String(row.id), name: String(row.name), targetQuota: Number(row.target_quota), priority: Number(row.priority), active: row.active !== false, completes: Number(metrics?.completes ?? 0), reserved: Number(metrics?.reserved ?? 0), remaining: Number(metrics?.remaining ?? row.target_quota), conditions: conditions.map((condition) => ({ variableKey: String(condition.variable_key), operator: String(condition.operator) as EligibilityOperator, values: Array.isArray(condition.values) ? condition.values.map(String) : [], required: condition.required !== false, active: true })) };
}

export async function handleQuotaCellsApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/quota-cells$/i);
  if (!match) return null;
  const projectCode = match[1].toUpperCase();
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: demo, meta: { source: "mock", canOperate: true } });
    if (request.method === "PUT") { const cells = parseCells(await request.json().catch(() => null) as Record<string, unknown> | null); return cells ? Response.json({ data: cells, meta: { source: "mock" } }) : Response.json({ error: "Valid, uniquely named quota cells are required" }, { status: 400 }); }
    return null;
  }
  if (request.method === "GET") {
    const access = await authorizeWorkspace(request, env, workspacePermissions.read); if (!access.ok) return authorizationError(access);
    const capability = await getProjectCapabilities(env, access.authorization, projectCode);
    const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/project_quota_cells?select=id,project_id,name,target_quota,priority,active,conditions,projects!inner(project_code)&projects.project_code=eq.${encodeURIComponent(projectCode)}&order=priority.asc,name.asc`, access.authorization);
    const metrics = rows[0]?.project_id ? await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/project_quota_cell_metrics?select=quota_cell_id,completes,reserved,remaining&project_id=eq.${encodeURIComponent(String(rows[0].project_id))}`, access.authorization) : [];
    const metricsByCell = new Map(metrics.map((metric) => [String(metric.quota_cell_id), metric]));
    return Response.json({ data: rows.map((row) => mapped(row, metricsByCell.get(String(row.id)))), meta: { source: "supabase", canOperate: capability?.can_operate === true } });
  }
  if (request.method === "PUT") {
    const access = await authorizeWorkspace(request, env, workspacePermissions.operate); if (!access.ok) return authorizationError(access);
    const capability = await getProjectCapabilities(env, access.authorization, projectCode); if (!capability?.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
    const cells = parseCells(await request.json().catch(() => null) as Record<string, unknown> | null); if (!cells) return Response.json({ error: "Valid, uniquely named quota cells are required" }, { status: 400 });
    const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/rpc/replace_project_quota_cells", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: projectCode, p_cells: cells.map((cell) => ({ name: cell!.name, target_quota: cell!.targetQuota, priority: cell!.priority, active: cell!.active, conditions: cell!.conditions.map((condition) => ({ variable_key: condition.variableKey, operator: condition.operator, values: condition.values, required: condition.required })) })) }) });
    return Response.json({ data: rows.map(mapped), meta: { source: "supabase" } });
  }
  return null;
}
