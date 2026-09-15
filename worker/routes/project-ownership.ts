import { authorizationError, authorizeWorkspace, workspacePermissions, type WorkspaceRole } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import { getProjectCapabilities } from "../lib/project-authorization";
import { projects as mockProjects } from "../../src/features/projects/mockProjects";

type ProjectRow = { id: string; organization_id: string; project_manager_id: string | null; secondary_project_manager_id: string | null; sales_person_id: string | null };
type MemberRow = { user_id: string; role: WorkspaceRole };
type ProfileRow = { id: string; display_name: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const demoMembers = [
  { userId: "00000000-0000-4000-8000-000000000011", displayName: "Raghav Mehta", workspaceRole: "PM" as WorkspaceRole },
  { userId: "00000000-0000-4000-8000-000000000012", displayName: "Maya Shah", workspaceRole: "PM" as WorkspaceRole },
  { userId: "00000000-0000-4000-8000-000000000014", displayName: "Anika Rao", workspaceRole: "PM" as WorkspaceRole },
  { userId: "00000000-0000-4000-8000-000000000013", displayName: "Priya Shah", workspaceRole: "MEMBER" as WorkspaceRole },
  { userId: "00000000-0000-4000-8000-000000000015", displayName: "Kabir Rao", workspaceRole: "MEMBER" as WorkspaceRole },
];

async function ownershipContext(env: SupabaseEnv, authorization: string, code: string) {
  const rows = await supabaseJson<ProjectRow[]>(env,
    `/rest/v1/projects?select=id,organization_id,project_manager_id,secondary_project_manager_id,sales_person_id&project_code=eq.${encodeURIComponent(code)}&limit=1`, authorization);
  const project = rows[0]; if (!project) return null;
  const members = await supabaseJson<MemberRow[]>(env,
    `/rest/v1/organization_members?select=user_id,role&organization_id=eq.${project.organization_id}&order=created_at.asc`, authorization);
  const ids = members.map((member) => member.user_id);
  const profiles = ids.length ? await supabaseJson<ProfileRow[]>(env,
    `/rest/v1/user_profiles?select=id,display_name&id=in.(${ids.join(",")})`, authorization) : [];
  const names = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
  const options = members.map((member) => ({ userId: member.user_id,
    displayName: names.get(member.user_id) ?? "Team member", workspaceRole: member.role }));
  return { project, data: {
    primaryManagerId: project.project_manager_id,
    secondaryManagerId: project.secondary_project_manager_id,
    salesPersonId: project.sales_person_id,
    primaryManager: names.get(project.project_manager_id ?? "") ?? "Unassigned",
    secondaryManager: names.get(project.secondary_project_manager_id ?? "") ?? "",
    salesPerson: names.get(project.sales_person_id ?? "") ?? "",
  }, managers: options.filter((option) => option.workspaceRole === "PM" && option.userId !== project.project_manager_id),
  salesPeople: options };
}

function parseBody(body: Record<string, unknown> | null) {
  if (!body || !("secondaryManagerId" in body) || !("salesPersonId" in body)) return null;
  const secondaryManagerId = body.secondaryManagerId === null || body.secondaryManagerId === "" ? null : body.secondaryManagerId;
  const salesPersonId = body.salesPersonId === null || body.salesPersonId === "" ? null : body.salesPersonId;
  if (secondaryManagerId !== null && (typeof secondaryManagerId !== "string" || !uuid.test(secondaryManagerId))) return null;
  if (salesPersonId !== null && (typeof salesPersonId !== "string" || !uuid.test(salesPersonId))) return null;
  return { secondaryManagerId, salesPersonId };
}

export async function handleProjectOwnershipApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/ownership$/i);
  if (!match || !["GET", "PUT"].includes(request.method)) return null;
  const code = match[1].toUpperCase();
  if (!isSupabaseConfigured(env)) {
    const project = mockProjects.find((item) => item.id === code);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const primary = demoMembers.find((member) => member.displayName === project.manager);
    const managers = demoMembers.filter((member) => member.workspaceRole === "PM" && member.userId !== primary?.userId);
    if (request.method === "GET") return Response.json({ data: { primaryManagerId: primary?.userId ?? null, secondaryManagerId: demoMembers.find((member) => member.displayName === project.secondaryManager)?.userId ?? null, salesPersonId: demoMembers.find((member) => member.displayName === project.salesPerson)?.userId ?? null, primaryManager: project.manager, secondaryManager: project.secondaryManager ?? "", salesPerson: project.salesPerson ?? "" }, meta: { source: "mock", canManage: true, managers, salesPeople: demoMembers } });
    const payload = parseBody(await request.json().catch(() => null) as Record<string, unknown> | null);
    if (!payload || (payload.secondaryManagerId && !managers.some((member) => member.userId === payload.secondaryManagerId)) || (payload.salesPersonId && !demoMembers.some((member) => member.userId === payload.salesPersonId))) return Response.json({ error: "Valid workspace ownership assignments are required" }, { status: 400 });
    project.secondaryManager = demoMembers.find((member) => member.userId === payload.secondaryManagerId)?.displayName ?? "";
    project.salesPerson = demoMembers.find((member) => member.userId === payload.salesPersonId)?.displayName ?? "";
    project.updatedAt = new Date().toISOString();
    return Response.json({ data: { primaryManagerId: primary?.userId ?? null, primaryManager: project.manager, secondaryManagerId: payload.secondaryManagerId, secondaryManager: project.secondaryManager, salesPersonId: payload.salesPersonId, salesPerson: project.salesPerson }, meta: { source: "mock", canManage: true, managers, salesPeople: demoMembers } });
  }
  const access = await authorizeWorkspace(request, env, request.method === "PUT" ? workspacePermissions.operate : workspacePermissions.read);
  if (!access.ok) return authorizationError(access);
  const capability = await getProjectCapabilities(env, access.authorization, code);
  if (!capability?.can_access) return Response.json({ error: "Project not found" }, { status: 404 });
  if (request.method === "PUT" && !capability.can_manage_access) return Response.json({ error: "Project ownership administration denied" }, { status: 403 });
  const current = await ownershipContext(env, access.authorization, code);
  if (!current) return Response.json({ error: "Project not found" }, { status: 404 });
  if (request.method === "GET") return Response.json({ data: current.data, meta: { source: "supabase", canManage: capability.can_manage_access, managers: current.managers, salesPeople: current.salesPeople } }, { headers: { "cache-control": "private, no-store" } });
  const payload = parseBody(await request.json().catch(() => null) as Record<string, unknown> | null);
  if (!payload || (payload.secondaryManagerId && !current.managers.some((manager) => manager.userId === payload.secondaryManagerId)) || (payload.salesPersonId && !current.salesPeople.some((person) => person.userId === payload.salesPersonId))) return Response.json({ error: "Valid workspace ownership assignments are required" }, { status: 400 });
  await supabaseJson(env, "/rest/v1/rpc/set_project_ownership", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: code, p_secondary_manager_id: payload.secondaryManagerId, p_sales_person_id: payload.salesPersonId }) });
  const saved = await ownershipContext(env, access.authorization, code);
  return Response.json({ data: saved!.data, meta: { source: "supabase", canManage: true, managers: saved!.managers, salesPeople: saved!.salesPeople } }, { headers: { "cache-control": "private, no-store" } });
}
