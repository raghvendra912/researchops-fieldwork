// GET/PUT /api/clients/:clientId/return-signing (OWNER/ADMIN only)
//
// Kept separate from the clients directory endpoints so a deployment that has not yet applied
// migration 055 cannot break the Clients page. The signing secret itself never passes through
// this API: the client record only names the Worker env var that holds it.

import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { SupabaseRequestError, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import { isValidClientSecretEnvName, parseSignedReturnPolicy } from "../domain/client-signing";

type ClientRow = { id: string; redirect_token: string; signing_secret_env: string | null; signed_return_policy: string };

function shape(row: ClientRow, request: Request, env: Record<string, unknown>) {
  const name = row.signing_secret_env;
  const secret = isValidClientSecretEnvName(name) ? env[name] : undefined;
  return {
    signingSecretEnv: name ?? "",
    signedReturnPolicy: row.signed_return_policy,
    secretConfigured: typeof secret === "string" && secret.length >= 16,
    postbackUrl: `${new URL(request.url).origin}/api/postbacks/${row.redirect_token}`,
  };
}

function failure(error: unknown) {
  if (error instanceof SupabaseRequestError) {
    if (error.status === 400 && /signing_secret_env|signed_return_policy/.test(error.detail ?? "")) return Response.json({ error: "Apply migration 055 before configuring signed returns" }, { status: 501 });
    if (error.code === "23514") return Response.json({ error: "A secret variable is required to enable HOLD or REJECT" }, { status: 400 });
    if (error.status === 401 || error.status === 403) return Response.json({ error: "Your workspace role does not allow this action" }, { status: 403 });
  }
  return Response.json({ error: "The client signing service is unavailable" }, { status: 502 });
}

export async function handleClientSigningApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/clients\/([0-9a-f-]{36})\/return-signing$/i);
  if (!match) return null;
  if (request.method !== "GET" && request.method !== "PUT") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const authorized = await authorizeWorkspace(request, env, workspacePermissions.administer);
  if (!authorized.ok) return authorizationError(authorized);
  const runtimeEnv = env as unknown as Record<string, unknown>;
  const path = `/rest/v1/clients?id=eq.${match[1]}&organization_id=eq.${authorized.membership.organization_id}&select=id,redirect_token,signing_secret_env,signed_return_policy`;
  try {
    if (request.method === "GET") {
      const rows = await supabaseJson<ClientRow[]>(env, path, authorized.authorization);
      return rows[0] ? Response.json({ data: shape(rows[0], request, runtimeEnv) }, { headers: { "cache-control": "private, no-store" } }) : Response.json({ error: "Client not found" }, { status: 404 });
    }
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const policy = parseSignedReturnPolicy(body?.signedReturnPolicy);
    const rawName = typeof body?.signingSecretEnv === "string" ? body.signingSecretEnv.trim() : "";
    if (!policy) return Response.json({ error: "signedReturnPolicy must be OFF, HOLD or REJECT" }, { status: 400 });
    if (rawName && !isValidClientSecretEnvName(rawName)) return Response.json({ error: "signingSecretEnv must look like CLIENT_<NAME>_SECRET" }, { status: 400 });
    if (policy !== "OFF" && !rawName) return Response.json({ error: "A signingSecretEnv is required for HOLD or REJECT" }, { status: 400 });
    const rows = await supabaseJson<ClientRow[]>(env, path, authorized.authorization, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ signing_secret_env: rawName || null, signed_return_policy: policy }),
    });
    return rows[0] ? Response.json({ data: shape(rows[0], request, runtimeEnv) }) : Response.json({ error: "Client not found" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
