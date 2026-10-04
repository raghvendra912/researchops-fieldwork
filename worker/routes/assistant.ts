import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization.ts";
import { checkRateLimit, rateLimitResponse } from "../lib/rate-limit.ts";
import type { SupabaseEnv } from "../lib/supabase.ts";

export type AssistantEnv = SupabaseEnv & { OPENAI_API_KEY?: string };

type AssistantProject = {
  id: string;
  name: string;
  status: string;
  conversionRate?: number;
  starts?: number;
  completes?: number;
  liveSurveyUrl?: string;
  testSurveyUrl?: string;
};

function outputText(payload: unknown) {
  const response = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof response.output_text === "string") return response.output_text.trim();
  return (response.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text" && item.text).map((item) => item.text).join("\n").trim();
}

export async function handleAssistantApi(request: Request, pathname: string, env: AssistantEnv): Promise<Response | null> {
  if (pathname !== "/api/assistant") return null;
  if (request.method !== "GET" && request.method !== "POST") return null;
  const access = await authorizeWorkspace(request, env, workspacePermissions.administer);
  if (!access.ok) return authorizationError(access);
  if (request.method === "GET") return Response.json({ data: { configured: Boolean(env.OPENAI_API_KEY), model: "gpt-6-astra" } }, { headers: { "cache-control": "private, no-store" } });
  if (!env.OPENAI_API_KEY) return Response.json({ error: "ResearchOps Copilot is not connected to OpenAI yet" }, { status: 503 });
  const limited = checkRateLimit(`assistant:${access.membership.organization_id}:${access.membership.user_id ?? "admin"}`, 20, 60_000);
  if (!limited.allowed) return rateLimitResponse(limited);
  const body = await request.json().catch(() => null) as { question?: unknown; projects?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (!question || question.length > 2_000 || !Array.isArray(body?.projects) || body.projects.length > 500) return Response.json({ error: "A valid question and bounded project context are required" }, { status: 400 });
  const projects: AssistantProject[] = body.projects.map((item) => {
    const value = item as Record<string, unknown>;
    return { id: String(value.id ?? "").slice(0, 40), name: String(value.name ?? "").slice(0, 200), status: String(value.status ?? "").slice(0, 30), conversionRate: Number(value.conversionRate ?? 0), starts: Number(value.starts ?? 0), completes: Number(value.completes ?? 0), liveSurveyUrl: String(value.liveSurveyUrl ?? "").slice(0, 2048), testSurveyUrl: String(value.testSurveyUrl ?? "").slice(0, 2048) };
  }).filter((item) => item.id);
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-6-astra",
      reasoning: { effort: "low" },
      max_output_tokens: 1_200,
      instructions: "You are the ResearchOps Copilot for an authorized workspace administrator. Answer in the user's language, concisely and operationally. Use only the supplied workspace project data for project-specific claims. Never claim an action was executed unless the application confirms it. Identify missing or malformed survey links, setup gaps, and conversion patterns. Do not reveal secrets or infer personal data.",
      input: `Administrator question:\n${question}\n\nAuthorized workspace projects (JSON):\n${JSON.stringify(projects)}`,
    }),
  });
  const payload = await upstream.json().catch(() => null);
  if (!upstream.ok) return Response.json({ error: upstream.status === 401 ? "OpenAI API key was rejected" : "OpenAI response could not be generated" }, { status: 502 });
  const answer = outputText(payload);
  return answer ? Response.json({ data: { answer, model: "gpt-6-astra" } }) : Response.json({ error: "OpenAI returned an empty response" }, { status: 502 });
}
