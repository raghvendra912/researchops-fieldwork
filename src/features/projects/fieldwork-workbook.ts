import { strToU8, zipSync } from "fflate";
import type { Project } from "./project.types";

export type FieldworkSpecification = {
  projectCode: string;
  liveSurveyUrl: string;
  testSurveyUrl: string;
  surveyParameters: Array<{ name: string; value: string }>;
  markets: Array<{ countryCode: string; languageCode: string; targetQuota: number; expectedLoiMinutes: number; expectedIr: number }>;
  suppliers: Array<{ supplierName: string; supplierProjectId: string; supplierCpi: number; targetQuota: number; status: string; redirectMode?: string; testLink?: string; liveLink?: string }>;
  eligibilityRules: Array<{ variableKey: string; operator: string; values: string[]; required: boolean; active: boolean; sortOrder?: number }>;
  quotaCells: Array<{ name: string; targetQuota: number; priority: number; active: boolean; conditions: unknown; completes?: number; reserved?: number; remaining?: number }>;
};

export type FieldworkSession = {
  id: string;
  respondentRef: string;
  status: string;
  isTest?: boolean;
  startedAt: string;
  reachedClientAt?: string;
  completedAt?: string;
  durationSeconds?: number | null;
  projectCode?: string;
  projectName?: string;
  projectStatus?: string;
  clientName?: string;
  countryCode?: string;
  languageCode?: string;
  supplierName?: string;
  supplierProjectId?: string;
  supplierCpi?: number;
  providerTransactionId?: string;
  terminationReasonCode?: string;
  terminationReasonSource?: string;
  deviceType?: string;
  riskStatus?: string;
  riskFlagCount?: number;
  internalApprovalStatus?: string;
  vendorApprovalStatus?: string;
  variables?: Array<{ key: string; value: string; source?: string; capturedAt?: string }>;
};

type Cell = string | number | boolean | null | undefined;
type Sheet = { name: string; rows: Cell[][]; widths?: number[] };

