import { readFileSync } from "node:fs";
const anonKey = readFileSync("anon-key.txt", "utf8").trim();
const base = "https://cmrktkzdptmywrtscalu.supabase.co/rest/v1";
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };
async function get(path) {
  const res = await fetch(base + path, { headers });
  const text = await res.text();
  if (!res.ok) return { error: res.status, body: text.slice(0, 300) };
  try { return JSON.parse(text); } catch { return { error: "parse", body: text.slice(0, 200) }; }
}
const projects = await get("/projects?select=id,project_code,project_name,status,survey_url,test_survey_url&order=created_at.desc&limit=20");
if (projects.error) { console.log("PROJECTS ERR", JSON.stringify(projects)); process.exit(1); }
console.log("=== PROJECTS ===");
for (const p of projects) console.log(`${p.project_code} | ${p.project_name} | status=${p.status} | survey=${p.survey_url ? "SET" : "MISSING"} | test=${p.test_survey_url ? "SET" : "MISSING"}`);
const targets = projects.filter((p) => ((p.project_name || "") + " " + (p.project_code || "")).toLowerCase().includes("test"));
console.log("\nTargets:", targets.map((t) => t.project_code).join(", ") || "(none named test)");
for (const t of targets) {
  const assign = await get(`/project_suppliers?select=id,status,supplier_project_id,target_quota,suppliers(id,name,status,redirect_token,redirect_mode,complete_url,terminate_url,quota_full_url,security_terminate_url)&project_id=eq.${t.id}`);
  console.log(`\n=== ${t.project_code} assignments ===`);
  console.log(JSON.stringify(assign, null, 1).slice(0, 3500));
}
