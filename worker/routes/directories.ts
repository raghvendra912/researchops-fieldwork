import { authorizationError, authorizeWorkspace, workspacePermissions, type WorkspaceRole } from "../lib/authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";

type DirectoryKind = "clients" | "suppliers";
type Status = "ACTIVE" | "INACTIVE";
type RedirectMode = "STATIC" | "DYNAMIC";
type DirectoryAccess = { canOperate: boolean; canAdminister: boolean };
type RedirectVariable = { name: string; source: "URL_PARAM" | "SYSTEM" | "DATABASE_FIELD"; defaultValue: string; required: boolean };

const emptyRedirects = { completeUrl: "", terminateUrl: "", quotaFullUrl: "", securityTerminateUrl: "" };
const defaultRedirectVariables: RedirectVariable[] = [
  { name: "respondent_id", source: "URL_PARAM", defaultValue: "", required: true },
];
const demoClients = [
  { id: "client-northstar", name: "Northstar Bank", code: "NORTHSTAR", status: "ACTIVE" as const, projectCount: 2, contactName: "Research team", address: "Mumbai", contactEmail: "research@northstar.example", phone: "+91 00000 00000", redirectVariables: defaultRedirectVariables },
  { id: "client-arc", name: "Arc Technologies", code: "ARC", status: "ACTIVE" as const, projectCount: 1, contactName: "", address: "", contactEmail: "", phone: "", redirectVariables: defaultRedirectVariables },
  { id: "client-halo", name: "Halo Consumer", code: "HALO", status: "ACTIVE" as const, projectCount: 1, contactName: "", address: "", contactEmail: "", phone: "", redirectVariables: defaultRedirectVariables },
  { id: "client-aperture", name: "Aperture Auto", code: "APERTURE", status: "ACTIVE" as const, projectCount: 1, contactName: "", address: "", contactEmail: "", phone: "", redirectVariables: defaultRedirectVariables },
];
const demoSuppliers = [
  { id: "supplier-cpx", name: "CPX Research", code: "CPX", status: "ACTIVE" as const, projectCount: 3, contactName: "Supply team", address: "Remote", contactEmail: "supply@cpx.example", phone: "+1 000 000 0000", redirectMode: "STATIC" as const, redirects: emptyRedirects },
  { id: "supplier-bitlabs", name: "BitLabs", code: "BITLABS", status: "ACTIVE" as const, projectCount: 2, contactName: "", address: "", contactEmail: "", phone: "", redirectMode: "DYNAMIC" as const, redirects: emptyRedirects },
  { id: "supplier-purespectrum", name: "PureSpectrum", code: "PURE", status: "ACTIVE" as const, projectCount: 2, contactName: "", address: "", contactEmail: "", phone: "", redirectMode: "STATIC" as const, redirects: emptyRedirects },
];

