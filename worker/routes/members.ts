import { authorizationError, authorizeWorkspace, workspacePermissions, type WorkspaceRole } from "../lib/authorization.ts";
import { isSupabaseConfigured, supabaseJson, supabaseRequest, type SupabaseEnv } from "../lib/supabase.ts";

type MembersEnv = SupabaseEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };
type MemberRow = { organization_id: string; user_id: string; role: WorkspaceRole; created_at: string };
type AuthUser = { id: string; email?: string; user_metadata?: { display_name?: string; full_name?: string } };
const assignableRoles: WorkspaceRole[] = ["ADMIN", "PM", "ANALYST", "MEMBER"];
const demoMembers = [
  { userId: "demo-owner", email: "owner@example.com", displayName: "Demo Owner", role: "OWNER", createdAt: "2026-01-01T00:00:00.000Z" },
  { userId: "demo-pm", email: "pm@example.com", displayName: "Project Manager", role: "PM", createdAt: "2026-02-01T00:00:00.000Z" },
];

function serviceAuthorization(env: MembersEnv) { return `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`; }
function cleanEmail(value: unknown) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
function cleanName(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 100) : ""; }
function validEmail(value: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
function canManage(actor: WorkspaceRole, target: WorkspaceRole) { return target !== "OWNER" && (actor === "OWNER" || target !== "ADMIN"); }

async function adminUsers(env: MembersEnv) {
  const response = await supabaseRequest(env, "/auth/v1/admin/users?page=1&per_page=1000", serviceAuthorization(env));
  const body = await response.json() as { users?: AuthUser[] } | AuthUser[];
  return Array.isArray(body) ? body : body.users ?? [];
}

async function listMembers(env: MembersEnv, organizationId: string) {
  const authorization = serviceAuthorization(env);
  const rows = await supabaseJson<MemberRow[]>(env, `/rest/v1/organization_members?select=organization_id,user_id,role,created_at&organization_id=eq.${organizationId}&order=created_at.asc`, authorization);
  const users = new Map((await adminUsers(env)).map((user) => [user.id, user]));
  return rows.map((row) => {
    const user = users.get(row.user_id);
    return { userId: row.user_id, email: user?.email ?? "Unavailable", displayName: user?.user_metadata?.display_name ?? user?.user_metadata?.full_name ?? user?.email?.split("@")[0] ?? "Team member", role: row.role, createdAt: row.created_at };
  });
}

async function audit(env: MembersEnv, actorId: string | undefined, organizationId: string, action: string, targetId: string, role?: WorkspaceRole) {
  await supabaseRequest(env, "/rest/v1/audit_logs", serviceAuthorization(env), { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: organizationId, actor_user_id: actorId || null, action, entity_type: "ORGANIZATION_MEMBER", entity_id: targetId, metadata: role ? { role } : {} }) });
}

export async function handleMembersApi(request: Request, pathname: string, env: MembersEnv): Promise<Response | null> {
  if (!pathname.startsWith("/api/organization-members")) return null;
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: demoMembers, meta: { source: "mock", role: "OWNER" } });
    return Response.json({ data: demoMembers[1], meta: { source: "mock", role: "OWNER" } }, { status: request.method === "POST" ? 201 : 200 });
  }
  const access = await authorizeWorkspace(request, env, workspacePermissions.administer);
  if (!access.ok) return authorizationError(access);
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "User administration is not configured" }, { status: 503 });

  const memberId = pathname.match(/^\/api\/organization-members\/([^/]+)$/)?.[1];
  if (request.method === "GET" && !memberId) return Response.json({ data: await listMembers(env, access.membership.organization_id), meta: { source: "supabase", role: access.membership.role } });

  if (request.method === "POST" && !memberId) {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const email = cleanEmail(body?.email); const displayName = cleanName(body?.displayName); const role = body?.role as WorkspaceRole;
    if (!validEmail(email) || !displayName || !assignableRoles.includes(role) || !canManage(access.membership.role, role)) return Response.json({ error: "A valid name, email, and permitted role are required" }, { status: 400 });
    const invite = await supabaseRequest(env, "/auth/v1/invite", serviceAuthorization(env), { method: "POST", body: JSON.stringify({ email, data: { display_name: displayName } }) });
    const user = await invite.json() as AuthUser;
    try {
      await supabaseRequest(env, "/rest/v1/organization_members", serviceAuthorization(env), { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ organization_id: access.membership.organization_id, user_id: user.id, role }) });
      await audit(env, access.membership.user_id, access.membership.organization_id, "ORGANIZATION_MEMBER_INVITED", user.id, role);
    } catch (error) {
      await supabaseRequest(env, `/auth/v1/admin/users/${user.id}`, serviceAuthorization(env), { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
    return Response.json({ data: { userId: user.id, email, displayName, role, createdAt: new Date().toISOString() } }, { status: 201 });
  }

  if (memberId && (request.method === "PATCH" || request.method === "DELETE")) {
    if (memberId === access.membership.user_id) return Response.json({ error: "You cannot change your own workspace access" }, { status: 400 });
    const authorization = serviceAuthorization(env);
    const targets = await supabaseJson<MemberRow[]>(env, `/rest/v1/organization_members?select=organization_id,user_id,role,created_at&organization_id=eq.${access.membership.organization_id}&user_id=eq.${encodeURIComponent(memberId)}&limit=1`, authorization);
    const target = targets[0];
    if (!target) return Response.json({ error: "Workspace member not found" }, { status: 404 });
    if (!canManage(access.membership.role, target.role)) return Response.json({ error: "Your role cannot manage this member" }, { status: 403 });
    if (request.method === "DELETE") {
      await supabaseRequest(env, `/rest/v1/organization_members?organization_id=eq.${access.membership.organization_id}&user_id=eq.${encodeURIComponent(memberId)}`, authorization, { method: "DELETE" });
      await audit(env, access.membership.user_id, access.membership.organization_id, "ORGANIZATION_MEMBER_REVOKED", memberId);
      return Response.json({ data: { userId: memberId } });
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null; const role = body?.role as WorkspaceRole;
    if (!assignableRoles.includes(role) || !canManage(access.membership.role, role)) return Response.json({ error: "That role cannot be assigned" }, { status: 400 });
    await supabaseRequest(env, `/rest/v1/organization_members?organization_id=eq.${access.membership.organization_id}&user_id=eq.${encodeURIComponent(memberId)}`, authorization, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ role }) });
    await audit(env, access.membership.user_id, access.membership.organization_id, "ORGANIZATION_MEMBER_ROLE_UPDATED", memberId, role);
    return Response.json({ data: { userId: memberId, role } });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
