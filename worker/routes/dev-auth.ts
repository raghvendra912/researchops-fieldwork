import type { SupabaseEnv } from "../lib/supabase";

type DevAuthEnv = SupabaseEnv & {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  DEV_AUTO_LOGIN?: string;
  DEV_AUTO_LOGIN_TOKEN?: string;
};

function serviceHeaders(env: DevAuthEnv, json = false) {
  const headers = new Headers({ apikey: env.SUPABASE_SERVICE_ROLE_KEY!, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` });
  if (json) headers.set("content-type", "application/json");
  return headers;
}

function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function handleDevAuthApi(request: Request, pathname: string, env: DevAuthEnv): Promise<Response | null> {
  if (pathname !== "/api/testing/auto-login" && pathname !== "/api/testing/enter") return null;
  if (env.DEV_AUTO_LOGIN !== "true") return privateJson({ error: "Testing auto-login is disabled" }, 404);
  if (!env.DEV_AUTO_LOGIN_TOKEN) return privateJson({ error: "Testing access is not configured" }, 503);

  if (pathname === "/api/testing/enter") {
    if (request.method !== "GET") return privateJson({ error: "Method not allowed" }, 405);
    const url = new URL(request.url);
    if (url.searchParams.get("token") !== env.DEV_AUTO_LOGIN_TOKEN) return privateJson({ error: "Invalid testing access link" }, 403);
    const secure = url.protocol === "https:" ? "; Secure" : "";
    return new Response(null, {
      status: 302,
      headers: {
        location: "/projects",
        "cache-control": "no-store",
        "set-cookie": `researchops_test_access=${encodeURIComponent(env.DEV_AUTO_LOGIN_TOKEN)}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=28800`,
      },
    });
  }

  if (request.method !== "POST") return privateJson({ error: "Method not allowed" }, 405);
  const cookies = request.headers.get("cookie") ?? "";
  const authorized = cookies.split(";").some((part) => {
    const [name, ...value] = part.trim().split("=");
    return name === "researchops_test_access" && value.join("=") === env.DEV_AUTO_LOGIN_TOKEN;
  });
  if (!authorized) return privateJson({ error: "Testing access is required" }, 403);
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) return privateJson({ error: "Testing auto-login is not configured" }, 503);

  try {
    const membersResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/organization_members?select=user_id,role&role=eq.OWNER&limit=1`, { headers: serviceHeaders(env) });
    if (!membersResponse.ok) throw new Error("Owner lookup failed");
    const members = await membersResponse.json() as Array<{ user_id: string }>;
    const ownerId = members[0]?.user_id;
    if (!ownerId) return privateJson({ error: "No workspace owner is available" }, 503);

    const usersResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, { headers: serviceHeaders(env) });
    if (!usersResponse.ok) throw new Error("Auth user lookup failed");
    const users = await usersResponse.json() as { users?: Array<{ id: string; email?: string }> };
    const owner = users.users?.find((user) => user.id === ownerId);
    if (!owner?.email) return privateJson({ error: "The workspace owner has no login email" }, 503);

    const linkResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST", headers: serviceHeaders(env, true), body: JSON.stringify({ type: "magiclink", email: owner.email }),
    });
    if (!linkResponse.ok) throw new Error("Session link creation failed");
    const link = await linkResponse.json() as { hashed_token?: string };
    if (!link.hashed_token) throw new Error("Session token was not created");

    const verifyResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
      method: "POST",
      headers: new Headers({ apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" }),
      body: JSON.stringify({ type: "magiclink", token_hash: link.hashed_token }),
    });
    if (!verifyResponse.ok) throw new Error("Session verification failed");
    const session = await verifyResponse.json() as { access_token?: string; refresh_token?: string };
    if (!session.access_token || !session.refresh_token) throw new Error("Session response was incomplete");
    return privateJson({ access_token: session.access_token, refresh_token: session.refresh_token });
  } catch {
    return privateJson({ error: "Testing auto-login failed" }, 502);
  }
}
