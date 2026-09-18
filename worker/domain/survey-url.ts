export type SurveyParameter = { name: string; value: string };

export type SurveyUrlContext = Record<string, string>;

// Screenshot-style industry split: the per-entry transaction id ([TOID],
// our ResearchOps session UUID) stays separate from the permanent panelist
// id ([unique_id], the supplier's original respondent reference). `rid`
// follows the client-return contract and also resolves to the session UUID,
// so every client posting rid back maps to exactly one survey attempt.
export const TRANSACTION_PLACEHOLDER = "{{transaction_id}}";
export const RESPONDENT_PLACEHOLDER = "{{respondent_id}}";
export const SESSION_PLACEHOLDER = "{{session_id}}";
export const PROJECT_PLACEHOLDER = "{{project_id}}";

const ALIAS_CONTEXT: Record<string, string[]> = {
  project_id: ["project_id", "project_code", "project", "pid", "sur", "svid", "sid", "tid", "survey_id"],
  transaction_id: ["transaction_id", "toid", "session_id", "session_uuid", "attempt_id", "researchops_id", "rid"],
  respondent_id: ["respondent_id", "respondent", "respondent_ref", "unique_id", "userid", "user_id", "r_id", "uid"],
};

function interpolate(template: string, context: SurveyUrlContext) {
  return template.replace(/\{\{([a-z][a-z0-9_]*)\}\}|\{?\[(TOID|UNIQUE_ID|#SCID#|RID)\]\}?/gi, (whole, key: string | undefined, alias: string | undefined) => {
    const lookup = (key ?? alias ?? "").toLowerCase().replace(/^#+|#+$/g, "");
    if (lookup === "toid" || lookup === "scid" || lookup === "rid") return context.transaction_id ?? context.session_id ?? "";
    if (lookup === "unique_id") return context.respondent_id ?? "";
    for (const [canonical, aliases] of Object.entries(ALIAS_CONTEXT)) {
      if (canonical === lookup || aliases.includes(lookup)) return context[canonical] ?? context[lookup] ?? "";
    }
    return context[lookup] ?? "";
  });
}

export function previewSurveyUrl(template: string, parameters: SurveyParameter[], forTest = false) {
  const sample: SurveyUrlContext = forTest
    ? { project_id: "ROP-TEST", transaction_id: "ROP-TEST-TOID-1", respondent_id: "ROP-TEST-USER-1", session_id: "ROP-TEST-TOID-1" }
    : { project_id: "ROP-123", transaction_id: "TOID-SAMPLE-1", respondent_id: "USER-SAMPLE-1", session_id: "TOID-SAMPLE-1" };
  try {
    return buildSurveyUrl(template, parameters, sample).toString();
  } catch {
    return "";
  }
}

export function buildSurveyUrl(template: string, parameters: SurveyParameter[], context: SurveyUrlContext) {
  const target = new URL(interpolate(template, context));
  for (const parameter of parameters) target.searchParams.set(parameter.name, interpolate(parameter.value, context));
  return target;
}
