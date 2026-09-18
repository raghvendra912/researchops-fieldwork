#!/usr/bin/env node
// Lightweight routing-link checker: no install beyond the repo's node runtime.
// Usage:
//   node scripts/check-route.mjs "https://host/r/supplier/<token>/live?project=ROP-1&respondent=ABC"
//   node scripts/check-route.mjs "https://host/r/client/<token>/complete?rid=<uuid>&project=ROP-1" --diagnose
// With --diagnose the Worker returns machine-readable JSON help for the failure.
function printUsage() {
  console.error('Usage: node scripts/check-route.mjs "<routing-url>" [--diagnose] [--json] [--timeout=<ms>]');
  console.error('Example: node scripts/check-route.mjs "https://host/r/supplier/<token>/live?project=ROP-1&respondent=ABC" --diagnose');
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
  printUsage();
  process.exit(0);
}

let timeoutMs = 20000;
let diagnose = false;
const urlCandidates = [];
for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];
  if (arg === "--diagnose" || arg === "--json") {
    diagnose = true;
  } else if (arg.startsWith("--timeout=")) {
    const parsed = Number.parseInt(arg.slice("--timeout=".length), 10);
    if (Number.isFinite(parsed) && parsed > 0) timeoutMs = Math.min(Math.floor(parsed), 120000);
  } else if (arg === "--timeout" && index + 1 < rawArgs.length) {
    const parsed = Number.parseInt(rawArgs[index + 1], 10);
    if (Number.isFinite(parsed) && parsed > 0) timeoutMs = Math.min(Math.floor(parsed), 120000);
    index += 1;
  } else if (arg === "--") {
    urlCandidates.push(...rawArgs.slice(index + 1));
    break;
  } else if (arg.startsWith("-")) {
    console.error(`Unknown option: ${arg}`);
    printUsage();
    process.exit(2);
  } else {
    urlCandidates.push(arg);
  }
}

const input = urlCandidates[0];
if (!input) {
  printUsage();
  process.exit(2);
}
if (urlCandidates.length > 1) {
  console.error("Expected exactly one routing URL.");
  printUsage();
  process.exit(2);
}

let targetUrl;
try {
  targetUrl = new URL(input);
} catch {
  console.error(`Invalid URL: ${input}`);
  printUsage();
  process.exit(2);
}
if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
  console.error(`Only http(s) routing URLs are supported: ${input}`);
  process.exit(2);
}
if (diagnose && targetUrl.searchParams.get("diagnose") !== "1" && targetUrl.searchParams.get("format") !== "json") {
  targetUrl.searchParams.set("diagnose", "1");
}
const target = targetUrl.toString();
const started = Date.now();
let response;
try {
  response = await fetch(target, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": "ResearchOps-check-route/1.0 (+https://www.asrv.co.in)",
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });
} catch (error) {
  if (error instanceof Error && error.name === "TimeoutError") {
    console.error(`REQUEST TIMED OUT after ${timeoutMs}ms: ${target}`);
  } else {
    console.error(`REQUEST FAILED: ${error instanceof Error ? error.message : error}`);
  }
  process.exit(1);
}
let body;
try {
  body = await response.text();
} catch (error) {
  console.error(`READ FAILED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
console.log(`url: ${target}`);
console.log(`status: ${response.status}`);
for (const name of ["location", "cache-control", "retry-after", "x-request-id", "content-type"]) {
  const value = response.headers.get(name);
  if (value) console.log(`${name}: ${value}`);
}
console.log(`timeMs: ${Date.now() - started}`);
const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
const looksJson = contentType.includes("application/json") || body.trimStart().startsWith("{");
if (looksJson && body.trimStart().startsWith("{")) {
  try {
    const parsed = JSON.parse(body);
    console.log(JSON.stringify(parsed, null, 2));
    if (typeof parsed?.fix === "string" && parsed.fix) console.log(`fix: ${parsed.fix}`);
    if (Array.isArray(parsed?.expected?.newProjectChecklist)) {
      console.log("checklist:");
      for (const step of parsed.expected.newProjectChecklist) console.log(`- ${step}`);
    }
  } catch {
    console.log(body.slice(0, 4000));
  }
} else if (contentType.includes("application/json")) {
  try {
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    console.log(body.slice(0, 4000));
  }
} else {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  console.log(text ? text.slice(0, 2000) : "(empty body)");
  const location = response.headers.get("location");
  if (response.status >= 300 && response.status < 400 && location) {
    try {
      const next = new URL(location, target);
      console.log(`redirect-target-host: ${next.host}`);
      console.log(`redirect-target-path: ${next.pathname}${next.search.slice(0, 200)}`);
    } catch {
      console.log(`redirect-target-unparseable: ${location.slice(0, 200)}`);
    }
  }
  const fixes = [
    ["Supplier link is inactive", "fix: set supplier ACTIVE + configure supplier return URLs, or re-copy the live template from Project details."],
    ["Project and respondent are required", "fix: open /r/supplier/<token>/live?project=ROP-XXX&respondent=UNIQUE-ID (replace {{respondent_id}})."],
    ["Respondent routing session was not found", "fix: client returns need the ResearchOps session UUID from survey entry, not the supplier reference."],
    ["The supplier is not assigned to this project", "fix: assign this supplier to the project in Project details → Supplier delivery and set the assignment ACTIVE."],
    ["Project traffic is not active", "fix: set the project to LIVE and the supplier assignment to ACTIVE."],
    ["The client survey URL is not configured", "fix: set the live survey URL in Project details → Survey routing setup (must be https)."],
    ["Client link was not found", "fix: re-copy the client outcome link from Project details; the client token is wrong or rotated."],
    ["Respondent ID is required", "fix: return the ResearchOps session UUID in rid plus ?project=ROP-XXX (see ROUTING_HELP.clientExample with ?diagnose=1)."],
    ["legacy respondent ID matches more than one", "fix: return the ResearchOps session UUID from the survey instead of the supplier reference."],
    ["The respondent session could not be started", "fix: retry the launch; if it persists, check Supabase/event ingestion and share the x-request-id."],
    ["The respondent outcome could not be recorded", "fix: retry the outcome return; if it persists, check Supabase/event ingestion and share the x-request-id."],
    ["Routing is not configured", "fix: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker, then retry the link."],
    ["Method not allowed", "fix: open routing links with GET in a browser or redirect (POST/PUT are not routing)."],
    ["quota is full", "fix: quota is exhausted — raise quota or wait for quota reset before retesting live."],
    ["already recorded as", "fix: this session already reached a terminal outcome; launch a fresh supplier link for a new attempt."],
  ];
  for (const [needle, hint] of fixes) {
    if (text.includes(needle)) console.log(hint);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    console.log(`fix: rate-limited — wait ${retryAfter ? `${retryAfter}s` : "60s"} before retrying.`);
  }
}
process.exit(response.status >= 200 && response.status < 400 ? 0 : 3);
