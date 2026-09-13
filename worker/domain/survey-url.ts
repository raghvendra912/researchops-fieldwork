export type SurveyParameter = { name: string; value: string };

export type SurveyUrlContext = Record<string, string>;

function interpolate(template: string, context: SurveyUrlContext) {
  return template.replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (_, key: string) => context[key.toLowerCase()] ?? "");
}

export function buildSurveyUrl(template: string, parameters: SurveyParameter[], context: SurveyUrlContext) {
  const target = new URL(interpolate(template, context));
  for (const parameter of parameters) target.searchParams.set(parameter.name, interpolate(parameter.value, context));
  return target;
}
