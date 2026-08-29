import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";

const demo = [{ id: "session-demo-1", respondentRef: "RESP-78291", status: "COMPLETE", startedAt: "2026-08-18T08:15:00Z", completedAt: "2026-08-18T08:27:00Z", durationSeconds: 720, projectCode: "PRJ-1048", projectName: "Digital Wallet Adoption", supplierName: "CPX Research", supplierCpi: 7.5, events: [{ id: "event-1", eventType: "START", occurredAt: "2026-08-18T08:15:00Z" }, { id: "event-2", eventType: "REACHED_CLIENT", occurredAt: "2026-08-18T08:16:00Z" }, { id: "event-3", eventType: "COMPLETE", occurredAt: "2026-08-18T08:27:00Z" }] }];
function clean(value: string | null) { return (value ?? "").replace(/[%*,()]/g, " ").trim().slice(0, 100); }
function first<T>(value: T | T[] | null | undefined) { return Array.isArray(value) ? value[0] : value; }

export async function handleRespondentsApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  if (pathname !== "/api/respondents" || request.method !== "GET") return null;
  const search = new URL(request.url).searchParams; const q = clean(search.get("q")); const projectCode = clean(search.get("project")).toUpperCase(); const limit = search.get("export") === "1" ? 1000 : 100;
  if (!isSupabaseConfigured(env)) { const filtered = demo.filter((item) => (!q || item.respondentRef.toLowerCase().includes(q.toLowerCase())) && (!projectCode || item.projectCode === projectCode)); return Response.json({ data: filtered, meta: { source: "mock", projects: [{ code: "PRJ-1048", name: "Digital Wallet Adoption" }] } }); }
  const access = await authorizeWorkspace(request, env, workspacePermissions.read); if (!access.ok) return authorizationError(access);
  try {
    const projectRelation = projectCode ? "projects!inner(project_code,project_name)" : "projects(project_code,project_name)";
    const params = new URLSearchParams({ select: `id,respondent_ref,status,started_at,completed_at,${projectRelation},project_suppliers(supplier_cpi,suppliers(name)),survey_events(id,event_type,occurred_at,provider_transaction_id,metadata)`, order: "started_at.desc", "survey_events.order": "occurred_at.asc,id.asc", limit: String(limit) });
    if (q) params.set("respondent_ref", `ilike.*${q}*`); if (projectCode) params.set("projects.project_code", `eq.${projectCode}`);
    const [rows, projectRows] = await Promise.all([
      supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/survey_sessions?${params}`, access.authorization),
      supabaseJson<Array<{ project_code: string; project_name: string }>>(env, "/rest/v1/projects?select=project_code,project_name&order=created_at.desc&limit=1000", access.authorization),
    ]);
    const data = rows.map((row) => {
      const project = first(row.projects as { project_code?: string; project_name?: string } | { project_code?: string; project_name?: string }[] | null);
      const assignment = first(row.project_suppliers as { supplier_cpi?: number | string; suppliers?: { name?: string } | { name?: string }[] } | { supplier_cpi?: number | string; suppliers?: { name?: string } | { name?: string }[] }[] | null);
      const supplier = first(assignment?.suppliers); const events = Array.isArray(row.survey_events) ? row.survey_events as Record<string, unknown>[] : [];
      const started = new Date(String(row.started_at)).getTime(); const completed = row.completed_at ? new Date(String(row.completed_at)).getTime() : Number.NaN;
      return { id: row.id, respondentRef: row.respondent_ref, status: row.status, startedAt: row.started_at, completedAt: row.completed_at, durationSeconds: Number.isFinite(completed) ? Math.max(0, Math.round((completed - started) / 1000)) : null, projectCode: project?.project_code, projectName: project?.project_name, supplierName: supplier?.name, supplierCpi: Number(assignment?.supplier_cpi ?? 0), events: events.map((event) => ({ id: event.id, eventType: event.event_type, occurredAt: event.occurred_at, providerTransactionId: event.provider_transaction_id, metadata: event.metadata })) };
    });
    return Response.json({ data, meta: { source: "supabase", projects: projectRows.map((item) => ({ code: item.project_code, name: item.project_name })) } }, { headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: "Respondent sessions could not be loaded" }, { status: 502 }); }
}
