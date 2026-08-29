import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";

const types = ["PROJECT_LIVE", "PROJECT_PAUSED", "PROJECT_CLOSED", "PACING_RISK", "QUOTA_REACHED", "QUALITY_FLAG", "CALLBACK_FAILURE"] as const;
type EventType = typeof types[number];
type Rule = { eventType: EventType; inAppEnabled: boolean; emailEnabled: boolean; threshold: number | null };
const demoNotifications = [{ id: "notice-1", eventType: "QUALITY_FLAG", severity: "CRITICAL", title: "Quality review needed for PRJ-1048", body: "SPEEDING was detected for a respondent session.", readAt: null, createdAt: "2026-08-18T08:28:00Z" }, { id: "notice-2", eventType: "PROJECT_LIVE", severity: "INFO", title: "PRJ-1047 is now live", body: "Enterprise Cloud Pulse moved from PENDING to LIVE.", readAt: null, createdAt: "2026-08-18T07:00:00Z" }];
const demoRules: Rule[] = types.map((eventType) => ({ eventType, inAppEnabled: true, emailEnabled: false, threshold: eventType === "PACING_RISK" ? 80 : null }));

function mapNotice(row: Record<string, unknown>) { return { id: String(row.id), eventType: String(row.event_type), severity: String(row.severity), title: String(row.title), body: String(row.body), readAt: row.read_at ? String(row.read_at) : null, createdAt: String(row.created_at) }; }
function mapRule(row: Record<string, unknown>): Rule { return { eventType: String(row.event_type) as EventType, inAppEnabled: Boolean(row.in_app_enabled), emailEnabled: Boolean(row.email_enabled), threshold: row.threshold === null ? null : Number(row.threshold) }; }
function parseRules(body: unknown): Rule[] | null {
  const input = body as { rules?: Array<Record<string, unknown>> } | null;
  if (!Array.isArray(input?.rules) || input.rules.length !== types.length) return null;
  const seen = new Set<string>(); const rules: Rule[] = [];
  for (const item of input.rules) {
    const eventType = String(item.eventType) as EventType;
    if (!types.includes(eventType) || seen.has(eventType) || typeof item.inAppEnabled !== "boolean" || typeof item.emailEnabled !== "boolean") return null;
    seen.add(eventType);
    const raw = item.threshold; const threshold = raw === null || raw === undefined || raw === "" ? null : Number(raw);
    if (eventType === "PACING_RISK") { if (!Number.isFinite(threshold) || threshold! < 1 || threshold! > 100) return null; }
    else if (threshold !== null) return null;
    rules.push({ eventType, inAppEnabled: item.inAppEnabled, emailEnabled: item.emailEnabled, threshold });
  }
  return rules;
}

export async function handleNotificationsApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const notice = pathname.match(/^\/api\/notifications(?:\/([^/]+))?$/); const rulesRoute = pathname === "/api/notification-rules";
  if (!notice && !rulesRoute) return null;
  if (!isSupabaseConfigured(env)) {
    if (notice && request.method === "GET" && !notice[1]) return Response.json({ data: demoNotifications, meta: { source: "mock" } });
    if (notice && request.method === "PATCH" && notice[1]) return Response.json({ data: { id: notice[1], readAt: new Date().toISOString() }, meta: { source: "mock" } });
    if (rulesRoute && request.method === "GET") return Response.json({ data: demoRules, meta: { source: "mock", canAdminister: true } });
    if (rulesRoute && request.method === "PUT") { const parsed = parseRules(await request.json().catch(() => null)); return parsed ? Response.json({ data: parsed, meta: { source: "mock", canAdminister: true } }) : Response.json({ error: "A complete, valid notification rule set is required" }, { status: 400 }); }
    return null;
  }
  const access = await authorizeWorkspace(request, env, rulesRoute && request.method !== "GET" ? workspacePermissions.administer : workspacePermissions.read); if (!access.ok) return authorizationError(access);
  try {
    if (notice && request.method === "GET" && !notice[1]) { const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/notifications?select=id,event_type,severity,title,body,read_at,created_at&order=created_at.desc&limit=100", access.authorization); return Response.json({ data: rows.map(mapNotice), meta: { source: "supabase" } }); }
    if (notice && request.method === "PATCH" && notice[1] && /^[0-9a-f-]{36}$/i.test(notice[1])) { const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/notifications?id=eq.${notice[1]}&select=*`, access.authorization, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ read_at: new Date().toISOString() }) }); return rows[0] ? Response.json({ data: mapNotice(rows[0]), meta: { source: "supabase" } }) : Response.json({ error: "Notification not found" }, { status: 404 }); }
    if (rulesRoute && request.method === "GET") { const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/notification_rules?select=event_type,in_app_enabled,email_enabled,threshold&order=event_type", access.authorization); const existing = new Map(rows.map((row) => [String(row.event_type), mapRule(row)])); const canAdminister = access.membership.role === "OWNER" || access.membership.role === "ADMIN"; return Response.json({ data: types.map((eventType) => existing.get(eventType) ?? { eventType, inAppEnabled: true, emailEnabled: false, threshold: eventType === "PACING_RISK" ? 80 : null }), meta: { source: "supabase", canAdminister } }); }
    if (rulesRoute && request.method === "PUT") { const parsed = parseRules(await request.json().catch(() => null)); if (!parsed) return Response.json({ error: "A complete, valid notification rule set is required" }, { status: 400 }); const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/rpc/replace_notification_rules", access.authorization, { method: "POST", body: JSON.stringify({ p_rules: parsed.map((rule) => ({ event_type: rule.eventType, in_app_enabled: rule.inAppEnabled, email_enabled: rule.emailEnabled, threshold: rule.threshold })) }) }); return Response.json({ data: rows.map(mapRule), meta: { source: "supabase", canAdminister: true } }); }
  } catch { return Response.json({ error: "Notification request failed" }, { status: 502 }); }
  return null;
}
