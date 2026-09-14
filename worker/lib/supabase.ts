export type SupabaseEnv = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
};

export class SupabaseRequestError extends Error {
  status: number;
  code?: string;
  detail?: string;

  constructor(status: number, code?: string, detail?: string) {
    super(detail ? `Supabase request failed with ${status}: ${detail}` : `Supabase request failed with ${status}`);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export function isSupabaseConfigured(env: SupabaseEnv) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

function supabaseHeaders(env: SupabaseEnv, authorization: string, extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("apikey", env.SUPABASE_ANON_KEY!);
  headers.set("authorization", authorization);
  headers.set("content-type", "application/json");
  return headers;
}

export async function requireSupabaseUser(request: Request, env: SupabaseEnv) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: supabaseHeaders(env, authorization),
  });
  const authenticated = response.ok;
  // The endpoint is used only as a token validity check. Explicitly release
  // its body so repeated authorized API calls do not exhaust upstream sockets.
  await response.arrayBuffer();
  return authenticated ? authorization : null;
}

export async function supabaseJson<T>(env: SupabaseEnv, path: string, authorization: string, init?: RequestInit): Promise<T> {
  const response = await supabaseRequest(env, path, authorization, init);
  return response.json() as Promise<T>;
}

export async function supabaseRequest(env: SupabaseEnv, path: string, authorization: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: supabaseHeaders(env, authorization, init?.headers),
  });
  if (!response.ok) {
    const body = await response.clone().json().catch(() => null) as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown } | null;
    const code = typeof body?.code === "string" ? body.code.slice(0, 40) : undefined;
    const detail = [body?.message, body?.details, body?.hint].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    throw new SupabaseRequestError(response.status, code, detail?.slice(0, 300));
  }
  return response;
}
