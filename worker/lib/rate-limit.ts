type Bucket = { count: number; resetsAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const current = buckets.get(key);
  const bucket = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + windowSeconds * 1000 } : current;
  bucket.count += 1; buckets.set(key, bucket);
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetsAt: bucket.resetsAt };
}

export function rateLimitResponse(result: ReturnType<typeof checkRateLimit>) {
  return Response.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil((result.resetsAt - Date.now()) / 1000))), "x-ratelimit-remaining": "0" } });
}
