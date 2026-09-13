import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";

type AnalyticsEnv = SupabaseEnv & { SUPABASE_SERVICE_ROLE_KEY?: string };

const demo = {
  portfolio: { testStarts: 24, testCompletes: 8, testTerminates: 4, testOverQuota: 2, testQualityTerminates: 1, starts: 5377, reached: 4920, completes: 1994, terminates: 2028, overQuota: 516, qualityTerminates: 224, abandons: 387, inProgress: 228, incidenceRate: 49.58, conversionRate: 40.53, dropOffRate: 7.2, lastEventAt: new Date().toISOString() },
  suppliers: [{ name: "CPX Research", starts: 2100, reached: 1900, completes: 840, terminates: 1060, overQuota: 120, qualityTerminates: 80, incidenceRate: 44.21, conversionRate: 44.21, cost: 7140 }, { name: "BitLabs", starts: 1740, reached: 1600, completes: 631, terminates: 969, overQuota: 90, qualityTerminates: 50, incidenceRate: 39.44, conversionRate: 39.44, cost: 5994.5 }, { name: "PureSpectrum", starts: 1537, reached: 1420, completes: 523, terminates: 897, overQuota: 75, qualityTerminates: 94, incidenceRate: 36.83, conversionRate: 36.83, cost: 4968.5 }],
  clients: [{ name: "Northstar Bank", completes: 818 }, { name: "Arc Technologies", completes: 612 }],
  markets: [{ countryCode: "IN", completes: 740 }, { countryCode: "US", completes: 631 }],
};

export async function reconcileAbandoned(env: AnalyticsEnv) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return false;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reconcile_abandoned_sessions`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_timeout_minutes: 1440 }),
    });
    await response.arrayBuffer();
    if (!response.ok) console.warn("abandonment_reconciliation_failed", { status: response.status });
    return response.ok;
  } catch (error) {
    console.warn("abandonment_reconciliation_failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return false;
  }
}

export async function handleAnalyticsApi(request: Request, pathname: string, env: AnalyticsEnv): Promise<Response | null> {
  if (pathname !== "/api/analytics" || request.method !== "GET") return null;
  const params = new URL(request.url).searchParams;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") ?? "") ? params.get("to")! : new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") ?? "") ? params.get("from")! : new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  if (from > to) return Response.json({ error: "The start date must not follow the end date" }, { status: 400 });
  if (!isSupabaseConfigured(env)) return Response.json({ data: demo, meta: { source: "mock", from, to, reconciled: false } });
  const access = await authorizeWorkspace(request, env, workspacePermissions.read);
  if (!access.ok) return authorizationError(access);
  try {
    const reconciled = await reconcileAbandoned(env);
    const data = await supabaseJson(env, "/rest/v1/rpc/analytics_snapshot", access.authorization, { method: "POST", body: JSON.stringify({ p_from: `${from}T00:00:00Z`, p_to: `${to}T23:59:59.999Z` }) });
    return Response.json({ data, meta: { source: "supabase", from, to, reconciled } }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    console.error("analytics_snapshot_failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return Response.json({ error: "Analytics could not be loaded" }, { status: 502 });
  }
}
