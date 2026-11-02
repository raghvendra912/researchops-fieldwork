import type { SupabaseEnv } from "../lib/supabase";
import { reconcileAbandoned } from "./analytics";
import { safeLog } from "../lib/observability";

export type MaintenanceEnv = SupabaseEnv & {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  CRON_SECRET?: string;
  ABANDONMENT_TIMEOUT_MINUTES?: string;
};

export async function handleMaintenanceCronApi(
  request: Request,
  pathname: string,
  env: MaintenanceEnv,
): Promise<Response | null> {
  if (pathname !== "/api/cron/maintenance") return null;
  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Verify CRON_SECRET if configured
  if (env.CRON_SECRET) {
    const authHeader = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${env.CRON_SECRET}`;
    if (authHeader !== expected) {
      return Response.json({ error: "Unauthorized cron invocation" }, { status: 401 });
    }
  } else if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    // Fail closed: with a real database behind it, an unset secret must not leave the job open to anyone.
    return Response.json({ error: "Scheduled maintenance is not configured" }, { status: 503 });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({
      ok: true,
      mode: "mock",
      message: "Maintenance cron executed in mock mode (database not configured)",
      timestamp: new Date().toISOString(),
    });
  }

  const startTime = Date.now();
  let reconciled = false;
  let maintenanceData: Record<string, unknown> = {};
  let marketplace: { confirmedEntries: number; pausedProjects: number } | null = null;
  let routingHits: Record<string, unknown> | null = null;

  try {
    // 1. Reconcile abandoned sessions
    reconciled = await reconcileAbandoned(env);

    // 2. Perform maintenance tasks (purge response values, pacing checks)
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/perform_maintenance_tasks`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
    });

    if (response.ok) {
      maintenanceData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } else {
      safeLog("warn", "perform_maintenance_tasks_failed", { status: response.status });
    }

    // 3. Marketplace supply maintenance (404 means migration 053 is not applied; never fails the cron)
    try {
      const mp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/maintain_marketplace_supply`, {
        method: "POST",
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          "content-type": "application/json",
        },
        body: "{}",
      });
      if (mp.ok) {
        const rows = (await mp.json().catch(() => null)) as
          | Array<{ confirmed_entries?: number; paused_projects?: number }>
          | { confirmed_entries?: number; paused_projects?: number }
          | null;
        const row = Array.isArray(rows) ? rows[0] : rows;
        marketplace = {
          confirmedEntries: Number(row?.confirmed_entries ?? 0),
          pausedProjects: Number(row?.paused_projects ?? 0),
        };
      } else if (mp.status !== 404) {
        safeLog("warn", "maintain_marketplace_supply_failed", { status: mp.status });
      }
    } catch {
      safeLog("warn", "maintain_marketplace_supply_failed", { status: 0 });
    }

    // 4. Routing-hit partitions and 90-day retention (404 means migration 054 is not applied; never fails the cron)
    try {
      const hits = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/maintain_routing_hits`, {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
        body: "{}",
      });
      if (hits.ok) routingHits = (await hits.json().catch(() => null)) as Record<string, unknown> | null;
      else if (hits.status !== 404) safeLog("warn", "maintain_routing_hits_failed", { status: hits.status });
    } catch {
      safeLog("warn", "maintain_routing_hits_failed", { status: 0 });
    }

    safeLog("info", "maintenance_cron_completed", {
      reconciled,
      maintenance: maintenanceData,
      durationMs: Date.now() - startTime,
    });

    return Response.json({
      ok: true,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      reconciled,
      maintenance: maintenanceData,
      marketplace,
      routingHits,
    });
  } catch (error) {
    safeLog("error", "maintenance_cron_exception", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: "Maintenance execution failed", details: error instanceof Error ? error.message : "Unknown" },
      { status: 502 },
    );
  }
}

