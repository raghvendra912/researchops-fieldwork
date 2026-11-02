// Marketplace supply helpers. These are deliberately pure (no network, no
// database) so inventory parsing, signing, and earnings math are unit-testable.
// Provider-specific contracts (BLK-03) plug in through worker/providers/marketplace.ts.

export type SurveyStatus = "OPEN" | "PAUSED" | "CLOSED";
export type Qualification = { code: string; operator?: string; values: string[] };

/** Snake_case payload accepted by the public.upsert_marketplace_surveys RPC. */
export type SurveyPayload = {
  external_id: string;
  title: string;
  country_code?: string;
  language_code?: string;
  cpi: number;
  currency?: string;
  loi_minutes?: number;
  incidence_pct?: number;
  conversion_pct?: number;
  quota_remaining?: number;
  status: SurveyStatus;
  entry_url?: string;
  qualifications: Qualification[];
  quotas: unknown[];
};

export type InventoryParseResult = { surveys: SurveyPayload[]; errors: string[] };

export const maximumSurveysPerSync = 500;
const secretEnvPattern = /^MARKETPLACE_[A-Z0-9_]{1,40}_SECRET$/;

export function isValidSecretEnvName(name: unknown): name is string {
  return typeof name === "string" && secretEnvPattern.test(name);
}

const aliases = {
  external_id: ["external_id", "survey_id", "id", "study_id", "project_id", "sid"],
  title: ["title", "name", "survey_name", "study_name"],
  country_code: ["country_code", "country", "country_iso"],
  language_code: ["language_code", "language", "lang", "locale"],
  cpi: ["cpi", "price", "payout", "revenue", "cost_per_complete", "reward"],
  currency: ["currency", "currency_code"],
  loi_minutes: ["loi_minutes", "loi", "length", "length_of_interview", "duration"],
  incidence_pct: ["incidence_pct", "incidence", "ir", "incidence_rate"],
  conversion_pct: ["conversion_pct", "conversion", "cr", "conversion_rate", "system_conversion"],
  quota_remaining: ["quota_remaining", "remaining", "quota", "completes_needed", "available_completes"],
  status: ["status", "state"],
  entry_url: ["entry_url", "url", "link", "survey_url", "entry_link"],
  qualifications: ["qualifications", "targeting", "criteria"],
  quotas: ["quotas", "quota_cells"],
} as const;

