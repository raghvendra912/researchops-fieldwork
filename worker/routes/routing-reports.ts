import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization.ts";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 92;
export const DEFAULT_RANGE_DAYS = 30;
export const DECISIONS = ["INACTIVE", "INVALID", "NOT_ASSIGNED", "DUPLICATE", "PAUSED", "INELIGIBLE", "QUOTA_FULL", "SECURITY", "RATE_LIMITED", "ERROR", "REJECTED"] as const;

export type FunnelRatios = { clickToStart: number; startToReached: number; reachedToComplete: number; rejectionRate: number };
export type FunnelRow = { supplierId: string | null; supplierName: string; clicks: number; routed: number; rejected: number; rejections: Record<string, number>; starts: number; reachedClient: number; completes: number; terminates: number; quotaFull: number; qualityTerminates: number; ratios: FunnelRatios };

/** Ratio that is 0 (never NaN/Infinity) when the denominator is zero, rounded to 4 places. */
export function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function funnelRatios(input: { clicks: number; starts: number; reachedClient: number; completes: number; rejected: number }): FunnelRatios {
  return { clickToStart: ratio(input.starts, input.clicks), startToReached: ratio(input.reachedClient, input.starts), reachedToComplete: ratio(input.completes, input.reachedClient), rejectionRate: ratio(input.rejected, input.clicks) };
}

function parseInstant(value: string | null, endOfDay: boolean) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = Date.parse(dateOnly ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(time)) return Number.NaN;
  return dateOnly && endOfDay ? time + DAY_MS : time; // `to` is exclusive; a date-only `to` includes that whole day
}

/** Validates and clamps the window: default last 30 days, never longer than 92 days. */
export function resolveRange(fromParam: string | null, toParam: string | null, now = Date.now()) {
  const parsedTo = parseInstant(toParam, true); const parsedFrom = parseInstant(fromParam, false);
  if (Number.isNaN(parsedTo) || Number.isNaN(parsedFrom)) return null;
  const to = Math.min(parsedTo ?? now, now + DAY_MS);
  let from = parsedFrom ?? to - DEFAULT_RANGE_DAYS * DAY_MS;
  if (from >= to) from = to - DEFAULT_RANGE_DAYS * DAY_MS;
  let clamped = false;
  if (to - from > MAX_RANGE_DAYS * DAY_MS) { from = to - MAX_RANGE_DAYS * DAY_MS; clamped = true; }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), clamped };
}

function count(value: unknown) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }

export function mapFunnelRow(row: Record<string, unknown>): FunnelRow {
  const decisions = (typeof row.decisions === "object" && row.decisions !== null ? row.decisions : {}) as Record<string, unknown>;
  const clicks = count(row.clicks); const routed = Math.min(count(decisions.ROUTED), clicks); const rejected = clicks - routed;
  const rejections: Record<string, number> = {};
  for (const [decision, hits] of Object.entries(decisions)) if (decision !== "ROUTED" && count(hits)) rejections[decision] = count(hits);
  const starts = count(row.starts); const reachedClient = count(row.reached); const completes = count(row.completes);
  return { supplierId: row.supplier_id ? String(row.supplier_id) : null, supplierName: row.supplier_name ? String(row.supplier_name) : "Unknown supplier", clicks, routed, rejected, rejections, starts, reachedClient, completes, terminates: count(row.terminates), quotaFull: count(row.quota_full), qualityTerminates: count(row.quality_terminates), ratios: funnelRatios({ clicks, starts, reachedClient, completes, rejected }) };
}

const demoFunnelSource: Record<string, unknown>[] = [
  { supplier_id: "11111111-1111-4111-8111-111111111111", supplier_name: "CPX Research", clicks: 1240, decisions: { ROUTED: 1030, DUPLICATE: 80, RATE_LIMITED: 45, INELIGIBLE: 52, QUOTA_FULL: 33 }, starts: 960, reached: 610, completes: 372, terminates: 190, quota_full: 31, quality_terminates: 17 },
  { supplier_id: "22222222-2222-4222-8222-222222222222", supplier_name: "BitLabs", clicks: 610, decisions: { ROUTED: 540, SECURITY: 40, PAUSED: 30 }, starts: 480, reached: 305, completes: 170, terminates: 110, quota_full: 14, quality_terminates: 11 },
];

