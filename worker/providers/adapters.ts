import type { NormalizedEvent, ProviderAdapter, ProviderName } from "./types";
const dispositions: Record<string, string> = { start: "START", reached: "REACHED_CLIENT", complete: "COMPLETE", terminate: "TERMINATE", quota: "QUOTA_FULL", quality: "QUALITY_TERMINATE", abandon: "ABANDON" };
function adapter(name: ProviderName): ProviderAdapter {
  return { name,
    buildLaunchUrl({ baseUrl, respondentRef, projectCode, supplierProjectId }) { const url = new URL(baseUrl); url.searchParams.set("rid", respondentRef); url.searchParams.set("project", supplierProjectId || projectCode); return url.toString(); },
    parseTestCallback(input) { const eventType = dispositions[String(input.disposition ?? input.status ?? "").toLowerCase()] ?? String(input.eventType ?? "").toUpperCase(); const normalized: NormalizedEvent = { organizationId: String(input.organizationId ?? ""), projectCode: String(input.projectCode ?? "").toUpperCase(), supplierId: input.supplierId ? String(input.supplierId) : undefined, respondentRef: String(input.respondentRef ?? input.rid ?? ""), eventType, providerTransactionId: input.providerTransactionId ? String(input.providerTransactionId) : input.transactionId ? String(input.transactionId) : undefined, occurredAt: input.occurredAt ? String(input.occurredAt) : undefined, metadata: { provider: name } }; return normalized.organizationId && normalized.projectCode && normalized.respondentRef && normalized.eventType ? normalized : null; },
  };
}
export const providerAdapters = { cpx: adapter("cpx"), bitlabs: adapter("bitlabs"), purespectrum: adapter("purespectrum") } satisfies Record<ProviderName, ProviderAdapter>;
