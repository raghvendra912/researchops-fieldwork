// Advisory network-risk signal: traffic arriving from well-known hosting/cloud ASNs is
// rarely a real panelist. This never blocks; it only tags the START event so the fraud
// pipeline can raise a MEDIUM, non-billing-affecting flag.

export const NETWORK_RISK_HOSTING_ASN = "HOSTING_ASN";

/** Well-known cloud providers: AWS, Google, Microsoft, DigitalOcean, OVH, Hetzner, Linode/Akamai. */
export const BUILT_IN_HOSTING_ASNS: readonly number[] = [16509, 14618, 15169, 396982, 8075, 14061, 16276, 24940, 63949];

/** Parses a comma-separated ASN list ("AS123, 456"); ignores anything that is not a positive integer. */
export function parseAsnList(value: string | undefined | null): number[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim().replace(/^AS/i, "")).filter((part) => /^\d{1,10}$/.test(part)).map(Number).filter((n) => n > 0);
}

export function hostingAsnSet(extra?: string | null): Set<number> {
  return new Set([...BUILT_IN_HOSTING_ASNS, ...parseAsnList(extra)]);
}

export function readAsn(request: Request): number | undefined {
  const asn = (request as Request & { cf?: { asn?: number | string } }).cf?.asn;
  const parsed = typeof asn === "string" ? Number(asn) : asn;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Returns context metadata to merge into a START event; empty for test traffic or non-hosting ASNs. */
export function networkRiskContext(request: Request, env: { NETWORK_RISK_ASNS?: string }, isTest: boolean): { networkRisk?: string; asn?: string } {
  if (isTest) return {};
  const asn = readAsn(request);
  if (asn === undefined || !hostingAsnSet(env.NETWORK_RISK_ASNS).has(asn)) return {};
  return { networkRisk: NETWORK_RISK_HOSTING_ASN, asn: String(asn) };
}
