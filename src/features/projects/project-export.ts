import type { Project } from "./project.types";

export type ProjectRoutingInfo = {
  liveSurveyUrl: string;
  testSurveyUrl: string;
  suppliers: Array<{
    supplierName: string;
    supplierProjectId: string;
    status: string;
    testLink: string;
    liveLink: string;
  }>;
};

// Routing columns are derived from the live Project Center response, so every
// new project automatically carries its tool-generated supplier links in CSV.
export function projectRoutingColumns(project: Project): Array<[string, string]> {
  const routing = project as Project & { routing?: ProjectRoutingInfo };
  const suppliers = (routing.supplierAssignments ?? []) as Array<Partial<ProjectRoutingInfo["suppliers"][number]>>;
  const liveLinks = suppliers.map((item) => item.liveLink ?? "").filter(Boolean);
  const testLinks = suppliers.map((item) => item.testLink ?? "").filter(Boolean);
  return [
    ["Routing test links", testLinks.join(" | ")],
    ["Routing live links", liveLinks.join(" | ")],
    ["Routing supplier names", suppliers.map((item) => item.supplierName).join(" | ")],
    ["Routing supplier statuses", suppliers.map((item) => `${item.supplierName}:${item.status}`).join(" | ")],
  ];
}

const columns: Array<[string, (project: Project) => string | number]> = [
  ["Project ID", (project) => project.id],
  ["Project", (project) => project.name],
  ["Client", (project) => project.client],
  ["Client code", (project) => project.clientCode ?? ""],
  ["Market", (project) => project.market],
  ["Type", (project) => project.type],
  ["Manager", (project) => project.manager],
  ["Secondary PM", (project) => project.secondaryManager ?? ""],
  ["Sales Person", (project) => project.salesPerson ?? ""],
  ["Status", (project) => project.status],
  ["Created at", (project) => project.createdAt ?? ""],
  ["Last updated at", (project) => project.updatedAt ?? ""],
  ["Start date", (project) => project.startDate ?? ""],
  ["End date", (project) => project.endDate ?? ""],
  ["Client PO", (project) => project.clientPo],
  ["Starts", (project) => project.starts],
  ["Reached client", (project) => project.reached],
  ["Last 24h completes", (project) => project.l24],
  ["Completes", (project) => project.completes],
  ["Terminates", (project) => project.terminates],
  ["Over quota", (project) => project.overQuota],
  ["Quality terminates", (project) => project.qualityTerm],
  ["Incidence rate", (project) => project.incidenceRate],
  ["Completion rate (CO/ST)", (project) => project.starts ? Math.round(100 * project.completes / project.starts) : 0],
  ["Conversion rate", (project) => project.conversionRate],
  ["Test starts", (project) => project.testStarts ?? 0],
  ["Test completes", (project) => project.testCompletes ?? 0],
  ["Test terminates", (project) => project.testTerminates ?? 0],
  ["Test quota full", (project) => project.testOverQuota ?? 0],
  ["Test quality terminates", (project) => project.testQualityTerm ?? 0],
  ["Client CPI", (project) => project.cpi],
  ["Target completes", (project) => project.quota ?? ""],
  ["Category", (project) => project.category ?? ""],
  ["Live survey URL", (project) => project.surveyUrl ?? ""],
  ["Test survey URL", (project) => project.testSurveyUrl ?? ""],
  ["Survey parameters", (project) => JSON.stringify(project.surveyParameters ?? [])],
  ["Markets", (project) => JSON.stringify(project.markets ?? [])],
  ["Supplier assignments", (project) => JSON.stringify(project.supplierAssignments ?? [])],
  ["Eligibility rules", (project) => JSON.stringify(project.eligibilityRules ?? [])],
  ["Quota cells", (project) => JSON.stringify(project.quotaCells ?? [])],
  ["Routing test links", (project) => projectRoutingColumns(project)[0][1]],
  ["Routing live links", (project) => projectRoutingColumns(project)[1][1]],
  ["Routing supplier names", (project) => projectRoutingColumns(project)[2][1]],
  ["Routing supplier statuses", (project) => projectRoutingColumns(project)[3][1]],
  ["Average duration seconds", (project) => project.averageDurationSeconds ?? ""],
  ["Last event at", (project) => project.lastEventAt ?? ""],
];

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function projectsToCsv(projects: Project[]) {
  const header = columns.map(([label]) => csvCell(label)).join(",");
  const rows = projects.map((project) => columns.map(([, read]) => csvCell(read(project))).join(","));
  return [header, ...rows].join("\r\n");
}