function safeCode(value: unknown) { const code = String(value ?? "").trim().toUpperCase(); return /^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code) ? code : ""; }
function safeName(value: unknown) { const name = String(value ?? "").trim(); return name.length >= 2 && name.length <= 100 ? name : ""; }
function safeOptional(value: unknown, maximum: number) { const text = String(value ?? "").trim(); return text.slice(0, maximum); }
function safeStatus(value: unknown): Status | "" { return value === "ACTIVE" || value === "INACTIVE" ? value : ""; }
function safeMode(value: unknown): RedirectMode | "" { return value === "STATIC" || value === "DYNAMIC" ? value : ""; }
function safeEmail(value: unknown) { const email = safeOptional(value, 254); return !email ? null : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined; }
function safeUrl(value: unknown) { const url = safeOptional(value, 2048); return !url ? null : /^https?:\/\//i.test(url) ? url : undefined; }
function relationCount(value: unknown) { if (!Array.isArray(value)) return 0; const count = (value[0] as { count?: unknown } | undefined)?.count; return Number(count ?? 0); }

function generatedLinks(kind: DirectoryKind, token: unknown, request: Request, allowed: boolean) {
  if (!allowed || !token) return undefined;
  const origin = new URL(request.url).origin;
  const base = `${origin}/r/${kind === "clients" ? "client" : "supplier"}/${token}`;
  return kind === "clients"
    ? { complete: `${base}/complete?rid={{respondent_id}}`, terminate: `${base}/terminate?rid={{respondent_id}}`, quotaFull: `${base}/quota-full?rid={{respondent_id}}`, securityTerminate: `${base}/security-terminate?rid={{respondent_id}}` }
    : { test: `${base}/test`, live: `${base}/live` };
}

function mapRecord(kind: DirectoryKind, row: Record<string, unknown>, request: Request, access: DirectoryAccess) {
  const linksAllowed = kind === "clients" ? access.canAdminister : access.canOperate;
  return {
    id: String(row.id), name: String(row.name), code: String(row.code ?? ""), status: String(row.status) as Status,
    projectCount: relationCount(kind === "clients" ? row.projects : row.project_suppliers),
    contactName: String(row.contact_name ?? ""), address: String(row.address ?? ""), contactEmail: String(row.contact_email ?? ""), phone: String(row.phone ?? ""),
    ...(kind === "suppliers" ? { redirectMode: String(row.redirect_mode ?? "STATIC") as RedirectMode, redirects: { completeUrl: String(row.complete_url ?? ""), terminateUrl: String(row.terminate_url ?? ""), quotaFullUrl: String(row.quota_full_url ?? ""), securityTerminateUrl: String(row.security_terminate_url ?? "") } } : {}),
    ...(kind === "clients" ? { redirectVariables: Array.isArray(row.redirect_variables) ? row.redirect_variables : defaultRedirectVariables } : {}),
    links: generatedLinks(kind, row.redirect_token, request, linksAllowed),
  };
}

function directoryMatch(pathname: string) { const match = pathname.match(/^\/api\/(clients|suppliers)(?:\/([^/]+))?$/); return match ? { kind: match[1] as DirectoryKind, id: match[2] ? decodeURIComponent(match[2]) : "" } : null; }
function accessFor(kind: DirectoryKind, role: WorkspaceRole): DirectoryAccess { return { canOperate: kind === "clients" ? workspacePermissions.administer.includes(role as "OWNER" | "ADMIN") : workspacePermissions.operate.includes(role as "OWNER" | "ADMIN" | "PM"), canAdminister: workspacePermissions.administer.includes(role as "OWNER" | "ADMIN") }; }

function parsePayload(kind: DirectoryKind, body: Record<string, unknown> | null, partial = false) {
  const result: Record<string, unknown> = {};
  if (!partial || body?.name !== undefined) { const name = safeName(body?.name); if (!name) return null; result.name = name; }
  if (!partial || body?.code !== undefined) { const code = safeCode(body?.code); if (!code) return null; result.code = code; }
  if (body?.status !== undefined) { const status = safeStatus(body.status); if (!status) return null; result.status = status; }
  const simpleFields = [["contactName", "contact_name", 100], ["address", "address", 500], ["phone", "phone", 40]] as const;
  for (const [input, output, maximum] of simpleFields) if (!partial || body?.[input] !== undefined) result[output] = safeOptional(body?.[input], maximum);
  if (!partial || body?.contactEmail !== undefined) { const email = safeEmail(body?.contactEmail); if (email === undefined) return null; result.contact_email = email; }
  if (kind === "suppliers" && (!partial || body?.redirectMode !== undefined)) { const mode = safeMode(body?.redirectMode ?? "STATIC"); if (!mode) return null; result.redirect_mode = mode; }
  if (kind === "suppliers") {
    const redirects = (body?.redirects ?? {}) as Record<string, unknown>;
    for (const [input, output] of [["completeUrl", "complete_url"], ["terminateUrl", "terminate_url"], ["quotaFullUrl", "quota_full_url"], ["securityTerminateUrl", "security_terminate_url"]] as const) {
      if (!partial || redirects[input] !== undefined) { const url = safeUrl(redirects[input]); if (url === undefined) return null; result[output] = url; }
    }
  }
  if (kind === "clients" && body?.redirectVariables !== undefined) {
    const variables = parseRedirectVariables(body.redirectVariables);
    if (!variables) return null;
    result.redirect_variables = variables;
  }
  return result;
}

function parseRedirectVariables(value: unknown): RedirectVariable[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const names = new Set<string>(); const result: RedirectVariable[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const input = item as Record<string, unknown>; const name = String(input.name ?? "").trim(); const source = String(input.source ?? ""); const defaultValue = String(input.defaultValue ?? "").trim().slice(0, 200);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(name) || names.has(name) || !["URL_PARAM", "SYSTEM", "DATABASE_FIELD"].includes(source) || typeof input.required !== "boolean") return null;
    names.add(name); result.push({ name, source: source as RedirectVariable["source"], defaultValue, required: input.required });
  }
  return result;
}