function pick(raw: Record<string, unknown>, key: keyof typeof aliases): unknown {
  const lookup = new Map(Object.entries(raw).map(([name, value]) => [name.trim().toLowerCase().replace(/[\s-]+/g, "_"), value]));
  for (const alias of aliases[key]) {
    const value = lookup.get(alias);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const cleaned = typeof value === "string" ? value.replace(/[%$,\s]/g, "") : value;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : Number.NaN;
}

function toStatus(value: unknown): SurveyStatus | null {
  if (value === undefined) return "OPEN";
  const text = String(value).trim().toLowerCase();
  if (["open", "live", "active", "available", "running"].includes(text)) return "OPEN";
  if (["paused", "hold", "on_hold", "on hold", "inactive"].includes(text)) return "PAUSED";
  if (["closed", "complete", "completed", "full", "quota_full", "expired", "cancelled", "canceled"].includes(text)) return "CLOSED";
  return null;
}

function toQualifications(value: unknown): Qualification[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const result: Qualification[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const code = String(record.code ?? record.question ?? record.id ?? "").trim();
    const rawValues = record.values ?? record.value ?? record.answers;
    const values = (Array.isArray(rawValues) ? rawValues : rawValues === undefined ? [] : [rawValues]).map((entry) => String(entry).trim()).filter(Boolean);
    if (!code || code.length > 80 || values.length === 0 || values.length > 50) return null;
    const operator = typeof record.operator === "string" ? record.operator.trim().toUpperCase() : undefined;
    result.push({ code, ...(operator ? { operator } : {}), values });
  }
  return result;
}

export function normalizeSurvey(raw: unknown, index: number): { survey?: SurveyPayload; error?: string } {
  const label = `Survey ${index + 1}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: `${label}: expected an object` };
  const record = raw as Record<string, unknown>;
  const externalId = String(pick(record, "external_id") ?? "").trim();
  const title = String(pick(record, "title") ?? "").trim();
  const cpi = toNumber(pick(record, "cpi"));
  if (!externalId || externalId.length > 120) return { error: `${label}: a survey id of 1-120 characters is required` };
  if (!title) return { error: `${label} (${externalId}): a title is required` };
  if (cpi === undefined || !Number.isFinite(cpi) || cpi < 0) return { error: `${label} (${externalId}): CPI must be a non-negative number` };
  const status = toStatus(pick(record, "status"));
  if (!status) return { error: `${label} (${externalId}): unknown status` };
  const qualifications = toQualifications(pick(record, "qualifications"));
  if (!qualifications) return { error: `${label} (${externalId}): qualifications need a code and at least one value` };

  const country = pick(record, "country_code");
  const language = pick(record, "language_code");
  const currency = pick(record, "currency");
  const entryUrl = pick(record, "entry_url");
  const percent = (key: "incidence_pct" | "conversion_pct") => {
    const value = toNumber(pick(record, key));
    return value === undefined ? undefined : value >= 0 && value <= 100 ? value : Number.NaN;
  };
  const loi = toNumber(pick(record, "loi_minutes"));
  const incidence = percent("incidence_pct");
  const conversion = percent("conversion_pct");
  const quota = toNumber(pick(record, "quota_remaining"));
  if (loi !== undefined && !(Number.isFinite(loi) && loi >= 1)) return { error: `${label} (${externalId}): length of interview must be at least 1 minute` };
  if (incidence !== undefined && Number.isNaN(incidence)) return { error: `${label} (${externalId}): incidence must be 0-100` };
  if (conversion !== undefined && Number.isNaN(conversion)) return { error: `${label} (${externalId}): conversion must be 0-100` };
  if (quota !== undefined && !(Number.isFinite(quota) && quota >= 0)) return { error: `${label} (${externalId}): remaining quota must be 0 or more` };
  if (country !== undefined && !/^[A-Za-z]{2}$/.test(String(country).trim())) return { error: `${label} (${externalId}): country must be a 2-letter ISO code` };
  if (language !== undefined && !/^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/.test(String(language).trim())) return { error: `${label} (${externalId}): invalid language code` };
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(String(currency).trim())) return { error: `${label} (${externalId}): currency must be a 3-letter code` };
  if (entryUrl !== undefined && !/^https?:\/\/\S{1,2040}$/.test(String(entryUrl).trim())) return { error: `${label} (${externalId}): entry URL must be an http(s) link` };

  const quotas = pick(record, "quotas");
  return {
    survey: {
      external_id: externalId,
      title: title.slice(0, 300),
      ...(country !== undefined ? { country_code: String(country).trim().toUpperCase() } : {}),
      ...(language !== undefined ? { language_code: String(language).trim().toLowerCase() } : {}),
      cpi,
      ...(currency !== undefined ? { currency: String(currency).trim().toUpperCase() } : {}),
      ...(loi !== undefined ? { loi_minutes: Math.round(loi) } : {}),
      ...(incidence !== undefined ? { incidence_pct: incidence } : {}),
      ...(conversion !== undefined ? { conversion_pct: conversion } : {}),
      ...(quota !== undefined ? { quota_remaining: Math.round(quota) } : {}),
      status,
      ...(entryUrl !== undefined ? { entry_url: String(entryUrl).trim() } : {}),
      qualifications,
      quotas: Array.isArray(quotas) ? quotas : [],
    },
  };
}

/** Parses a marketplace inventory feed: an array, or an object holding one. */
export function parseInventory(payload: unknown): InventoryParseResult {
  const list = Array.isArray(payload) ? payload : typeof payload === "object" && payload !== null
    ? (["surveys", "data", "items", "results", "studies"] as const).map((key) => (payload as Record<string, unknown>)[key]).find(Array.isArray)
    : undefined;
  if (!Array.isArray(list)) return { surveys: [], errors: ["Expected a list of surveys"] };
  if (list.length > maximumSurveysPerSync) return { surveys: [], errors: [`A sync can carry at most ${maximumSurveysPerSync} surveys`] };
  const surveys: SurveyPayload[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  list.forEach((item, index) => {
    const result = normalizeSurvey(item, index);
    if (result.error) { errors.push(result.error); return; }
    const survey = result.survey!;
    if (seen.has(survey.external_id)) { errors.push(`Survey ${index + 1} (${survey.external_id}): duplicate survey id in this feed`); return; }
    seen.add(survey.external_id);
    surveys.push(survey);
  });
  return { surveys, errors };
}

/** Minimal RFC 4180 CSV reader for marketplaces that only export spreadsheets. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = ""; let row: string[] = []; let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip a UTF-8 byte-order mark
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') { if (input[index + 1] === '"') { field += '"'; index += 1; } else quoted = false; }
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  if (rows.length < 2) return [];
  const header = rows[0].map((name) => name.trim());
  return rows.slice(1).map((cells) => Object.fromEntries(header.map((name, position) => [name, (cells[position] ?? "").trim()])));
}

/** CSV cells hold qualification lists as JSON; convert them before normalising. */
export function parseCsvInventory(text: string): InventoryParseResult {
  const rows = parseCsv(text).map((row) => {
    const copy: Record<string, unknown> = { ...row };
    for (const key of ["qualifications", "quotas", "targeting", "criteria", "quota_cells"]) {
      if (typeof copy[key] === "string" && String(copy[key]).trim()) {
        try { copy[key] = JSON.parse(String(copy[key])); } catch { copy[key] = "invalid"; }
      }
    }
    return copy;
  });
  return parseInventory(rows);
}

export type EarningsEstimate = { value: number | null; basis: "conversion" | "incidence-ceiling" | null };

/**
 * Expected revenue per supplier click. System conversion (completes divided by
 * all entrants) is the honest basis; incidence is only an upper bound because it
 * ignores drop-off, so it is labelled as a ceiling.
 */
export function estimateEarningsPerClick(input: { cpi: number; conversionPct?: number | null; incidencePct?: number | null }): EarningsEstimate {
  if (input.conversionPct !== undefined && input.conversionPct !== null) return { value: round(input.cpi * input.conversionPct / 100, 4), basis: "conversion" };
  if (input.incidencePct !== undefined && input.incidencePct !== null) return { value: round(input.cpi * input.incidencePct / 100, 4), basis: "incidence-ceiling" };
  return { value: null, basis: null };
}

export function marginPerComplete(cpi: number, supplierCpi: number) { return round(cpi - supplierCpi, 2); }
export function marginPct(cpi: number, supplierCpi: number) { return cpi > 0 ? round((cpi - supplierCpi) / cpi * 100, 2) : null; }
function round(value: number, places: number) { const factor = 10 ** places; return Math.round(value * factor) / factor; }

function hex(bytes: ArrayBuffer) { return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); }

export type EntrySigningOptions = { param?: string; algorithm?: "SHA-1" | "SHA-256" };

/**
 * Appends an HMAC of the full entry URL as a query parameter. This is the common
 * "signed entry link" scheme; marketplaces with a different recipe override it
 * through their adapter once their contract and sandbox are available (BLK-03).
 */
export async function signEntryUrl(url: string, secret: string, options: EntrySigningOptions = {}) {
  const parameter = options.param && /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(options.param) ? options.param : "hash";
  const target = new URL(url);
  target.searchParams.delete(parameter);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: options.algorithm ?? "SHA-256" }, false, ["sign"]);
  const signature = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(target.toString())));
  target.searchParams.set(parameter, signature);
  return target.toString();
}

export async function verifyEntryUrl(url: string, secret: string, options: EntrySigningOptions = {}) {
  const parameter = options.param && /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(options.param) ? options.param : "hash";
  const supplied = new URL(url).searchParams.get(parameter);
  if (!supplied) return false;
  const expected = new URL(await signEntryUrl(url, secret, options)).searchParams.get(parameter);
  return expected !== null && expected.length === supplied.length && [...expected].every((char, index) => char === supplied[index]);
}

export type ConfirmationAction = { sessionId: string; action: "CONFIRM" | "REVERSE"; reason?: string };
const sessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalises a marketplace confirmation/reversal report. The transaction id the
 * marketplace echoes back is the ResearchOps session UUID we sent as `rid`.
 */
export function parseConfirmations(payload: unknown): { actions: ConfirmationAction[]; errors: string[] } {
  const list = Array.isArray(payload) ? payload : typeof payload === "object" && payload !== null
    ? (["events", "transactions", "completes", "data"] as const).map((key) => (payload as Record<string, unknown>)[key]).find(Array.isArray)
    : undefined;
  if (!Array.isArray(list)) return { actions: [], errors: ["Expected a list of events"] };
  const actions: ConfirmationAction[] = []; const errors: string[] = [];
  list.slice(0, 500).forEach((item, index) => {
    const record = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const sessionId = String(record.session_id ?? record.sessionId ?? record.transaction_id ?? record.transactionId ?? record.rid ?? "").trim();
    const status = String(record.status ?? record.action ?? "").trim().toLowerCase();
    if (!sessionIdPattern.test(sessionId)) { errors.push(`Event ${index + 1}: transaction id is not a ResearchOps session id`); return; }
    if (["confirmed", "approved", "accepted", "paid", "valid"].includes(status)) actions.push({ sessionId: sessionId.toLowerCase(), action: "CONFIRM" });
    else if (["reversed", "rejected", "declined", "chargeback", "fraud", "invalid", "clawback"].includes(status)) actions.push({ sessionId: sessionId.toLowerCase(), action: "REVERSE", reason: String(record.reason ?? record.message ?? status).slice(0, 500) });
    else errors.push(`Event ${index + 1}: unknown status "${status}"`);
  });
  return { actions, errors };
}
