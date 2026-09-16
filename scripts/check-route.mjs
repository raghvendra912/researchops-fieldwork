#!/usr/bin/env node
// Lightweight routing-link checker: no install beyond the repo's node runtime.
// Usage:
//   node scripts/check-route.mjs "https://host/r/supplier/<token>/live?project=ROP-1&respondent=ABC"
//   node scripts/check-route.mjs "https://host/r/client/<token>/complete?rid=<uuid>&project=ROP-1" --diagnose
// With --diagnose the Worker returns machine-readable JSON help for the failure.
const input = process.argv[2];
const diagnose = process.argv.includes("--diagnose") || process.argv.includes("--json");
if (!input) {
  console.error('Usage: node scripts/check-route.mjs "<routing-url>" [--diagnose]');
  process.exit(2);
}
let target = input;
if (diagnose && !/[?&]diagnose=1/.test(target)) target += (target.includes("?") ? "&" : "?") + "diagnose=1";
const started = Date.now();
let response;
try {
  response = await fetch(target, { redirect: "manual" });
} catch (error) {
  console.error(`REQUEST FAILED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const body = await response.text();
console.log(`status: ${response.status}`);
for (const name of ["location", "cache-control", "x-request-id", "content-type"]) {
  const value = response.headers.get(name);
  if (value) console.log(`${name}: ${value}`);
}
console.log(`timeMs: ${Date.now() - started}`);
if ((response.headers.get("content-type") ?? "").includes("application/json")) {
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body.slice(0, 4000));
  }
} else {
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  console.log(text.slice(0, 2000));
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    const next = new URL(location, target);
    console.log(`redirect-target-host: ${next.host}`);
    console.log(`redirect-target-path: ${next.pathname}${next.search.slice(0, 200)}`);
  }
  if (response.status === 404 && text.includes("Supplier link is inactive")) {
    console.log("fix: set supplier ACTIVE + configure supplier return URLs, or re-copy the live template from Project details.");
  }
  if (response.status === 400 && text.includes("Project and respondent are required")) {
    console.log("fix: open /r/supplier/<token>/live?project=ROP-XXX&respondent=UNIQUE-ID (replace {{respondent_id}}).");
  }
  if (text.includes("Respondent routing session was not found")) {
    console.log("fix: client returns need the ResearchOps session UUID from survey entry, not the supplier reference.");
  }
}
process.exit(response.status >= 200 && response.status < 400 ? 0 : 3);
