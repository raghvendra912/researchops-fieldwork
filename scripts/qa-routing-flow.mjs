import { readFileSync } from "node:fs";
const anonKey = readFileSync("anon-key.txt", "utf8").trim();
const ORIGIN = "https://www.asrv.co.in";
const run = Date.now();
let cookie = "";
async function api(path, { method = "GET", body, auth } = {}) {
  const headers = { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${auth || anonKey}`, "x-requested-with": "XMLHttpRequest" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text: text.slice(0, 250) };
}
function log(label, r) { console.log(`${label}: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : r.text.slice(0, 140)}`); return r; }

const email = `qa-routing-${run}@example.com`, password = "QaProbe!2026x";
let r = await api("/api/auth/signup", { method: "POST", body: { email, password } });
log("signup-proxy", r);
if (r.status >= 400) { r = await api("/supabase/auth/v1/signup", { method: "POST", body: { email, password } }); log("signup-supabase", r); }
const access = r.json?.access_token || r.json?.data?.access_token;
if (!access) { console.log("NO SESSION — stop"); process.exit(1); }
r = await api("/api/organizations", { method: "POST", auth: access, body: { name: `QA Routing ${run}` } }); log("org-create", r);
const clientR = await api("/api/clients", { method: "POST", auth: access, body: { name: `QA Client ${run}`, code: `QC${run}`, contactName: "QA", contactEmail: `qa-${run}@example.test`, redirects: { completeUrl: "https://client.example.test/complete", terminateUrl: "https://client.example.test/terminate", quotaFullUrl: "https://client.example.test/quota", securityTerminateUrl: "https://client.example.test/security" } } }); log("client", clientR);
const supplierR = await api("/api/suppliers", { method: "POST", auth: access, body: { name: `QA Supplier ${run}`, code: `QS${run}`, redirectMode: "DYNAMIC", contactName: "QA", redirects: { completeUrl: "https://supplier.example.test/complete?rid={{respondent_id}}", terminateUrl: "https://supplier.example.test/terminate", quotaFullUrl: "https://supplier.example.test/quota", securityTerminateUrl: "https://supplier.example.test/security" } } }); log("supplier", supplierR);
const supplier = supplierR.json?.data || supplierR.json;
const projectR = await api("/api/projects", { method: "POST", auth: access, body: { projectName: `QA Routing ${run}`, client: `QA Client ${run}`, clientCpi: 10, quota: 50, countryCode: "IN", languageCode: "en", loi: 10, incidence: 50, surveyUrl: "https://survey.example.test/live", testSurveyUrl: "https://survey.example.test/test", supplierAssignments: [], surveyParameters: [{ name: "RID", value: "{{respondent_id}}" }] } }); log("project", projectR);
const project = projectR.json?.data || projectR.json;
if (!project?.id || !supplier?.id) { console.log("MISSING ids — stop", !!project?.id, !!supplier?.id); process.exit(1); }
const assignR = await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { method: "PUT", auth: access, body: { assignments: [{ supplierId: supplier.id, supplierCpi: 5, targetQuota: 50, status: "ACTIVE" }] } }); log("assign", assignR);
const linksR = await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { auth: access }); log("assign-links", linksR);
const links = linksR.json?.data?.[0] || {};
console.log("testLink:", links.testLink, "\nliveLink:", links.liveLink);
for (const t of ["LIVE"]) { const tr = await api(`/api/projects/${encodeURIComponent(project.id)}/transitions`, { method: "POST", auth: access, body: { status: t } }); log(`transition-${t}`, tr); }
// Routing end-to-end
const supTok = (links.liveLink || "").match(/\/r\/supplier\/([^/]+)\//)?.[1];
const supUrl = `${ORIGIN}/r/supplier/${supTok}/live?project=${project.id}&respondent=QA-SUP-REF-1`;
console.log("token:", supTok, "| hit:", supUrl);
const live = await fetch(supUrl, { redirect: "manual" });
console.log("SUPPLIER LIVE:", live.status, live.headers.get("location"));
const loc = live.headers.get("location") || "https://x/?rid=norid";
const rid = new URL(loc).searchParams.get("rid") || new URL(loc).searchParams.get("RID");
console.log("session rid:", rid);
if (rid) {
  const clientsList = await api("/api/clients", { auth: access });
  const myClient = (clientsList.json?.data || []).find((c) => c.name === `QA Client ${run}`) || {};
  console.log("client keys:", Object.keys(myClient).join(","));
  const clink = myClient.links?.complete || "";
  const ctok = clink.match(/\/r\/client\/([^/]+)\//)?.[1] || "";
  console.log("client token:", ctok || "(MISSING from links)");
  const back = await fetch(`${ORIGIN}/r/client/${ctok}/complete?rid=${rid}&project=${project.id}`, { redirect: "manual" });
  console.log("CLIENT BACK:", back.status, back.headers.get("location"));
  const after = await api(`/api/respondents?project=${encodeURIComponent(project.id)}`, { auth: access });
  const row = (after.json?.data || [])[0] || {};
  console.log("session after complete:", JSON.stringify({ status: row.status, completedAt: row.completedAt, durationSeconds: row.durationSeconds, ref: row.respondentRef }));
  const ocMatch = loc.match(/complete_url=([^&]+)/);
  if (ocMatch) {
    const outcomeUrl = decodeURIComponent(ocMatch[1]);
    const replay = await fetch(outcomeUrl, { redirect: "manual" });
    console.log("OUTCOME complete (replay):", replay.status, replay.headers.get("location"));
  }
}
console.log("\nDONE run", run);
