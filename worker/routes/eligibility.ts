import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import type { EligibilityOperator, EligibilityRule } from "../domain/eligibility";
import { getProjectCapabilities } from "../lib/project-authorization";

const operators = new Set<EligibilityOperator>(["EQ", "NE", "IN", "NOT_IN", "GTE", "LTE", "BETWEEN"]);
const demo: EligibilityRule[] = [
  { id: "eligibility-country", variableKey: "country", operator: "IN", values: ["IN", "US"], required: true, active: true },
  { id: "eligibility-age", variableKey: "age", operator: "BETWEEN", values: ["21", "45"], required: true, active: true },
];

function parseRules(body: Record<string, unknown> | null) {
  if (!body || !Array.isArray(body.rules) || body.rules.length > 30) return null;
  const rules = body.rules.map((value, index) => {
    const item = value as Record<string, unknown>; const variableKey = String(item.variableKey ?? "").trim().toLowerCase(); const operator = String(item.operator ?? "") as EligibilityOperator;
    const values = Array.isArray(item.values) ? item.values.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 50) : [];
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(variableKey) || !operators.has(operator) || values.length < 1 || (operator === "BETWEEN" && values.length !== 2)) return null;
    return { variableKey, operator, values, required: item.required !== false, active: item.active !== false, sortOrder: index };
  });
  return rules.every(Boolean) && new Set(rules.map((rule) => rule!.variableKey)).size === rules.length ? rules : null;
}

function mapped(row: Record<string, unknown>) { return { id: row.id, variableKey: row.variable_key, operator: row.operator, values: row.values, required: row.required, active: row.active, sortOrder: row.sort_order }; }

export async function handleEligibilityApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/eligibility$/i); if (!match) return null;
  const projectCode = match[1].toUpperCase();
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: demo, meta: { source: "mock", canOperate: true } });
    if (request.method === "PUT") { const rules = parseRules(await request.json().catch(() => null) as Record<string, unknown> | null); return rules ? Response.json({ data: rules, meta: { source: "mock" } }) : Response.json({ error: "Valid unique eligibility rules are required" }, { status: 400 }); }
    return null;
  }
  if (request.method === "GET") {
    const access = await authorizeWorkspace(request, env, workspacePermissions.read); if (!access.ok) return authorizationError(access);
    const capability = await getProjectCapabilities(env, access.authorization, projectCode);
    const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/project_eligibility_rules?select=id,variable_key,operator,values,required,active,sort_order,projects!inner(project_code)&projects.project_code=eq.${encodeURIComponent(projectCode)}&order=sort_order.asc`, access.authorization);
    return Response.json({ data: rows.map(mapped), meta: { source: "supabase", canOperate: capability?.can_operate === true } });
  }
  if (request.method === "PUT") {
    const access = await authorizeWorkspace(request, env, workspacePermissions.operate); if (!access.ok) return authorizationError(access);
    const capability = await getProjectCapabilities(env, access.authorization, projectCode); if (!capability?.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
    const rules = parseRules(await request.json().catch(() => null) as Record<string, unknown> | null); if (!rules) return Response.json({ error: "Valid unique eligibility rules are required" }, { status: 400 });
    const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/rpc/replace_project_eligibility_rules", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: projectCode, p_rules: rules.map((rule) => ({ variable_key: rule!.variableKey, operator: rule!.operator, values: rule!.values, required: rule!.required, active: rule!.active, sort_order: rule!.sortOrder })) }) });
    return Response.json({ data: rows.map(mapped), meta: { source: "supabase" } });
  }
  return null;
}
