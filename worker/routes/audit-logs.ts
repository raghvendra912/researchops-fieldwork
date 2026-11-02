import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";

export type AuditLogEntry = {
  id: string;
  organizationId: string;
  actorUserId?: string;
  actorEmail?: string;
  actorDisplayName?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const demoAuditLogs: AuditLogEntry[] = [
  {
    id: "log-1",
    organizationId: "org-1",
    actorDisplayName: "System Admin",
    actorEmail: "admin@asrv.co.in",
    action: "ORGANIZATION_SETTINGS_UPDATED",
    entityType: "ORGANIZATION",
    entityId: "org-1",
    metadata: { timezone: "Asia/Kolkata" },
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: "log-2",
    organizationId: "org-1",
    actorDisplayName: "Fieldwork PM",
    actorEmail: "pm@asrv.co.in",
    action: "PROJECT_CREATED",
    entityType: "PROJECT",
    entityId: "proj-1",
    metadata: { projectCode: "ROP-1049", name: "B2B Tech Pulse" },
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

function mapAuditRow(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : undefined,
    actorEmail: row.actor_email ? String(row.actor_email) : undefined,
    actorDisplayName: row.actor_display_name ? String(row.actor_display_name) : undefined,
    action: String(row.action),
    entityType: String(row.entity_type),
    entityId: row.entity_id ? String(row.entity_id) : undefined,
    metadata: (typeof row.metadata === "object" && row.metadata !== null ? row.metadata : {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

export async function handleAuditLogsApi(
  request: Request,
  pathname: string,
  env: SupabaseEnv,
): Promise<Response | null> {
  if (pathname !== "/api/audit-logs") return null;

  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") {
      return Response.json({
        data: demoAuditLogs,
        meta: { source: "mock", total: demoAuditLogs.length, page: 1, pageSize: 50 },
      });
    }
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const access = await authorizeWorkspace(request, env, workspacePermissions.read);
  if (!access.ok) return authorizationError(access);

  // Audit logs are viewable by OWNER, ADMIN, and PM
  const allowedRoles = ["OWNER", "ADMIN", "PM"];
  if (!allowedRoles.includes(access.membership.role)) {
    return Response.json({ error: "Operator access is required to view audit logs" }, { status: 403 });
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const action = url.searchParams.get("action")?.trim() || null;
    const entityType = url.searchParams.get("entityType")?.trim() || null;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("pageSize") || "50", 10), 1), 200);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10), 1);
    const offset = (page - 1) * limit;

    try {
      // Try query_audit_logs RPC first (migration 051)
      const rows = await supabaseJson<Record<string, unknown>[]>(
        env,
        "/rest/v1/rpc/query_audit_logs",
        access.authorization,
        {
          method: "POST",
          body: JSON.stringify({
            p_action: action,
            p_entity_type: entityType,
            p_limit: limit,
            p_offset: offset,
          }),
        },
      ).catch(async () => {
        // Fallback to direct audit_logs table select
        let query = `/rest/v1/audit_logs?select=id,organization_id,actor_user_id,action,entity_type,entity_id,metadata,created_at&organization_id=eq.${access.membership.organization_id}&order=created_at.desc&limit=${limit}&offset=${offset}`;
        if (action) query += `&action=eq.${encodeURIComponent(action)}`;
        if (entityType) query += `&entity_type=eq.${encodeURIComponent(entityType)}`;
        return supabaseJson<Record<string, unknown>[]>(env, query, access.authorization);
      });

      const data = (rows ?? []).map(mapAuditRow);
      return Response.json({
        data,
        meta: { source: "supabase", count: data.length, page, pageSize: limit },
      });
    } catch {
      return Response.json({ error: "Failed to retrieve audit logs" }, { status: 502 });
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

