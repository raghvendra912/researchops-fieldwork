export type RespondentReportRow = {
  id: string;
  respondentRef: string;
  projectCode?: string;
  projectName?: string;
  clientName?: string;
  supplierName?: string;
  supplierCpi?: number;
  clientCpi?: number;
  digitalFingerprinting?: boolean;
  providerTransactionId?: string;
  status: string;
  deviceType?: string;
  osType?: string;
  browserType?: string;
  ipAddress?: string;
  geoCity?: string;
  startedAt: string;
  completedAt?: string;
  durationSeconds?: number | null;
  riskStatus?: string;
  riskFlagCount?: number;
};

function csvCell(value: unknown) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function dateAndTime(value?: string) {
  if (!value) return ["", ""];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return ["", ""];
  return [date.toISOString().slice(0, 10), date.toISOString().slice(11, 19)];
}

function loi(seconds?: number | null) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "00:00:00";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":");
}

function surveyStatus(status: string) {
  const labels: Record<string, string> = { COMPLETE: "Complete", TERMINATE: "Terminate", QUOTA_FULL: "Quota Full", QUALITY_TERMINATE: "Quality", ABANDON: "Incomplete", STARTED: "Incomplete", REACHED_CLIENT: "Incomplete" };
  return labels[status] ?? status;
}

export function buildRespondentReportCsv(rows: RespondentReportRow[]) {
  const header = ["S.No", "Project Name", "Client", "Client Name", "Supplier Name", "CPI", "Survey Cost", "Digital Fingerprinting", "Quality Check", "Global Sample ID", "Vendor Respondent ID", "Vendor Original ID", "Survey Status", "IP Address", "Device Type", "Browser Type", "City", "Start Date", "Start Time", "End Date", "End Time", "LOI"];
  const data = rows.map((row, index) => {
    const [startDate, startTime] = dateAndTime(row.startedAt);
    const [endDate, endTime] = dateAndTime(row.completedAt);
    const quality = row.riskStatus && row.riskStatus !== "CLEAR" ? row.riskStatus : row.riskFlagCount ? "Review" : "Pass";
    return [index + 1, row.projectCode, row.clientName, row.projectName, row.supplierName ?? "Direct", row.supplierCpi ?? 0, row.clientCpi ?? 0, row.digitalFingerprinting ? "ON" : "OFF", quality, row.id, row.respondentRef, row.providerTransactionId ?? "NA", surveyStatus(row.status), row.ipAddress ?? "", row.osType ?? row.deviceType ?? "UNKNOWN", row.browserType ?? "UNKNOWN", row.geoCity ?? "", startDate, startTime, endDate, endTime, loi(row.durationSeconds)];
  });
  return `\uFEFF${[header, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

export function respondentReportFilename(now = new Date()) {
  return `Survey-Respondents-Report-${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}.csv`;
}
