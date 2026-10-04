const ORIGIN = "https://www.asrv.co.in";
const SURVEY_URL = process.env.QA_SURVEY_URL || "https://survey.example.test/live";
const USE_RESEARCHOPS_OUTCOME_PAGE = process.env.QA_RESEARCHOPS_OUTCOME_PAGE === "1";
const GEO_SECURITY = process.env.QA_GEO_SECURITY === "1";
const COUNTRY_CODE = (process.env.QA_COUNTRY_CODE || "IN").toUpperCase();
// Anon key is public by design (auto-discovered from the deployed app's client bundle).
async function discoverAnonKey() {
  if (process.env.QA_ANON_KEY) return process.env.QA_ANON_KEY;
  const page = await (await fetch(`${ORIGIN}/login`)).text();
  const chunks = [...new Set([...page.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]))];
  for (const c of chunks) {
    const t = await (await fetch(`${ORIGIN}${c}`)).text();
    const m = t.match(/eyJhbGciOi[A-Za-z0-9._-]{40,}/);
    if (m) { console.log("anon key discovered from", c.split("/").pop()); return m[0]; }
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
function log(label, r) { console.log(`${label}: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : r.text.slice(0, 140)}`); return r; }
async function routingDiag(label, res) {
  const body = await res.text();
  const err = body.match(/"error":"([^"]*)"/)?.[1];
  const fix = body.match(/"fix":"([^"]*)"/)?.[1];
  console.log(`${label}: ${res.status}${err ? " error=" + err : ""}${fix ? " fix=" + fix : ""}`);
  return { status: res.status, location: res.headers.get("location"), body };
}

const email = `qa-routing-${run}@example.com`, password = "QaProbe!2026x";
let r = null;
for (let attempt = 0; attempt < 5; attempt++) {
  r = await api("/supabase/auth/v1/signup", { method: "POST", body: { email, password } });
  console.log(`signup attempt ${attempt + 1}:`, r.status);
  if (r.status < 400) break;
  await new Promise((ok) => setTimeout(ok, 20000 * (attempt + 1)));
}
const access = r.json?.access_token || r.json?.data?.access_token;
if (!access) { console.log("NO SESSION — stop"); process.exit(1); }
r = await api("/api/organizations", { method: "POST", auth: access, body: { name: `QA Routing ${run}` } }); log("org-create", r);
const clientR = await api("/api/clients", { method: "POST", auth: access, body: { name: `QA Client ${run}`, code: `QC${run}`, contactName: "QA", contactEmail: `qa-${run}@example.test`, redirects: { completeUrl: "https://client.example.test/complete", terminateUrl: "https://client.example.test/terminate", quotaFullUrl: "https://client.example.test/quota", securityTerminateUrl: "https://client.example.test/security" } } }); log("client", clientR);
const supplierRedirects = USE_RESEARCHOPS_OUTCOME_PAGE
  ? { completeUrl: "", terminateUrl: "", quotaFullUrl: "", securityTerminateUrl: "" }
  : { completeUrl: "https://supplier.example.test/complete?rid={{respondent_id}}", terminateUrl: "https://supplier.example.test/terminate", quotaFullUrl: "https://supplier.example.test/quota", securityTerminateUrl: "https://supplier.example.test/security" };
