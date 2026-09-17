export type RoutingOutcome = "complete" | "terminate" | "quota-full" | "security-terminate";

export const ROUTING_OUTCOMES: RoutingOutcome[] = ["complete", "terminate", "quota-full", "security-terminate"];

const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRoutingToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value.trim());
}

export function supplierRoute(origin: string, token: string, mode: "test" | "live") {
  return `${origin.replace(/\/$/, "")}/r/supplier/${token}/${mode}`;
}

export function supplierLiveTemplate(origin: string, token: string, projectCode = "{{project_code}}") {
  return `${supplierRoute(origin, token, "live")}?project=${projectCode}&respondent={{respondent_id}}`;
}

export function clientOutcomeTemplate(origin: string, token: string, outcome: RoutingOutcome) {
  return `${origin.replace(/\/$/, "")}/r/client/${token}/${outcome}?rid={{respondent_id}}`;
}

export function clientOutcomeTemplates(origin: string, token: string) {
  return {
    complete: clientOutcomeTemplate(origin, token, "complete"),
    terminate: clientOutcomeTemplate(origin, token, "terminate"),
    quotaFull: clientOutcomeTemplate(origin, token, "quota-full"),
    securityTerminate: clientOutcomeTemplate(origin, token, "security-terminate"),
  };
}

export function outcomeRouteFromSession(origin: string, outcomeToken: string, outcome: RoutingOutcome) {
  return `${origin.replace(/\/$/, "")}/r/outcome/${outcomeToken}/${outcome}`;
}

export type ParsedSupplierRoute = { token: string; mode: "test" | "live" };
export type ParsedClientRoute = { token: string; outcome: RoutingOutcome };
export type ParsedOutcomeRoute = { token: string; outcome: RoutingOutcome };

export function parseSupplierRoute(pathname: string): ParsedSupplierRoute | null {
  const match = pathname.match(/^\/r\/supplier\/([0-9a-f-]{36})\/(test|live)$/i);
  if (!match || !isRoutingToken(match[1])) return null;
  return { token: match[1], mode: match[2].toLowerCase() as "test" | "live" };
}

// Industry-style clean short link: /s/<8-hex>/<test> — the readable face for
// Cint/Toluna/Qualtrics-like entry points. The 8 hex chars are the UUID prefix;
// the full supplier token is resolved from the directory before routing.
export function shortSupplierCode(token: string) {
  return token.replace(/-/g, "").slice(0, 8).toLowerCase();
}

export function supplierShortTemplate(origin: string, token: string, projectCode = "{{project_code}}") {
  return `${origin.replace(/\/$/, "")}/s/${shortSupplierCode(token)}?project=${projectCode}&respondent={{respondent_id}}`;
}

export function parseSupplierShortRoute(pathname: string): ParsedSupplierRoute | null {
  const match = pathname.match(/^\/s\/([0-9a-f]{8})(?:\/(test|live))?$/i);
  if (!match) return null;
  return { token: match[1], mode: (match[2]?.toLowerCase() ?? "live") as "test" | "live" };
}

export function shortRouteFromToken(pathname: string) {
  return pathname.replace(/^\/r\/supplier\/([0-9a-f-]{36})/i, (_all, token: string) => `/s/${shortSupplierCode(token)}`);
}

export function parseClientRoute(pathname: string): ParsedClientRoute | null {
  const match = pathname.match(/^\/r\/client\/([0-9a-f-]{36})\/(complete|terminate|quota-full|security-terminate)$/i);
  if (!match || !isRoutingToken(match[1])) return null;
  return { token: match[1], outcome: match[2].toLowerCase() as RoutingOutcome };
}

export function parseOutcomeRoute(pathname: string): ParsedOutcomeRoute | null {
  const match = pathname.match(/^\/r\/outcome\/([0-9a-f-]{36})\/(complete|terminate|quota-full|security-terminate)$/i);
  if (!match || !isRoutingToken(match[1])) return null;
  return { token: match[1], outcome: match[2].toLowerCase() as RoutingOutcome };
}

// Supplier launches accept several common parameter names because vendors
// rarely use one shared contract. Client returns accept the same aliases.
const PROJECT_KEYS = ["project_code", "project_id", "project", "survey_id", "pid", "sur", "SVID", "tid"] as const;
const RESPONDENT_KEYS = ["respondent", "respondent_ref", "respondent_id", "transaction_id", "rid", "uid", "r_id", "userId", "RID"] as const;