const demoTimeline = [
  { at: "2026-08-18T08:14:58Z", source: "ROUTER", label: "Supplier entry", status: "ROUTED", httpStatus: 302, targetHost: "survey.example.com", country: "IN", latencyMs: 42 },
  { at: "2026-08-18T08:15:00Z", source: "EVENT", label: "Started survey", status: "START" },
  { at: "2026-08-18T08:16:00Z", source: "EVENT", label: "Reached client", status: "REACHED_CLIENT" },
  { at: "2026-08-18T08:27:00Z", source: "EVENT", label: "Completed survey", status: "COMPLETE" },
];

function failure(error: string, status: number) { return Response.json({ error }, { status, headers: { "cache-control": "private, no-store" } }); }

async function handleFunnel(request: Request, env: SupabaseEnv) {
  const search = new URL(request.url).searchParams;
  const range = resolveRange(search.get("from"), search.get("to"));
  if (!range) return failure("A valid date range is required", 400);
  const projectId = search.get("projectId") ?? ""; const supplierId = search.get("supplierId") ?? "";
  if ((projectId && !UUID.test(projectId)) || (supplierId && !UUID.test(supplierId))) return failure("A valid project or supplier is required", 400);
  const projectCode = (search.get("projectCode") ?? "").trim().toUpperCase();
  if (projectCode && !/^[A-Z]{2,10}-[A-Z0-9-]{1,40}$/.test(projectCode)) return failure("A valid project is required", 400);
  const limit = Math.min(Math.max(Number.parseInt(search.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.min(Math.max(Number.parseInt(search.get("offset") ?? "0", 10) || 0, 0), 100_000);
  if (!isSupabaseConfigured(env)) {
    const rows = demoFunnelSource.map(mapFunnelRow).filter((row) => !supplierId || row.supplierId === supplierId);
    return Response.json({ data: rows.slice(offset, offset + limit), meta: { source: "mock", ...range, total: rows.length, limit, offset } });
  }
  const access = await authorizeWorkspace(request, env, workspacePermissions.operate);
  if (!access.ok) return authorizationError(access);
  try {
    let scopedProjectId = projectId;
    if (!scopedProjectId && projectCode) {
      // Resolved under the caller's RLS: a project they cannot see yields an empty report, not an error.
      const projects = await supabaseJson<Array<{ id: string }>>(env, `/rest/v1/projects?select=id&project_code=eq.${encodeURIComponent(projectCode)}&limit=1`, access.authorization);
      if (!projects.length) return Response.json({ data: [], meta: { source: "supabase", ...range, total: 0, limit, offset } }, { headers: { "cache-control": "private, no-store" } });
      scopedProjectId = projects[0].id;
    }
    const rows = await supabaseJson<Record<string, unknown>[]>(env, "/rest/v1/rpc/supplier_funnel_report", access.authorization, { method: "POST", body: JSON.stringify({ p_organization_id: access.membership.organization_id, p_from: range.from, p_to: range.to, p_project_id: scopedProjectId || null, p_supplier_id: supplierId || null }) });
    const data = rows.map(mapFunnelRow);
    return Response.json({ data: data.slice(offset, offset + limit), meta: { source: "supabase", ...range, total: data.length, limit, offset } }, { headers: { "cache-control": "private, no-store" } });
  } catch { return failure("The supplier funnel could not be loaded", 502); }
}

const EVENT_LABELS: Record<string, string> = { START: "Started survey", REACHED_CLIENT: "Reached client", COMPLETE: "Completed survey", TERMINATE: "Screened out by client", QUOTA_FULL: "Client quota full", QUALITY_TERMINATE: "Quality terminate", ABANDON: "Abandoned" };
const HOP_LABELS: Record<string, string> = { SUPPLIER_ENTRY: "Supplier entry", CLIENT_REDIRECT: "Sent to client", CLIENT_RETURN: "Client return", SUPPLIER_EXIT: "Sent back to supplier" };
const FLAG_LABELS: Record<string, string> = { DUPLICATE_IP: "Duplicate network flagged", DUPLICATE_DEVICE: "Duplicate device flagged", SPEEDING: "Speeding flagged", QUALITY_VIOLATION: "Quality violation flagged", UNVERIFIED_RETURN: "Unverified client return flagged", NO_CLIENT_REACH: "Completion without client reach flagged" };

export type TimelineItem = { at: string; source: "ROUTER" | "EVENT" | "FLAG"; label: string; status?: string; httpStatus?: number; targetHost?: string; country?: string; latencyMs?: number };

function compact(item: TimelineItem) { return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined && value !== null && !Number.isNaN(value))) as TimelineItem; }

/** Builds the whitelisted, chronologically ordered timeline. Hashes, IPs and URLs are never copied. */
export function buildTimeline(hits: Record<string, unknown>[], events: Record<string, unknown>[], flags: Record<string, unknown>[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...hits.map((hit) => compact({ at: String(hit.created_at), source: "ROUTER", label: HOP_LABELS[String(hit.hop)] ?? "Router hit", status: String(hit.decision), httpStatus: Number(hit.http_status) || undefined, targetHost: hit.target_host ? String(hit.target_host) : undefined, country: hit.country_code ? String(hit.country_code) : undefined, latencyMs: hit.latency_ms === null || hit.latency_ms === undefined ? undefined : Number(hit.latency_ms) })),
    ...events.map((event) => compact({ at: String(event.occurred_at), source: "EVENT", label: EVENT_LABELS[String(event.event_type)] ?? "Survey event", status: String(event.event_type) })),
    ...flags.map((flag) => compact({ at: String(flag.created_at), source: "FLAG", label: FLAG_LABELS[String(flag.rule_code)] ?? "Review flag", status: `${flag.severity}/${flag.status}` })),
  ].filter((item) => Number.isFinite(Date.parse(item.at)));
  const rank = { ROUTER: 0, EVENT: 1, FLAG: 2 };
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || rank[a.source] - rank[b.source]);
}

