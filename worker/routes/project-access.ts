import { authorizationError, authorizeWorkspace, workspacePermissions, type WorkspaceRole } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import { projectAccessOptions, validProjectAccessRole, type ProjectAccessGrant, type ProjectAccessRole } from "../domain/project-access";
import { getProjectCapabilities } from "../lib/project-authorization";

type ProjectRow = { id: string; organization_id: string; project_manager_id: string | null };
type MemberRow = { user_id: string; role: WorkspaceRole };
type GrantRow = { id: string; user_id: string; access_role: ProjectAccessRole; user_profiles?: { display_name: string } | { display_name: string }[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const demoMembers = [
  { userId: "00000000-0000-4000-8000-000000000011", displayName: "Priya Shah", workspaceRole: "PM" as WorkspaceRole, allowedRoles: projectAccessOptions.PM },
  { userId: "00000000-0000-4000-8000-000000000012", displayName: "Kabir Rao", workspaceRole: "ANALYST" as WorkspaceRole, allowedRoles: projectAccessOptions.ANALYST },
  { userId: "00000000-0000-4000-8000-000000000013", displayName: "Client Observer", workspaceRole: "MEMBER" as WorkspaceRole, allowedRoles: projectAccessOptions.MEMBER },
];
const demoGrants: ProjectAccessGrant[] = [{ id: "access-demo", userId: demoMembers[1].userId, displayName: demoMembers[1].displayName, workspaceRole: demoMembers[1].workspaceRole, accessRole: "REVIEWER" }];

function first<T>(value: T | T[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function parse(body: Record<string, unknown> | null) {
  if (!body || !Array.isArray(body.grants) || body.grants.length > 50) return null;
  const grants = body.grants.map((value) => { const item = value as Record<string, unknown>; const userId = String(item.userId ?? ""); const accessRole = String(item.accessRole ?? "") as ProjectAccessRole; return uuid.test(userId) && ["EDITOR", "REVIEWER", "VIEWER"].includes(accessRole) ? { userId, accessRole } : null; });
  return grants.every(Boolean) && new Set(grants.map((grant) => grant!.userId)).size === grants.length ? grants : null;
}

async function context(env: SupabaseEnv, authorization: string, code: string) {
  const projects = await supabaseJson<ProjectRow[]>(env, `/rest/v1/projects?select=id,organization_id,project_manager_id&project_code=eq.${encodeURIComponent(code)}&limit=1`, authorization);
  const project = projects[0]; if (!project) return null;
  const [grants, members] = await Promise.all([
    supabaseJson<GrantRow[]>(env, `/rest/v1/project_access_grants?select=id,user_id,access_role,user_profiles(display_name)&project_id=eq.${project.id}&order=access_role.asc,created_at.asc`, authorization),
    supabaseJson<MemberRow[]>(env, `/rest/v1/organization_members?select=user_id,role&organization_id=eq.${project.organization_id}&order=created_at.asc`, authorization),
  ]);
  const ids = members.map((member) => member.user_id);
  const profiles = ids.length ? await supabaseJson<Array<{ id: string; display_name: string }>>(env, `/rest/v1/user_profiles?select=id,display_name&id=in.(${ids.join(",")})`, authorization) : [];
  const names = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
  const roles = new Map(members.map((member) => [member.user_id, member.role]));
  return {
    project,
    grants: grants.map((grant) => ({ id: grant.id, userId: grant.user_id, displayName: first(grant.user_profiles)?.display_name ?? names.get(grant.user_id) ?? "Team member", workspaceRole: roles.get(grant.user_id), accessRole: grant.access_role })),
    members: members.filter((member) => member.user_id !== project.project_manager_id && projectAccessOptions[member.role].length > 0).map((member) => ({ userId: member.user_id, displayName: names.get(member.user_id) ?? "Team member", workspaceRole: member.role, allowedRoles: projectAccessOptions[member.role] })),
  };
}

export async function handleProjectAccessApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/access$/i); if (!match) return null;
  const code = match[1].toUpperCase();
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: demoGrants, meta: { source: "mock", canManage: true, members: demoMembers } });
    if (request.method === "PUT") { const grants = parse(await request.json().catch(() => null) as Record<string, unknown> | null); const memberRoles = new Map(demoMembers.map((member) => [member.userId, member.workspaceRole])); const compatible = grants?.every((grant) => { const role = memberRoles.get(grant!.userId); return role && validProjectAccessRole(role, grant!.accessRole); }); return grants && compatible ? Response.json({ data: grants, meta: { source: "mock", canManage: true, members: demoMembers } }) : Response.json({ error: "Valid compatible project access grants are required" }, { status: 400 }); }
    return null;
  }
  if (request.method !== "GET" && request.method !== "PUT") return null;
  const access = await authorizeWorkspace(request, env, request.method === "PUT" ? workspacePermissions.operate : workspacePermissions.read); if (!access.ok) return authorizationError(access);
  const current = await context(env, access.authorization, code); if (!current) return Response.json({ error: "Project not found or unavailable" }, { status: 404 });
  const capability = await getProjectCapabilities(env, access.authorization, code);
  const canManage = capability?.can_manage_access === true;
  if (request.method === "GET") return Response.json({ data: current.grants, meta: { source: "supabase", canManage, members: current.members } });
  if (!canManage) return Response.json({ error: "Only an owner, administrator, or assigned project manager can manage project access" }, { status: 403 });
  const grants = parse(await request.json().catch(() => null) as Record<string, unknown> | null); if (!grants) return Response.json({ error: "Valid unique project access grants are required" }, { status: 400 });
  const memberRoles = new Map(current.members.map((member) => [member.userId, member]));
  if (grants.some((grant) => { const member = memberRoles.get(grant!.userId); return !member || !member.allowedRoles.includes(grant!.accessRole); })) return Response.json({ error: "A project role is incompatible with the member workspace role" }, { status: 400 });
  await supabaseJson(env, "/rest/v1/rpc/replace_project_access_grants", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: code, p_grants: grants.map((grant) => ({ user_id: grant!.userId, access_role: grant!.accessRole })) }) });
  const saved = await context(env, access.authorization, code); return Response.json({ data: saved?.grants ?? [], meta: { source: "supabase", canManage: true, members: saved?.members ?? current.members } });
}
