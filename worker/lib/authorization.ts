import { SupabaseRequestError, supabaseJson, type SupabaseEnv } from "./supabase";

export type WorkspaceRole = "OWNER" | "ADMIN" | "PM" | "ANALYST" | "MEMBER";

export type WorkspaceMembership = {
  organization_id: string;
  role: WorkspaceRole;
  user_id?: string;
};

type AuthorizationResult =
  | { ok: true; authorization: string; membership: WorkspaceMembership }
  | { ok: false; status: 401 | 403 | 502; error: string };

export const workspacePermissions = {
  read: ["OWNER", "ADMIN", "PM", "ANALYST", "MEMBER"],
  operate: ["OWNER", "ADMIN", "PM"],
  review: ["OWNER", "ADMIN", "PM", "ANALYST"],
  administer: ["OWNER", "ADMIN"],
  own: ["OWNER"],
} as const satisfies Record<string, readonly WorkspaceRole[]>;

export async function authorizeWorkspace(
  request: Request,
  env: SupabaseEnv,
  allowedRoles: readonly WorkspaceRole[],
): Promise<AuthorizationResult> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return { ok: false, status: 401, error: "A valid workspace session is required" };
  try {
    // PostgREST verifies the bearer JWT before evaluating tenant RLS, so the
    // membership query is both the authentication and authorization check.
    const memberships = await supabaseJson<WorkspaceMembership[]>(
      env,
      "/rest/v1/organization_members?select=organization_id,role&order=created_at&limit=1",
      authorization,
    );
    const membership = memberships[0];
    if (!membership) return { ok: false, status: 403, error: "Workspace membership is required" };
    if (!allowedRoles.includes(membership.role)) return { ok: false, status: 403, error: "Your workspace role does not allow this action" };
    const token = authorization.slice("Bearer ".length).split(".")[1] ?? "";
    let userId = "";
    try {
      const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as { sub?: string };
      userId = String(payload.sub ?? "");
    } catch { userId = ""; }
    return { ok: true, authorization, membership: { ...membership, user_id: userId } };
  } catch (error) {
    if (error instanceof SupabaseRequestError && (error.status === 401 || error.status === 403)) {
      return { ok: false, status: 401, error: "A valid workspace session is required" };
    }
    return { ok: false, status: 502, error: "Workspace authorization could not be verified" };
  }
}

export function authorizationError(result: Extract<AuthorizationResult, { ok: false }>) {
  return Response.json({ error: result.error }, { status: result.status });
}