async function handleTimeline(request: Request, env: SupabaseEnv, sessionId: string) {
  if (!isSupabaseConfigured(env)) return Response.json({ data: demoTimeline, meta: { source: "mock" } });
  const access = await authorizeWorkspace(request, env, workspacePermissions.read);
  if (!access.ok) return authorizationError(access);
  try {
    // Session lookup runs under the caller's RLS (can_access_project), so ungranted projects look like missing rows.
    const sessions = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/survey_sessions?select=id&id=eq.${sessionId}&limit=1`, access.authorization);
    if (!sessions.length) return failure("Respondent session not found", 404);
    const [hits, events, flags] = await Promise.all([
      supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/routing_hits?select=hop,decision,http_status,target_host,country_code,latency_ms,created_at&session_id=eq.${sessionId}&order=created_at.asc&limit=200`, access.authorization),
      supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/survey_events?select=event_type,occurred_at&session_id=eq.${sessionId}&order=occurred_at.asc&limit=200`, access.authorization),
      supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/fraud_flags?select=rule_code,severity,status,created_at&session_id=eq.${sessionId}&order=created_at.asc&limit=100`, access.authorization),
    ]);
    return Response.json({ data: buildTimeline(hits, events, flags), meta: { source: "supabase", routerHitsVisible: ["OWNER", "ADMIN", "PM"].includes(access.membership.role) } }, { headers: { "cache-control": "private, no-store" } });
  } catch { return failure("The click timeline could not be loaded", 502); }
}

export async function handleRoutingReportsApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  if (pathname === "/api/routing/funnel") return request.method === "GET" ? handleFunnel(request, env) : Response.json({ error: "Method not allowed" }, { status: 405 });
  const timeline = pathname.match(/^\/api\/respondents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/timeline$/i);
  if (timeline) return request.method === "GET" ? handleTimeline(request, env, timeline[1].toLowerCase()) : Response.json({ error: "Method not allowed" }, { status: 405 });
  return null;
}
