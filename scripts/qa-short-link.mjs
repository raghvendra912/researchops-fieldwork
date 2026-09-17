// Verifies the industry-style short supplier route (/s/<code>) on the hosted app.
// Run: node scripts/qa-short-link.mjs
const ORIGIN = process.env.QA_ORIGIN || "https://www.asrv.co.in";
async function discoverAnonKey() {
  if (process.env.QA_ANON_KEY) return process.env.QA_ANON_KEY;
  const page = await (await fetch(`${ORIGIN}/login`)).text();
  const chunks = [...new Set([...page.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]))];
  for (const c of chunks) {
    const t = await (await fetch(`${ORIGIN}${c}`)).text();
    const m = t.match(/eyJhbGciOi[A-Za-z0-9._-]{40,}/);
    if (m) return m[0];
  }
  throw new Error("anon key not found in client bundle");
}
const anonKey = await discoverAnonKey();
const run = Date.now();
let cookie = "";
async function api(path, { method = "GET", body, auth } = {}) {
  const headers = { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${auth || anonKey}`, "x-requested-with": "XMLHttpRequest" };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text: text.slice(0, 250) };
}
let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  if (ok) pass += 1;
  else fail += 1;
}

const email = `qa-short-${run}@example.com`, password = "QaProbe!2026x";
let r = null;
for (let attempt = 0; attempt < 4; attempt++) {
  r = await api("/supabase/auth/v1/signup", { method: "POST", body: { email, password } });
  if (r.status < 400) break;
  await new Promise((ok) => setTimeout(ok, 15000 * (attempt + 1)));
}
const access = r.json?.access_token || r.json?.data?.access_token;
if (!access) { console.log("NO SESSION — stop", r.status); process.exit(1); }
console.log("signup:", r.status);
console.log("org-create:", (await api("/api/organizations", { method: "POST", auth: access, body: { name: `QA Short ${run}` } })).status);
const supplierR = await api("/api/suppliers", { method: "POST", auth: access, body: { name: `QA Short Supplier ${run}`, code: `QSS${run}`, redirectMode: "DYNAMIC", contactName: "QA", redirects: { completeUrl: "https://supplier.example.test/complete?rid={{respondent_id}}", terminateUrl: "https://supplier.example.test/terminate", quotaFullUrl: "https://supplier.example.test/quota", securityTerminateUrl: "https://supplier.example.test/security" } } });
const supplier = supplierR.json?.data || supplierR.json;
console.log("supplier:", supplierR.status);
const clientR = await api("/api/clients", { method: "POST", auth: access, body: { name: `QA Short Client ${run}`, code: `QSC${run}`, contactName: "QA", contactEmail: `qa-${run}@example.test`, redirects: { completeUrl: "https://client.example.test/complete", terminateUrl: "https://client.example.test/terminate", quotaFullUrl: "https://client.example.test/quota", securityTerminateUrl: "https://client.example.test/security" } } });
console.log("client:", clientR.status);
const projectR = await api("/api/projects", { method: "POST", auth: access, body: { projectName: `QA Short ${run}`, client: `QA Short Client ${run}`, clientCpi: 10, quota: 50, countryCode: "IN", languageCode: "en", loi: 10, incidence: 50, surveyUrl: "https://survey.example.test/live", testSurveyUrl: "https://survey.example.test/test", supplierAssignments: [], surveyParameters: [{ name: "RID", value: "{{respondent_id}}" }] } });
const project = projectR.json?.data || projectR.json;
console.log("project:", projectR.status, project?.id);
if (projectR.status >= 400) console.log("project body:", projectR.text);
if (!project?.id || !supplier?.id) { console.log("MISSING ids — stop", !!project?.id, !!supplier?.id); process.exit(1); }
console.log("assign:", (await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { method: "PUT", auth: access, body: { assignments: [{ supplierId: supplier.id, supplierCpi: 5, targetQuota: 50, status: "ACTIVE" }] } })).status);
const linksR = await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { auth: access });
const links = linksR.json?.data?.[0] || {};
console.log("transition-LIVE:", (await api(`/api/projects/${encodeURIComponent(project.id)}/transitions`, { method: "POST", auth: access, body: { status: "LIVE" } })).status);
console.log("project code:", project.id, "\ntestLink:", links.testLink, "\nliveLink:", links.liveLink, "\nshortLink:", links.shortLink || "(not returned)");
const longToken = (links.liveLink || "").match(/\/r\/supplier\/([^/]+)\//)?.[1] || "";
const code = longToken.slice(0, 8);
check("links payload carries shortLink", Boolean(links.shortLink), links.shortLink || "(missing)");
const short = await fetch(`${ORIGIN}/s/${code}?project=${project.id}&respondent=QA-SHORT-1`, { redirect: "manual" });
const loc = short.headers.get("location") || "";
check("GET /s/<code> returns 302", short.status === 302, String(short.status));
check("short route lands on live survey URL", loc.startsWith("https://survey.example.test/live"), loc.slice(0, 70));
check("survey URL carries session rid", /rid=[0-9a-f-]{36}/.test(loc), (loc.match(/rid=[0-9a-f-]{36}/) || [""])[0]);
for (const key of ["complete_url", "terminate_url", "quota_full_url", "security_terminate_url"]) check(`survey URL carries ${key}`, loc.includes(key));
const testHit = await fetch(`${ORIGIN}/s/${code}/test?project=${project.id}&respondent=QA-SHORT-TEST-1`, { redirect: "manual" });
check("GET /s/<code>/test returns 302", testHit.status === 302, String(testHit.status));
check("test mode lands on test survey URL", (testHit.headers.get("location") || "").startsWith("https://survey.example.test/test"));
const rid = (loc.match(/rid=([0-9a-f-]{36})/) || [])[1] || "";
const outcome = await fetch(`${ORIGIN}/r/outcome/${code}/C?rid=${rid}&project=${project.id}`, { redirect: "manual" });
const outcomeText = (await outcome.text()).slice(0, 160);
check("status alias C resolves (302 or fix hint)", outcome.status === 302 || outcomeText.includes("fix"), `${outcome.status} ${outcomeText.slice(0, 80)}`);
const backCompat = await fetch(`${ORIGIN}/r/supplier/${longToken}/live?project=${project.id}&respondent=QA-SHORT-BC`, { redirect: "manual" });
check("back-compat full-uuid route still 302", backCompat.status === 302, String(backCompat.status));
console.log(`\nSHORT-LINK ${pass} pass / ${fail} fail | run ${run} | code ${code}`);
process.exit(fail ? 1 : 0);