// Standard single-letter outcome codes used by Cint, Toluna, CPX, BitLabs and
// Qualtrics-style panels. Numeric codes 1/2/3/4 also appear in legacy feeds.
const OUTCOME_ALIASES: Record<string, RoutingOutcome> = {
  c: "complete", complete: "complete", comp: "complete", "1": "complete", finished: "complete",
  t: "terminate", terminate: "terminate", screenout: "terminate", so: "terminate", "2": "terminate",
  q: "quota-full", quota: "quota-full", "quota-full": "quota-full", quotafull: "quota-full", oq: "quota-full", "3": "quota-full",
  s: "security-terminate", security: "security-terminate", qt: "security-terminate", quality: "security-terminate", "4": "security-terminate",
};

export function readOutcomeCode(params: URLSearchParams, key = "status"): RoutingOutcome | null {
  const raw = (params.get(key) ?? "").trim().toLowerCase();
  return OUTCOME_ALIASES[raw] ?? null;
}

export type VendorPreset = { name: string; projectParam: string; respondentParam: string; outcomeParam: string; completeCode: string; terminateCode: string; quotaFullCode: string; securityTerminateCode: string };

// Launch presets: pick one in the supplier form and the tool maps the
// parameters and return codes automatically.
export const VENDOR_PRESETS: VendorPreset[] = [
  { name: "ResearchOps", projectParam: "project", respondentParam: "respondent", outcomeParam: "status", completeCode: "C", terminateCode: "T", quotaFullCode: "Q", securityTerminateCode: "S" },
  { name: "Cint", projectParam: "sur", respondentParam: "rid", outcomeParam: "status", completeCode: "C", terminateCode: "T", quotaFullCode: "Q", securityTerminateCode: "S" },
  { name: "Toluna", projectParam: "SVID", respondentParam: "RID", outcomeParam: "status", completeCode: "C", terminateCode: "T", quotaFullCode: "Q", securityTerminateCode: "S" },
  { name: "CPX", projectParam: "pid", respondentParam: "r_id", outcomeParam: "status", completeCode: "C", terminateCode: "T", quotaFullCode: "Q", securityTerminateCode: "S" },
  { name: "BitLabs", projectParam: "tid", respondentParam: "userId", outcomeParam: "status", completeCode: "C", terminateCode: "T", quotaFullCode: "Q", securityTerminateCode: "S" },
  { name: "PureSpectrum", projectParam: "sid", respondentParam: "b_id", outcomeParam: "status", completeCode: "10", terminateCode: "20", quotaFullCode: "30", securityTerminateCode: "40" },
];

function firstQueryValue(params: URLSearchParams, keys: readonly string[]) {
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== "") return value;
  }
  return null;
}

export function readProjectCode(params: URLSearchParams, maximum = 40) {
  const raw = firstQueryValue(params, PROJECT_KEYS) ?? "";
  return raw.trim().replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, maximum).toUpperCase();
}

export function readRespondentRef(params: URLSearchParams, maximum = 160) {
  const raw = firstQueryValue(params, RESPONDENT_KEYS) ?? "";
  return raw.trim().replace(/[^A-Za-z0-9_.:@-]/g, "").slice(0, maximum);
}

export function readClientAttemptId(params: URLSearchParams, maximum = 160) {
  return readRespondentRef(params, maximum);
}

function withTemplate(value: string) {
  return value.includes("{{respondent_id}}") ? value : `${value}${value.includes("?") ? "&" : "?"}respondent={{respondent_id}}`;
}

export function fillLiveTemplate(template: string, projectCode: string, respondentRef: string) {
  return withTemplate(template)
    .replaceAll("{{project_code}}", encodeURIComponent(projectCode))
    .replaceAll("{{respondent_id}}", encodeURIComponent(respondentRef));
}

export const ROUTING_HELP = {
  supplierLiveExample: "/r/supplier/<supplier-token>/live?project=ROP-123&respondent=SUPPLIER-UNIQUE-ID",
  supplierTestExample: "/r/supplier/<supplier-token>/test",
  clientExample: "/r/client/<client-token>/complete?rid=<researchops-session-uuid>&project=ROP-123",
  outcomeExample: "/r/outcome/<session-token>/complete",
  newProjectChecklist: [
    "1. Supplier directory: supplier ACTIVE + complete/terminate/quota-full/security-terminate return URLs set.",
    "2. Project details → Supplier delivery: supplier assigned + assignment ACTIVE + save.",
    "3. Project details → Survey routing setup: live survey URL must be https; test URL optional.",
    "4. Project status PENDING → Launch project → LIVE (live routing only works on LIVE).",
    "5. Supplier delivery → Links → Open test (auto ROP-TEST id) and confirm TST increments after Refresh.",
    "6. Supplier delivery → Links → Copy live template; supplier replaces {{respondent_id}} with a unique id per respondent.",
    "7. Client survey returns the ResearchOps session UUID in rid + project code; supplier gets its own ref back.",
    "8. Metrics Refresh (30s auto): ST/RC/CO and TST columns; Project Center CSV/XLSX now carries routing links.",
  ],
} as const;