const supplierR = await api("/api/suppliers", { method: "POST", auth: access, body: { name: `QA Supplier ${run}`, code: `QS${run}`, redirectMode: "DYNAMIC", contactName: "QA", redirects: supplierRedirects } }); log("supplier", supplierR);
const supplier = supplierR.json?.data || supplierR.json;
const projectR = await api("/api/projects", { method: "POST", auth: access, body: { projectName: `QA Routing ${run}`, client: `QA Client ${run}`, clientCpi: 10, quota: 50, countryCode: COUNTRY_CODE, languageCode: "en", loi: 10, incidence: 50, surveyUrl: SURVEY_URL, testSurveyUrl: SURVEY_URL, supplierAssignments: [], surveyParameters: [{ name: "vid", value: "{{transaction_id}}" }], geoSecurityEnabled: GEO_SECURITY } }); log("project", projectR);
const project = projectR.json?.data || projectR.json;
if (!project?.id || !supplier?.id) { console.log("MISSING ids — stop", !!project?.id, !!supplier?.id); process.exit(1); }
const assignR = await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { method: "PUT", auth: access, body: { assignments: [{ supplierId: supplier.id, supplierCpi: 5, targetQuota: 50, status: "ACTIVE" }] } }); log("assign", assignR);
const linksR = await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { auth: access }); log("assign-links", linksR);
const links = linksR.json?.data?.[0] || {};
console.log("testLink:", links.testLink, "\nliveLink:", links.liveLink);
for (const t of ["LIVE"]) { const tr = await api(`/api/projects/${encodeURIComponent(project.id)}/transitions`, { method: "POST", auth: access, body: { status: t, launchConfirmed: true } }); log(`transition-${t}`, tr); }
// Routing end-to-end
const supTok = (links.liveLink || "").match(/\/r\/supplier\/([^/]+)\//)?.[1];
const supUrl = `${ORIGIN}/r/supplier/${supTok}/live?project=${project.id}&respondent=QA-SUP-REF-1`;
console.log("token:", supTok, "| hit:", supUrl);
const live = await fetch(supUrl, { redirect: "manual", headers: GEO_SECURITY ? { "x-vercel-ip-country": COUNTRY_CODE, "x-vercel-ip-country-region": "QA", "x-vercel-ip-city": "GeoMatch" } : undefined });
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
  const backBody = await back.text();
  console.log("CLIENT BACK:", back.status, back.headers.get("location"), backBody.match(/<title>([^<]+)/i)?.[1] || "");
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
if (GEO_SECURITY) {
  const mismatchRef = `QA-GEO-MISMATCH-${run}`;
  const mismatchUrl = `${ORIGIN}/r/supplier/${supTok}/live?project=${project.id}&respondent=${mismatchRef}`;
  const mismatch = await fetch(mismatchUrl, { redirect: "manual", headers: { "x-vercel-ip-country": COUNTRY_CODE === "US" ? "IN" : "US", "x-vercel-ip-country-region": "QA", "x-vercel-ip-city": "GeoMismatch" } });
  console.log("GEO MISMATCH:", mismatch.status, mismatch.headers.get("location"));
  const geoRows = await api(`/api/respondents?project=${encodeURIComponent(project.id)}&export=1`, { auth: access });
  console.log("GEO ROWS:", JSON.stringify((geoRows.json?.data || []).filter((row) => row.respondentRef === "QA-SUP-REF-1" || row.respondentRef === mismatchRef).map((row) => ({ ref: row.respondentRef, status: row.status, country: row.geoCountryCode, region: row.geoRegionCode, city: row.geoCity, geo: row.geoCheckStatus }))));
}
// 039 live equal-ref test: two suppliers, same external ref -> two distinct sessions
const sup2 = await api("/api/suppliers", { method: "POST", auth: access, body: { name: `QA Supplier B ${run}`, code: `QB${run}`, redirectMode: "DYNAMIC", contactName: "QA", redirects: { completeUrl: "https://supplier-b.example.test/complete", terminateUrl: "https://supplier-b.example.test/terminate", quotaFullUrl: "https://supplier-b.example.test/quota", securityTerminateUrl: "https://supplier-b.example.test/security" } } });
const supB = sup2.json?.data || sup2.json;
await api(`/api/projects/${encodeURIComponent(project.id)}/suppliers`, { method: "PUT", auth: access, body: { assignments: [{ supplierId: supplier.id, supplierCpi: 5, targetQuota: 50, status: "ACTIVE" }, { supplierId: supB.id, supplierCpi: 5, targetQuota: 50, status: "ACTIVE" }] } });
const supList = await api("/api/suppliers", { auth: access });
const supAObj = (supList.json?.data || []).find((s) => s.name === `QA Supplier ${run}`) || {};
const supBObj = (supList.json?.data || []).find((s) => s.name === `QA Supplier B ${run}`) || {};
const tokA = JSON.stringify(supAObj.links || "").match(/\/r\/supplier\/([0-9a-f-]{36})\//)?.[1];
const tokB = JSON.stringify(supBObj.links || "").match(/\/r\/supplier\/([0-9a-f-]{36})\//)?.[1];
const hitA = await routingDiag("hitA", await fetch(`${ORIGIN}/r/supplier/${tokA}/live?project=${project.id}&respondent=SAME-REF-777`, { redirect: "manual" }));
const hitB = await routingDiag("hitB", await fetch(`${ORIGIN}/r/supplier/${tokB}/live?project=${project.id}&respondent=SAME-REF-777`, { redirect: "manual" }));
const ridA = new URL(hitA.location || "https://x/?rid=none").searchParams.get("rid");
const ridB = new URL(hitB.location || "https://x/?rid=none").searchParams.get("rid");
console.log("EQUAL-REF 039:", hitA.status, hitB.status, "ridA=", ridA, "ridB=", ridB, "distinct=", ridA !== ridB && !!ridA && !!ridB);
// Frontend pages
for (const p of ["/login", "/projects", "/dashboard"]) {
  const res = await fetch(ORIGIN + p, { redirect: "manual" });
  console.log("PAGE", p, "->", res.status, (res.headers.get("location") || "").slice(0, 60));
}
console.log("\nDONE run", run);
