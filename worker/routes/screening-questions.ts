import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization.ts";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase.ts";

type Question = { question: string; answerType: "SINGLE_SELECT" | "MULTI_SELECT" | "TEXT" | "NUMBER" | "BOOLEAN" };
const answerTypes = new Set<Question["answerType"]>(["SINGLE_SELECT", "MULTI_SELECT", "TEXT", "NUMBER", "BOOLEAN"]);
const demoQuestions: Question[] = [{ question: "Are you the primary decision maker for this category?", answerType: "SINGLE_SELECT" }];

function parseQuestions(body: Record<string, unknown> | null) {
  if (!Array.isArray(body?.questions) || body.questions.length > 5) return null;
  const questions = body.questions.map((value) => {
    const item = value as Record<string, unknown>; const question = String(item.question ?? "").trim(); const answerType = String(item.answerType ?? "") as Question["answerType"];
    return question.length >= 2 && question.length <= 500 && answerTypes.has(answerType) ? { question, answerType } : null;
  });
  return questions.every(Boolean) ? questions as Question[] : null;
}

export async function handleScreeningQuestionsApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/screening-questions$/i);
  if (!match) return null;
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: demoQuestions, meta: { source: "mock", canOperate: true } });
    if (request.method === "PUT") { const questions = parseQuestions(await request.json().catch(() => null) as Record<string, unknown> | null); return questions ? Response.json({ data: questions, meta: { source: "mock", canOperate: true } }) : Response.json({ error: "Up to five valid screening questions are required" }, { status: 400 }); }
  }
  const allowed = request.method === "GET" ? workspacePermissions.read : workspacePermissions.operate;
  const access = await authorizeWorkspace(request, env, allowed); if (!access.ok) return authorizationError(access);
  const code = encodeURIComponent(match[1].toUpperCase());
  if (request.method === "GET") {
    const rows = await supabaseJson<Array<{ prescreening_questions: Question[] }>>(env, `/rest/v1/projects?select=prescreening_questions&project_code=eq.${code}&limit=1`, access.authorization);
    if (!rows[0]) return Response.json({ error: "Project not found" }, { status: 404 });
    return Response.json({ data: Array.isArray(rows[0].prescreening_questions) ? rows[0].prescreening_questions : [], meta: { source: "supabase", canOperate: workspacePermissions.operate.includes(access.membership.role as "OWNER" | "ADMIN" | "PM") } });
  }
  if (request.method === "PUT") {
    const questions = parseQuestions(await request.json().catch(() => null) as Record<string, unknown> | null);
    if (!questions) return Response.json({ error: "Up to five valid screening questions are required" }, { status: 400 });
    const rows = await supabaseJson<Array<{ prescreening_questions: Question[] }>>(env, `/rest/v1/projects?project_code=eq.${code}&select=prescreening_questions`, access.authorization, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ prescreening_questions: questions }) });
    if (!rows[0]) return Response.json({ error: "Project editor access is required" }, { status: 403 });
    return Response.json({ data: rows[0].prescreening_questions, meta: { source: "supabase", canOperate: true } });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
