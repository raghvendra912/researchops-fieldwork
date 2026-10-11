import assert from "node:assert/strict";
import test from "node:test";
import { buildRespondentReportCsv, respondentReportFilename } from "../src/features/projects/respondent-report.ts";

test("respondent CSV follows the reference operational report and protects raw IP", () => {
  const csv = buildRespondentReportCsv([{ id: "session-1", respondentRef: "vendor-1", projectCode: "INV23246", projectName: "Innovate", clientName: "INV", supplierName: "Prime Sample", supplierCpi: 5, clientCpi: 11, digitalFingerprinting: true, providerTransactionId: "original-1", status: "COMPLETE", deviceType: "WINDOWS", browserType: "CHROME", geoCity: "London", startedAt: "2026-10-07T12:50:01Z", completedAt: "2026-10-07T12:53:33Z", durationSeconds: 212, riskStatus: "CLEAR", riskFlagCount: 0 }]);
  assert.match(csv, /^\uFEFF"S.No","Project Name","Client","Client Name","Supplier Name","CPI","Survey Cost","Digital Fingerprinting","Quality Check","Global Sample ID","Vendor Respondent ID","Vendor Original ID","Survey Status","IP Address","Device Type","Browser Type","City","Start Date","Start Time","End Date","End Time","LOI"/);
  assert.match(csv, /"ON","Pass","session-1","vendor-1","original-1","Complete","Protected","WINDOWS","CHROME","London","2026-10-07","12:50:01","2026-10-07","12:53:33","00:03:32"/);
  assert.doesNotMatch(csv, /ipHash|deviceHash|203\.0\.113/);
  assert.equal(respondentReportFilename(new Date("2026-10-07T13:53:37Z")), "Survey-Respondents-Report-20261007135337.csv");
});
