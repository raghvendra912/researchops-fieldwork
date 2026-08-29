import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit";
import type { SupabaseEnv } from "../lib/supabase";

const allowed = /^\/supabase\/(auth\/v1|rest\/v1|graphql\/v1)(?:\/|$)/;

function authLimit(request: Request, pathname: string) {
  if (request.method !== "POST") return null;
  const rule = pathname === "/supabase/auth/v1/token"
    ? { limit: 10, seconds: 60 }
    : pathname === "/supabase/auth/v1/signup" || pathname === "/supabase/auth/v1/recover"
      ? { limit: 5, seconds: 15 * 60 }
      : null;
  if (!rule) return null;
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return checkRateLimit(`auth:${pathname}:${forwarded}`, rule.limit, rule.seconds);
}

export async function handleSupabaseProxy(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  if (!pathname.startsWith("/supabase/")) return null;
  if (!allowed.test(pathname)) return Response.json({ error: "Unsupported Supabase route" }, { status: 404 });
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return Response.json({ error: "Supabase is not configured" }, { status: 503 });

  const limit = authLimit(request, pathname);
  if (limit && !limit.allowed) return rateLimitResponse(limit);

  const source = new URL(request.url);
  const target = new URL(pathname.replace(/^\/supabase/, "") + source.search, env.SUPABASE_URL);
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("apikey", env.SUPABASE_ANON_KEY);
  const init: RequestInit = { method: request.method, headers, redirect: "manual" };
  if (!["GET", "HEAD"].includes(request.method)) init.body = await request.arrayBuffer();

  try {
    const upstream = await fetch(target, init);
    const responseHeaders = new Headers(upstream.headers);
    const location = responseHeaders.get("location");
    if (location && location.startsWith(env.SUPABASE_URL)) responseHeaders.set("location", location.replace(env.SUPABASE_URL, "/supabase"));
    responseHeaders.set("cache-control", "private, no-store");
    const body = request.method === "HEAD" ? null : await upstream.arrayBuffer();
    return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  } catch {
    return Response.json({ error: "Supabase gateway request failed" }, { status: 502 });
  }
}
