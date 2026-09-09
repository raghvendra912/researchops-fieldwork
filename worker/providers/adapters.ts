import type { NormalizedEvent, ProviderAdapter, ProviderName } from "./types";
const dispositions: Record<string, string> = {
  start: "START", reached: "REACHED_CLIENT", complete: "COMPLETE", completed: "COMPLETE",
  terminate: "TERMINATE", terminated: "TERMINATE", screenout: "TERMINATE",
  quota: "QUOTA_FULL", quota_full: "QUOTA_FULL", quotafull: "QUOTA_FULL",
  quality: "QUALITY_TERMINATE", quality_terminate: "QUALITY_TERMINATE",
  abandon: "ABANDON", abandoned: "ABANDON", cancelled: "ABANDON",
};
const providerDispositions: Partial<Record<ProviderName, Record<string, string>>> = {
  purespectrum: {
    "17": "QUOTA_FULL",
    "18": "TERMINATE",
    "20": "QUALITY_TERMINATE",
    "21": "COMPLETE",
    "29": "QUALITY_TERMINATE",
    "30": "QUALITY_TERMINATE",
  },
};
function adapter(name: ProviderName): ProviderAdapter {
  return { name,
    buildLaunchUrl({ baseUrl, respondentRef, projectCode, supplierProjectId }) { const url = new URL(baseUrl); url.searchParams.set("rid", respondentRef); url.searchParams.set("project", supplierProjectId || projectCode); return url.toString(); },
    parseTestCallback(input) { const rawDisposition = String(input.disposition ?? input.status ?? "").toLowerCase(); const eventType = providerDispositions[name]?.[rawDisposition] ?? dispositions[rawDisposition] ?? String(input.eventType ?? "").toUpperCase(); const normalized: NormalizedEvent = { organizationId: String(input.organizationId ?? ""), projectCode: String(input.projectCode ?? "").toUpperCase(), supplierId: input.supplierId ? String(input.supplierId) : undefined, respondentRef: String(input.respondentRef ?? input.rid ?? ""), eventType, providerTransactionId: input.providerTransactionId ? String(input.providerTransactionId) : input.transactionId ? String(input.transactionId) : undefined, occurredAt: input.occurredAt ? String(input.occurredAt) : undefined, metadata: { provider: name, providerDisposition: rawDisposition } }; return normalized.organizationId && normalized.projectCode && normalized.respondentRef && normalized.eventType ? normalized : null; },
  };
}
export const providerAdapters = { cpx: adapter("cpx"), bitlabs: adapter("bitlabs"), purespectrum: adapter("purespectrum") } satisfies Record<ProviderName, ProviderAdapter>;