export async function handleDirectoriesApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const route = directoryMatch(pathname); if (!route) return null;
  if (!isSupabaseConfigured(env)) {
    const records = route.kind === "clients" ? demoClients : demoSuppliers;
    const access = { canOperate: true, canAdminister: true };
    if (request.method === "GET" && !route.id) return Response.json({ data: records.map((row) => ({ ...row, links: generatedLinks(route.kind, row.id, request, true) })), meta: { total: records.length, source: "mock", ...access } });
    if (request.method === "POST" && !route.id) { const body = await request.json().catch(() => null) as Record<string, unknown> | null; const payload = parsePayload(route.kind, body); if (!payload) return Response.json({ error: "Valid directory and redirect details are required" }, { status: 400 }); const row = { id: `${route.kind.slice(0, -1)}-${Date.now()}`, ...payload, status: "ACTIVE", redirect_token: crypto.randomUUID() }; return Response.json({ data: mapRecord(route.kind, row, request, access), meta: { source: "mock" } }, { status: 201 }); }
    if (request.method === "PATCH" && route.id) { const body = await request.json().catch(() => null) as Record<string, unknown> | null; const payload = parsePayload(route.kind, body, true); if (!payload || !Object.keys(payload).length) return Response.json({ error: "No valid changes were supplied" }, { status: 400 }); return Response.json({ data: mapRecord(route.kind, { id: route.id, name: payload.name ?? "Updated record", code: payload.code ?? "UPDATED", status: payload.status ?? "ACTIVE", ...payload, redirect_token: route.id }, request, access), meta: { source: "mock" } }); }
    return null;
  }

  const permission = request.method === "GET" ? workspacePermissions.read : route.kind === "clients" ? workspacePermissions.administer : workspacePermissions.operate;
  const authorized = await authorizeWorkspace(request, env, permission); if (!authorized.ok) return authorizationError(authorized);
  const access = accessFor(route.kind, authorized.membership.role);
  try {
    if (request.method === "GET" && !route.id) {
      const relation = route.kind === "clients" ? "projects(count)" : "project_suppliers(count)";
      const kindFields = route.kind === "suppliers" ? ",redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url" : ",redirect_variables";
      const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/${route.kind}?select=id,name,code,status,contact_name,address,contact_email,phone${kindFields},redirect_token,${relation}&order=name`, authorized.authorization);
      return Response.json({ data: rows.map((row) => mapRecord(route.kind, row, request, access)), meta: { total: rows.length, source: "supabase", ...access } }, { headers: { "cache-control": "private, no-store" } });
    }
    if (request.method === "POST" && !route.id) {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null; const payload = parsePayload(route.kind, body); if (!payload) return Response.json({ error: "Valid directory and redirect details are required" }, { status: 400 });
      const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/${route.kind}?select=*`, authorized.authorization, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ organization_id: authorized.membership.organization_id, ...payload, status: "ACTIVE" }) });
      return Response.json({ data: mapRecord(route.kind, rows[0], request, access), meta: { source: "supabase" } }, { status: 201 });
    }
    if (request.method === "PATCH" && route.id && /^[0-9a-f-]{36}$/i.test(route.id)) {
      const body = await request.json().catch(() => null) as Record<string, unknown> | null; const payload = parsePayload(route.kind, body, true); if (!payload || !Object.keys(payload).length) return Response.json({ error: "No valid changes were supplied" }, { status: 400 });
      const rows = await supabaseJson<Record<string, unknown>[]>(env, `/rest/v1/${route.kind}?id=eq.${route.id}&organization_id=eq.${authorized.membership.organization_id}&select=*`, authorized.authorization, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) });
      if (!rows[0]) return Response.json({ error: "Record not found" }, { status: 404 });
      return Response.json({ data: mapRecord(route.kind, rows[0], request, access), meta: { source: "supabase" } });
    }
  } catch { return Response.json({ error: `The ${route.kind} database request failed` }, { status: 502 }); }
  return null;
}
