const origin = process.env.QA_ORIGIN || "https://www.asrv.co.in";
async function anonKey() {
  const page = await (await fetch(`${origin}/login`)).text();
  const chunks = [...new Set([...page.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_.-]+\.js/g)].map((match) => match[0]))];
  for (const chunk of chunks) { const source = await (await fetch(`${origin}${chunk}`)).text(); const match = source.match(/eyJhbGciOi[A-Za-z0-9._-]{40,}/); if (match) return match[0]; }
  throw new Error("Public Supabase key was not found");
}
const key = await anonKey(); const suffix = Date.now();
async function api(path, { method = "GET", token = key, body } = {}) {
  const response = await fetch(`${origin}${path}`, { method, headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", "x-requested-with": "XMLHttpRequest" }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({})); return { status: response.status, json };
}
const signup = await api("/supabase/auth/v1/signup", { method: "POST", body: { email: `qa-assistant-${suffix}@example.com`, password: "QaAssistant!2026x" } });
const token = signup.json.access_token ?? signup.json.data?.access_token; if (!token) throw new Error(`Signup failed (${signup.status})`);
const organization = await api("/api/organizations", { method: "POST", token, body: { name: `QA Assistant ${suffix}` } }); if (organization.status !== 201) throw new Error(`Organization failed (${organization.status})`);
const readiness = await api("/api/assistant", { token });
console.log("assistant readiness:", readiness.status, JSON.stringify(readiness.json));
if (readiness.status !== 200 || readiness.json.data?.configured !== true) process.exit(2);
const answer = await api("/api/assistant", { method: "POST", token, body: { question: "In one short sentence, confirm that the ResearchOps Copilot can answer an administrator's free-form project question.", projects: [] } });
console.log("assistant response:", answer.status, JSON.stringify({ answer: answer.json.data?.answer, model: answer.json.data?.model, error: answer.json.error }));
if (answer.status !== 200 || !answer.json.data?.answer) process.exit(3);
