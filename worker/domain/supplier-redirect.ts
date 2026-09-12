function expand(template: string, project: string, respondent: string) {
  return template
    .replaceAll("{{project_id}}", encodeURIComponent(project))
    .replaceAll("{{respondent_id}}", encodeURIComponent(respondent));
}

export function standardSupplierRedirect(template: string, project: string, respondent: string, eventType: string) {
  const target = new URL(expand(template, project, respondent));
  const status = eventType.toLowerCase().replaceAll("_", "-");
  if (!target.searchParams.has("respondent_id")) target.searchParams.set("respondent_id", respondent);
  if (!target.searchParams.has("project_id")) target.searchParams.set("project_id", project);
  if (!target.searchParams.has("transaction_id")) target.searchParams.set("transaction_id", respondent);
  if (!target.searchParams.has("status")) target.searchParams.set("status", status);
  return target.toString();
}
