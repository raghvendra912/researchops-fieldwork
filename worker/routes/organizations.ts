import { isSupabaseConfigured, requireSupabaseUser, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";

type OrganizationRelation = { id: string; name: string; slug: string; timezone: string } | { id: string; name: string; slug: string; timezone: string }[] | null;
type MembershipRow = { role: string; organizations: OrganizationRelation };
const supportedTimezones = new Set(["UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Singapore", "Australia/Sydney"]);

function organizationFrom(row: MembershipRow | undefined) {
  if (!row) return null;
  const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
  return organization ? { ...organization, role: row.role } : null;
}

export async function handleOrganizationsApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  if (pathname !== "/api/organizations" && pathname !== "/api/organizations/current") return null;
  if (!isSupabaseConfigured(env)) {
    if (pathname.endsWith("/current") && request.method === "GET") return Response.json({ data: { id: "demo", name: "Demo workspace", slug: "demo", timezone: "Asia/Kolkata", role: "OWNER" }, meta: { source: "mock" } });
    if (pathname.endsWith("/current") && request.method === "PATCH") {
      const body = await request.json().catch(() => null) as { name?: unknown; timezone?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
      if (name.length < 2 || name.length > 100) return Response.json({ error: "Organization name must be between 2 and 100 characters" }, { status: 400 });
      if (!supportedTimezones.has(timezone)) return Response.json({ error: "Select a supported organization timezone" }, { status: 400 });
      return Response.json({ data: { id: "demo", name, slug: "demo", timezone, role: "OWNER" }, meta: { source: "mock" } });
    }
    return Response.json({ error: "Supabase is required to create an organization" }, { status: 503 });
  }

  const authorization = await requireSupabaseUser(request, env);
  if (!authorization) return Response.json({ error: "A valid workspace session is required" }, { status: 401 });

  try {
    if (pathname === "/api/organizations/current" && request.method === "GET") {
      const rows = await supabaseJson<MembershipRow[]>(env, "/rest/v1/organization_members?select=role,organizations(id,name,slug,timezone)&order=created_at&limit=1", authorization);
      return Response.json({ data: organizationFrom(rows[0]), meta: { source: "supabase" } }, { headers: { "cache-control": "private, no-store" } });
    }

    if (pathname === "/api/organizations/current" && request.method === "PATCH") {
      const access = await authorizeWorkspace(request, env, workspacePermissions.administer);
      if (!access.ok) return authorizationError(access);
      const body = await request.json().catch(() => null) as { name?: unknown; timezone?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
      if (name.length < 2 || name.length > 100) return Response.json({ error: "Organization name must be between 2 and 100 characters" }, { status: 400 });
      if (!supportedTimezones.has(timezone)) return Response.json({ error: "Select a supported organization timezone" }, { status: 400 });
      const rows = await supabaseJson<Array<{ organization_id: string; organization_name: string; organization_slug: string; organization_timezone: string; membership_role: string }>>(
        env, "/rest/v1/rpc/update_current_organization_settings", access.authorization,
        { method: "POST", body: JSON.stringify({ p_name: name, p_timezone: timezone }) },
      );
      const updated = rows[0];
      if (!updated) throw new Error("Supabase did not return the organization");
      return Response.json({ data: { id: updated.organization_id, name: updated.organization_name, slug: updated.organization_slug, timezone: updated.organization_timezone, role: updated.membership_role }, meta: { source: "supabase" } });
    }

    if (pathname === "/api/organizations" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { name?: unknown } | null;
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 100) return Response.json({ error: "Organization name must be between 2 and 100 characters" }, { status: 400 });
      const rows = await supabaseJson<Array<{ organization_id: string; organization_name: string; organization_slug: string; membership_role: string }>>(
        env,
        "/rest/v1/rpc/create_initial_organization",
        authorization,
        { method: "POST", body: JSON.stringify({ p_name: name }) },
      );
      const created = rows[0];
      if (!created) throw new Error("Supabase did not return the organization");
      return Response.json({ data: { id: created.organization_id, name: created.organization_name, slug: created.organization_slug, role: created.membership_role }, meta: { source: "supabase" } }, { status: 201 });
    }
  } catch {
    return Response.json({ error: "The organization database request failed" }, { status: 502 });
  }

  return null;
}
