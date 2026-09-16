import assert from "node:assert/strict";
import test from "node:test";
import { projectsToCsv, projectRoutingColumns } from "../src/features/projects/project-export.ts";
import {
  clientOutcomeTemplates,
  fillLiveTemplate,
  parseClientRoute,
  parseOutcomeRoute,
  parseSupplierRoute,
  readProjectCode,
  readRespondentRef,
  ROUTING_HELP,
  supplierLiveTemplate,
  supplierRoute,
} from "../worker/domain/routing-links.ts";

test("routing link helpers build install-ready templates", () => {
  const live = supplierLiveTemplate("https://router.example", "00000000-0000-4000-8000-000000000001");
  assert.equal(live, "https://router.example/r/supplier/00000000-0000-4000-8000-000000000001/live?project={{project_code}}&respondent={{respondent_id}}");
  assert.equal(supplierRoute("https://router.example/", "00000000-0000-4000-8000-000000000001", "test"), "https://router.example/r/supplier/00000000-0000-4000-8000-000000000001/test");
  assert.equal(
    fillLiveTemplate(live, "ROP-42", "SUP-7"),
    "https://router.example/r/supplier/00000000-0000-4000-8000-000000000001/live?project=ROP-42&respondent=SUP-7",
  );
  const clients = clientOutcomeTemplates("https://router.example", "00000000-0000-4000-8000-000000000002");
  assert.equal(clients.complete, "https://router.example/r/client/00000000-0000-4000-8000-000000000002/complete?rid={{respondent_id}}");
});

test("routing parser accepts flexible vendor parameter names", () => {
  assert.deepEqual(parseSupplierRoute("/r/supplier/00000000-0000-4000-8000-000000000001/live"), { token: "00000000-0000-4000-8000-000000000001", mode: "live" });
  assert.deepEqual(parseClientRoute("/r/client/00000000-0000-4000-8000-000000000002/quota-full"), { token: "00000000-0000-4000-8000-000000000002", outcome: "quota-full" });
  assert.deepEqual(parseOutcomeRoute("/r/outcome/00000000-0000-4000-8000-000000000003/complete"), { token: "00000000-0000-4000-8000-000000000003", outcome: "complete" });
  assert.equal(parseSupplierRoute("/r/supplier/not-a-token/live"), null);

  const launch = new URLSearchParams({ project_id: "rop-42", transaction_id: "SUP-7" });
  assert.equal(readProjectCode(launch), "ROP-42");
  assert.equal(readRespondentRef(launch), "SUP-7");
  const surveyReturn = new URLSearchParams({ respondent: "  SUP 7!! ", project: "ROP-42" });
  assert.equal(readRespondentRef(surveyReturn), "SUP7");
});

test("every new project carries tool routing info in CSV", () => {
  const project = {
    id: "ROP-1", name: "test", client: "Client", clientPo: "", market: "India", type: "B2C",
    manager: "Owner", status: "LIVE", starts: 0, reached: 0, l24: 0, completes: 0, terminates: 0,
    overQuota: 0, qualityTerm: 0, abandonRate: 0, incidenceRate: 0, conversionRate: 0, cpi: 1,
    lastComplete: "Not started",
    supplierAssignments: [{ supplierName: "CPX", supplierProjectId: "CPX-1", supplierCpi: 1, targetQuota: 10, status: "ACTIVE", testLink: "https://router.example/r/supplier/token/live?project=ROP-1&respondent=x&mode=test", liveLink: "https://router.example/r/supplier/token/live?project=ROP-1&respondent={{respondent_id}}" }],
  };
  const routing = projectRoutingColumns(project);
  assert.match(routing[1][1], /\/r\/supplier\/token\/live\?project=ROP-1/);
  const csv = projectsToCsv([project]);
  assert.match(csv, /Routing live links/);
  assert.match(csv, /\/r\/supplier\/token\/live/);
  assert.equal(ROUTING_HELP.newProjectChecklist.length, 8);
});
