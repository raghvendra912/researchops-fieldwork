export type ProviderName = "cpx" | "bitlabs" | "purespectrum";
export type NormalizedEvent = { organizationId: string; projectCode: string; supplierId?: string; respondentRef: string; eventType: string; providerTransactionId?: string; occurredAt?: string; metadata?: Record<string, unknown> };
export interface ProviderAdapter {
  name: ProviderName;
  buildLaunchUrl(input: { baseUrl: string; respondentRef: string; projectCode: string; supplierProjectId?: string }): string;
  parseTestCallback(input: Record<string, unknown>): NormalizedEvent | null;
}
