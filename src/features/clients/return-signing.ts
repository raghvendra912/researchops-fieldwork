// Pure helpers for the client "Return signing" settings and the Fraud review wording.

export type SignedReturnPolicy = "OFF" | "HOLD" | "REJECT";

const secretNamePattern = /^CLIENT_[A-Z0-9_]{1,40}_SECRET$/;

export function isValidSecretName(name: string): boolean {
  return secretNamePattern.test(name);
}

export const policyOptions: { value: SignedReturnPolicy; label: string; help: string }[] = [
  { value: "OFF", label: "Off", help: "Accept any valid return link. No signature is checked." },
  { value: "HOLD", label: "Hold unsigned", help: "Accept unsigned completes but hold them for review. They do not count as valid until an operator resolves them." },
  { value: "REJECT", label: "Reject unsigned", help: "Refuse any return that does not carry a valid signature." },
];

/** Returns a calm validation message, or "" when the form can be saved. */
export function validateSigning(policy: SignedReturnPolicy, name: string): string {
  const trimmed = name.trim();
  if (trimmed && !isValidSecretName(trimmed)) return "Use a name like CLIENT_ACME_SECRET: capital letters, digits and underscores only.";
  if (policy !== "OFF" && !trimmed) return "Enter the secret variable name before turning on Hold or Reject.";
  return "";
}

export function signingErrorMessage(status: number | undefined): string {
  if (status === 501) return "Return signing is not available yet because a database update is still pending. Ask an administrator to finish the latest database update.";
  if (status === 403) return "Your role does not allow changing return signing.";
  if (status === 400) return "These settings were not accepted. Check the policy and the variable name.";
  return "Return signing settings could not be loaded or saved right now. Please try again shortly.";
}

const fraudLabels: Record<string, { label: string; explain: string; holds?: boolean }> = {
  SPEEDING: { label: "Speeding", explain: "Finished faster than the minimum plausible time.", holds: true },
  DUPLICATE_IP: { label: "Duplicate IP", explain: "Same network address as an earlier respondent in this project." },
  DUPLICATE_DEVICE: { label: "Duplicate device", explain: "Same device fingerprint as an earlier respondent in this project." },
  QUALITY_VIOLATION: { label: "Quality violation", explain: "The survey platform reported a data-quality problem." },
  DUPLICATE: { label: "Duplicate", explain: "Matches an earlier respondent or attempt." },
  UNVERIFIED_RETURN: { label: "Unverified return", explain: "Complete arrived without the client's signature.", holds: true },
  NO_CLIENT_REACH: { label: "No client hand-off", explain: "Complete without a recorded hand-off to the client.", holds: true },
  HOSTING_ASN: { label: "Hosting network", explain: "Entered from a data-centre or hosting network. Advisory only; it does not remove the complete." },
};

/** Rules that keep a complete out of valid delivery, cost and quota while the flag is OPEN (migrations 047/055). */
export const holdingRuleCodes = ["SPEEDING", "UNVERIFIED_RETURN", "NO_CLIENT_REACH"];

export function humanizeRuleCode(code: string): string {
  const text = String(code ?? "").toLowerCase().replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown rule";
}

export function fraudRuleInfo(code: string): { label: string; explain: string; holds: boolean } {
  const known = Object.hasOwn(fraudLabels, code) ? fraudLabels[code] : undefined;
  return known ? { label: known.label, explain: known.explain, holds: known.holds === true } : { label: humanizeRuleCode(code), explain: "", holds: false };
}
