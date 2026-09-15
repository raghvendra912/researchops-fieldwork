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

export function rateLimitResponse(result: ReturnType<typeof checkRateLimit>) {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil((result.resetsAt - Date.now()) / 1000))), "x-ratelimit-remaining": "0" } });
}
