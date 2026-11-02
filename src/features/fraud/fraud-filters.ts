// Pure helpers shared by the Fraud review page and GET /api/fraud-flags.
// Every filter value is checked against a whitelist or a strict pattern before it can reach a PostgREST query.

import { holdingRuleCodes } from "../clients/return-signing.ts";

export const filterableRuleCodes = ["SPEEDING", "UNVERIFIED_RETURN", "NO_CLIENT_REACH", "DUPLICATE_IP", "DUPLICATE_DEVICE", "QUALITY_VIOLATION", "HOSTING_ASN"] as const;
export const filterableStatuses = ["OPEN", "CONFIRMED", "DISMISSED"] as const;

export type FraudFilters = { ruleCodes: string[]; statuses: string[]; projectCode: string };

const projectCodePattern = /^[A-Za-z0-9_-]{1,40}$/;

function tokens(values: string[]): string[] {
  return values.flatMap((value) => String(value ?? "").split(",")).map((token) => token.trim().toUpperCase()).filter(Boolean);
}

/** Keeps only whitelisted tokens; unknown or malicious tokens are dropped, order and duplicates are normalised. */
export function parseFraudFilters(params: URLSearchParams): FraudFilters {
  const ruleCodes = [...new Set(tokens(params.getAll("ruleCode")).filter((code) => (filterableRuleCodes as readonly string[]).includes(code)))];
  const statuses = [...new Set(tokens(params.getAll("status")).filter((status) => (filterableStatuses as readonly string[]).includes(status)))];
  const rawProject = (params.get("projectCode") ?? "").trim();
  const projectCode = projectCodePattern.test(rawProject) ? rawProject.toUpperCase() : "";
  return { ruleCodes, statuses, projectCode };
}

const baseColumns = "id,rule_code,severity,status,evidence,created_at";

/** Builds the PostgREST path for the flag list. With no filters it is the original query. */
export function buildFraudFlagsPath(filters: FraudFilters): string {
  const inner = filters.projectCode ? "!inner" : "";
  const parts = [`select=${baseColumns},survey_sessions${inner}(respondent_ref,project_suppliers(suppliers(name)),projects${inner}(project_code,project_name))`];
  if (filters.ruleCodes.length) parts.push(`rule_code=in.(${filters.ruleCodes.join(",")})`);
  if (filters.statuses.length) parts.push(`status=in.(${filters.statuses.join(",")})`);
  if (filters.projectCode) parts.push(`survey_sessions.projects.project_code=eq.${encodeURIComponent(filters.projectCode)}`);
  parts.push("order=created_at.desc", "limit=100");
  return `/rest/v1/fraud_flags?${parts.join("&")}`;
}

/** Query string for the browser to send; mirrors parseFraudFilters. */
export function fraudFiltersToQuery(filters: FraudFilters): string {
  const params = new URLSearchParams();
  if (filters.ruleCodes.length) params.set("ruleCode", filters.ruleCodes.join(","));
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.projectCode) params.set("projectCode", filters.projectCode);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function isHoldingRule(code: string): boolean {
  return holdingRuleCodes.includes(code);
}

export const heldQueueFilters: FraudFilters = { ruleCodes: [...holdingRuleCodes], statuses: ["OPEN"], projectCode: "" };

const safeEvidenceKeys = ["durationSeconds", "minimumSeconds", "reason", "matched", "reported"];

/** Only evidence fields that are safe to show: never hashes, addresses or unknown keys. */
export function safeEvidence(evidence: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return out;
  for (const key of safeEvidenceKeys) {
    const value = (evidence as Record<string, unknown>)[key];
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string") out[key] = value.slice(0, 200);
  }
  return out;
}

const evidenceLabels: Record<string, string> = { durationSeconds: "Finished in (s)", minimumSeconds: "Minimum (s)", reason: "Reason", matched: "Matched", reported: "Reported by client platform" };

export function evidenceSummary(evidence: unknown): string {
  return Object.entries(safeEvidence(evidence)).map(([key, value]) => `${evidenceLabels[key] ?? key}: ${typeof value === "boolean" ? (value ? "yes" : "no") : value}`).join(" · ");
}

/** Plain-language age such as "5 min", "3 h", "2 days". */
export function heldAge(createdAt: string | undefined, now: number = Date.now()): string {
  const started = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(started)) return "Unknown";
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}
