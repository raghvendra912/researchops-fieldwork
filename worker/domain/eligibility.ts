export type EligibilityOperator = "EQ" | "NE" | "IN" | "NOT_IN" | "GTE" | "LTE" | "BETWEEN";
export type EligibilityRule = { id?: string; variableKey: string; operator: EligibilityOperator; values: string[]; required: boolean; active?: boolean };
export type EligibilityResult = { eligible: boolean; evaluated: number; reason?: string; failedRule?: string };

function normalized(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function finite(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }

export function evaluateEligibility(rules: EligibilityRule[], answers: Record<string, string | undefined>): EligibilityResult {
  const input = new Map(Object.entries(answers).map(([key, value]) => [key.trim().toLowerCase(), value?.trim()]));
  const active = rules.filter((rule) => rule.active !== false);
  for (const rule of active) {
    const key = rule.variableKey.trim().toLowerCase();
    const actual = input.get(key);
    if (!actual) {
      if (rule.required) return { eligible: false, evaluated: active.length, reason: `Missing required eligibility value: ${key}`, failedRule: key };
      continue;
    }
    const expected = rule.values.map(normalized).filter(Boolean);
    const text = normalized(actual);
    let passed = false;
    if (rule.operator === "EQ") passed = text === expected[0];
    if (rule.operator === "NE") passed = text !== expected[0];
    if (rule.operator === "IN") passed = expected.includes(text);
    if (rule.operator === "NOT_IN") passed = !expected.includes(text);
    if (rule.operator === "GTE") { const left = finite(actual); const right = finite(rule.values[0]); passed = left !== null && right !== null && left >= right; }
    if (rule.operator === "LTE") { const left = finite(actual); const right = finite(rule.values[0]); passed = left !== null && right !== null && left <= right; }
    if (rule.operator === "BETWEEN") { const value = finite(actual); const minimum = finite(rule.values[0]); const maximum = finite(rule.values[1]); passed = value !== null && minimum !== null && maximum !== null && value >= minimum && value <= maximum; }
    if (!passed) return { eligible: false, evaluated: active.length, reason: `Eligibility criterion not met: ${key}`, failedRule: key };
  }
  return { eligible: true, evaluated: active.length };
}

export function eligibilityAnswers(params: URLSearchParams) {
  const reserved = new Set(["project", "respondent", "mode", "device", "outcome"]);
  return Object.fromEntries([...params.entries()].filter(([key]) => !reserved.has(key.toLowerCase())).map(([key, value]) => [key.toLowerCase(), value]));
}
