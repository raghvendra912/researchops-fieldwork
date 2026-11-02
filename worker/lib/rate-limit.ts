import { safeLog } from "./observability.ts";

type Bucket = { count: number; resetsAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10000; // Prevent unbounded memory growth

// Periodic cleanup of expired buckets to prevent memory leaks
function cleanupExpiredBuckets() {
  const now = Date.now();
  let removed = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetsAt <= now) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}

// Run cleanup every 60 seconds if buckets exceed threshold
let lastCleanup = Date.now();
function maybeCleanup() {
  const now = Date.now();
  if (buckets.size > MAX_BUCKETS / 2 && now - lastCleanup > 60000) {
    cleanupExpiredBuckets();
    lastCleanup = now;
  }
}

export function checkRateLimit(key: string, limit: number, windowSeconds: number) {
  maybeCleanup();

  const now = Date.now();
  const current = buckets.get(key);
  const bucket = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + windowSeconds * 1000 } : current;
  bucket.count += 1;

  // Enforce maximum bucket limit to prevent DoS via unique keys
  if (buckets.size >= MAX_BUCKETS && !current) {
    // When at capacity, deny new unique keys (prevents memory exhaustion attacks)
    return { allowed: false, remaining: 0, resetsAt: bucket.resetsAt };
  }

  buckets.set(key, bucket);
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetsAt: bucket.resetsAt };
}

export type RateLimitResult = ReturnType<typeof checkRateLimit>;

export type SharedRateLimitEnv = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };

const SHARED_TIMEOUT_MS = 800;
const WARN_INTERVAL_MS = 30_000;
let lastWarnAt = 0;

function warnThrottled(reason: string) {
  const now = Date.now();
  if (now - lastWarnAt < WARN_INTERVAL_MS) return;
  lastWarnAt = now;
  safeLog("warn", "shared_rate_limit_fallback", { reason });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Cross-instance rate limit backed by Postgres (migration 056). Fail-safe: if the database
 * call errors or times out, falls back to the per-instance in-memory limiter.
 * Pass `options.ip` to have it hashed into the key (raw IPs are never sent or logged).
 */
export async function checkSharedRateLimit(
  env: SharedRateLimitEnv,
  key: string,
  limit: number,
  windowSeconds: number,
  options: { ip?: string | null } = {},
): Promise<RateLimitResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new RangeError("limit must be an integer 1..100000");
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) throw new RangeError("windowSeconds must be an integer 1..86400");
  if (!key) throw new RangeError("key is required");

  let bucketKey = key;
  if (options.ip) bucketKey = `${bucketKey}:${(await sha256Hex(options.ip)).slice(0, 32)}`;
  if (bucketKey.length > 200) bucketKey = `h:${await sha256Hex(bucketKey)}`;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return checkRateLimit(bucketKey, limit, windowSeconds);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHARED_TIMEOUT_MS);
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_rate_limit`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_key: bucketKey, p_limit: limit, p_window_seconds: windowSeconds }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const payload = await response.json();
    const row = Array.isArray(payload) ? payload[0] : payload;
    const resetsAt = Date.parse(row?.resets_at);
    if (!row || typeof row.allowed !== "boolean" || typeof row.remaining !== "number" || Number.isNaN(resetsAt)) throw new Error("malformed response");
    return { allowed: row.allowed, remaining: row.remaining, resetsAt };
  } catch (error) {
    warnThrottled(error instanceof Error && error.name === "AbortError" ? "timeout" : error instanceof Error ? error.message.slice(0, 80) : "error");
    return checkRateLimit(bucketKey, limit, windowSeconds);
  } finally {
    clearTimeout(timer);
  }
}

/** Call from the maintenance cron: removes stale shared buckets (migration 056). Never throws. */
export async function purgeSharedRateLimitBuckets(env: SharedRateLimitEnv): Promise<number | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/purge_rate_limit_buckets`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const value = await response.json();
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

export function rateLimitResponse(result: RateLimitResult) {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil((result.resetsAt - Date.now()) / 1000))), "x-ratelimit-remaining": "0" } });
}
