import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization.ts";
import { getProjectCapabilities } from "../lib/project-authorization.ts";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase.ts";

type Classification = "STANDARD" | "DEMOGRAPHIC" | "SENSITIVE";
type Variable = { id?: string; variableKey: string; label: string; dataClassification: Classification; retentionDays: number; active: boolean };

const demo: Variable[] = [
  { id: "variable-age", variableKey: "age", label: "Age", dataClassification: "DEMOGRAPHIC", retentionDays: 365, active: true },
  { id: "variable-postal-code", variableKey: "postal_code", label: "Postal code", dataClassification: "SENSITIVE", retentionDays: 90, active: false },
];

function mapped(row: Record<string, unknown>): Variable {
  return { id: String(row.id), variableKey: String(row.variable_key), label: String(row.label), dataClassification: String(row.data_classification) as Classification, retentionDays: Number(row.retention_days), active: row.active !== false };
}

function parse(body: Record<string, unknown> | null) {
  if (!body || !Array.isArray(body.variables) || body.variables.length > 30) return null;
  const classifications = new Set<Classification>(["STANDARD", "DEMOGRAPHIC", "SENSITIVE"]);
  const variables = body.variables.map((entry) => {
    const item = entry as Record<string, unknown>; const variableKey = String(item.variableKey ?? "").trim().toLowerCase(); const label = String(item.label ?? "").trim(); const dataClassification = String(item.dataClassification ?? "STANDARD").toUpperCase() as Classification; const retentionDays = Number(item.retentionDays ?? 365);
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(variableKey) || !label || label.length > 100 || !classifications.has(dataClassification) || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) return null;
    return { variableKey, label, dataClassification, retentionDays, active: item.active !== false };
  });
  return variables.every(Boolean) && new Set(variables.map((item) => item!.variableKey)).size === variables.length ? variables as Variable[] : null;
}

export async function handleResponseVariablesApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/response-variables$/i); if (!match) return null;
  const projectCode = match[1].toUpperCase(); if (request.method !== "GET" && request.method !== "PUT") return null;
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: demo, meta: { source: "mock", canOperate: true } });
    const variables = parse(await request.json().catch(() => null) as Record<string, unknown> | null); return variables ? Response.json({ data: variables, meta: { source: "mock", canOperate: true } }) : Response.json({ error: "Valid, unique response variables are required" }, { status: 400 });
  }
  const access = await authorizeWorkspace(request, env, request.method === "PUT" ? workspacePermissions.operate : workspacePermissions.read); if (!access.ok) return authorizationError(access);
  const capability = await getProjectCapabilities(env, access.authorization, projectCode); if (!capability) return Response.json({ error: "Project not found or unavailable" }, { status: 404 });
  if (request.method === "GET") {
    const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/project_response_variables?select=id,variable_key,label,data_classification,retention_days,active,projects!inner(project_code)&projects.project_code=eq.${encodeURIComponent(projectCode)}&order=variable_key.asc`, access.authorization);
    return Response.json({ data: rows.map(mapped), meta: { source: "supabase", canOperate: capability.can_operate } }, { headers: { "cache-control": "private, no-store" } });
  }
  if (!capability.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
  const variables = parse(await request.json().catch(() => null) as Record<string, unknown> | null); if (!variables) return Response.json({ error: "Valid, unique response variables are required" }, { status: 400 });
  const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/rpc/replace_project_response_variables", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: projectCode, p_variables: variables.map((item) => ({ variable_key: item.variableKey, label: item.label, data_classification: item.dataClassification, retention_days: item.retentionDays, active: item.active })) }) });
  return Response.json({ data: rows.map(mapped), meta: { source: "supabase", canOperate: true } });
}
