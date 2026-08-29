import type { Project } from "./project.types";

const columns: Array<[string, (project: Project) => string | number]> = [
  ["Project ID", (project) => project.id],
  ["Project", (project) => project.name],
  ["Client", (project) => project.client],
  ["Market", (project) => project.market],
  ["Type", (project) => project.type],
  ["Manager", (project) => project.manager],
  ["Status", (project) => project.status],
  ["Starts", (project) => project.starts],
  ["Reached client", (project) => project.reached],
  ["Last 24h completes", (project) => project.l24],
  ["Completes", (project) => project.completes],
  ["Terminates", (project) => project.terminates],
  ["Over quota", (project) => project.overQuota],
  ["Quality terminates", (project) => project.qualityTerm],
  ["Incidence rate", (project) => project.incidenceRate],
  ["Conversion rate", (project) => project.conversionRate],
  ["Client CPI", (project) => project.cpi],
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