function safeText(value: unknown) {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function xml(value: unknown) {
  return safeText(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function worksheet(sheet: Sheet) {
  const maxColumns = Math.max(1, ...sheet.rows.map((row) => row.length));
  const widths = Array.from({ length: maxColumns }, (_, index) => Math.min(48, Math.max(10, sheet.widths?.[index] ?? Math.max(...sheet.rows.slice(0, 100).map((row) => safeText(row[index]).length + 2)))));
  const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${rowIndex === 0 ? 1 : 0}"><v>${value}</v></c>`;
    if (typeof value === "boolean") return `<c r="${reference}" s="${rowIndex === 0 ? 1 : 0}" t="b"><v>${value ? 1 : 0}</v></c>`;
    return `<c r="${reference}" s="${rowIndex === 0 ? 1 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const last = `${columnName(maxColumns - 1)}${Math.max(1, sheet.rows.length)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}

function workbookFiles(sheets: Sheet[]) {
  const timestamp = new Date().toISOString();
  const sheetEntries = sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const relationships = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>ResearchOps</dc:creator><cp:lastModifiedBy>ResearchOps</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created></cp:coreProperties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEntries}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF087761"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheet(sheet)); });
  return files;
}

function projectSummary(projects: Project[], specifications: Map<string, FieldworkSpecification>): Cell[][] {
  const header = ["Project ID", "Project", "Client", "Client PO", "Type", "Category", "Manager", "Status", "Created at (UTC)", "Start date", "End date", "Primary market", "Target completes", "Client CPI", "Expected LOI minutes", "Expected IR %", "Live starts", "Reached client", "Completes", "Terminates", "Over quota", "Quality terminates", "IR %", "Conversion %", "Test starts", "Test completes", "Test terminates", "Test quota full", "Test quality terminates", "Average duration seconds", "Live survey URL", "Test survey URL"];
  return [header, ...projects.map((project) => {
    const spec = specifications.get(project.id); const market = spec?.markets[0];
    return [project.id, project.name, project.client, project.clientPo, project.type, project.category, project.manager, project.status, project.createdAt, project.startDate, project.endDate, project.market, project.quota, project.cpi, market?.expectedLoiMinutes, market?.expectedIr, project.starts, project.reached, project.completes, project.terminates, project.overQuota, project.qualityTerm, project.incidenceRate, project.conversionRate, project.testStarts, project.testCompletes, project.testTerminates, project.testOverQuota, project.testQualityTerm, project.averageDurationSeconds, spec?.liveSurveyUrl, spec?.testSurveyUrl];
  })];
}

export function buildFieldworkWorkbook(projects: Project[], specs: FieldworkSpecification[], sessions: FieldworkSession[]) {
  const byProject = new Map(specs.map((spec) => [spec.projectCode, spec]));
  const surveyLogs: Cell[][] = [["Session ID", "Respondent reference", "Project ID", "Project", "Client", "Country", "Language", "Project status", "Traffic", "Final status", "Started at (UTC)", "Reached client at (UTC)", "Terminal at (UTC)", "Duration seconds", "Duration", "Supplier", "Supplier project ID", "Supplier CPI", "Provider transaction ID", "Termination reason", "Reason source", "Device type", "Risk status", "Risk flag count", "Internal approval", "Vendor approval"], ...sessions.map((session) => [session.id, session.respondentRef, session.projectCode, session.projectName, session.clientName, session.countryCode, session.languageCode, session.projectStatus, session.isTest ? "TEST" : "LIVE", session.status, session.startedAt, session.reachedClientAt, session.completedAt, session.durationSeconds, session.durationSeconds == null ? "" : `${Math.floor(session.durationSeconds / 60)}m ${session.durationSeconds % 60}s`, session.supplierName, session.supplierProjectId, session.supplierCpi, session.providerTransactionId, session.terminationReasonCode, session.terminationReasonSource, session.deviceType ?? "UNKNOWN", session.riskStatus ?? "CLEAR", session.riskFlagCount ?? 0, session.internalApprovalStatus ?? "NOT_REVIEWED", session.vendorApprovalStatus ?? "NOT_REVIEWED"] )];
  const screenConditions: Cell[][] = [["Project ID", "Variable key", "Operator", "Values", "Required", "Active", "Sort order"]];
  const quotaTable: Cell[][] = [["Project ID", "Quota cell", "Conditions", "Target", "Reserved", "Completed", "Remaining", "Priority", "Active"]];
  const vendorLinks: Cell[][] = [["Project ID", "Supplier", "Supplier project ID", "Supplier CPI", "Target quota", "Assignment status", "Redirect mode", "Test link", "Live link/template"]];
  const responseVariables: Cell[][] = [["Session ID", "Respondent reference", "Project ID", "Variable key", "Value", "Source", "Captured at (UTC)"]];
  for (const spec of specs) {
    spec.eligibilityRules.forEach((rule, index) => screenConditions.push([spec.projectCode, rule.variableKey, rule.operator, rule.values.join(" | "), rule.required, rule.active, rule.sortOrder ?? index]));
    spec.quotaCells.forEach((cell) => quotaTable.push([spec.projectCode, cell.name, JSON.stringify(cell.conditions ?? []), cell.targetQuota, cell.reserved, cell.completes, cell.remaining ?? Math.max(0, cell.targetQuota - (cell.reserved ?? 0) - (cell.completes ?? 0)), cell.priority, cell.active]));
    spec.suppliers.forEach((supplier) => vendorLinks.push([spec.projectCode, supplier.supplierName, supplier.supplierProjectId, supplier.supplierCpi, supplier.targetQuota, supplier.status, supplier.redirectMode, supplier.testLink, supplier.liveLink]));
  }
  sessions.forEach((session) => session.variables?.forEach((variable) => responseVariables.push([session.id, session.respondentRef, session.projectCode, variable.key, variable.value, variable.source, variable.capturedAt])));
  const sheets: Sheet[] = [
    { name: "Project Summary", rows: projectSummary(projects, byProject) },
    { name: "Survey Logs", rows: surveyLogs },
    { name: "Screen Conditions", rows: screenConditions },
    { name: "Quota Table", rows: quotaTable },
    { name: "Vendor Survey Links", rows: vendorLinks },
    { name: "Response Variables", rows: responseVariables },
  ];
  return zipSync(workbookFiles(sheets), { level: 6 });
}
