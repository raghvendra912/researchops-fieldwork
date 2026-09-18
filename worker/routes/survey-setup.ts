import { authorizationError, authorizeWorkspace, workspacePermissions } from "../lib/authorization";
import { getProjectCapabilities } from "../lib/project-authorization";
import { isSupabaseConfigured, supabaseJson, type SupabaseEnv } from "../lib/supabase";
import { previewSurveyUrl, type SurveyParameter } from "../domain/survey-url";

type SetupRow = { survey_url: string | null; test_survey_url: string | null; survey_parameters: unknown };
const defaults: SurveyParameter[] = [{ name: "pid", value: "{{transaction_id}}" }, { name: "uid", value: "{{respondent_id}}" }];

function parse(body: Record<string, unknown> | null) {
  if (!body) return null;
  const liveUrl = String(body.liveUrl ?? "").trim(); const testUrl = String(body.testUrl ?? "").trim();
  if ([liveUrl, testUrl].some((url) => url && (!/^https?:\/\//i.test(url) || url.length > 2048)) || !Array.isArray(body.parameters) || body.parameters.length > 30) return null;
  const parameters = body.parameters.map((value) => { const item = value as Record<string, unknown>; return { name: String(item.name ?? "").trim(), value: String(item.value ?? "").trim() }; });
  if (!parameters.every((item) => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(item.name) && item.value.length > 0 && item.value.length <= 500) || new Set(parameters.map((item) => item.name.toLowerCase())).size !== parameters.length) return null;
  return { liveUrl, testUrl, parameters };
}

function mapped(row: SetupRow) { return { liveUrl: row.survey_url ?? "", testUrl: row.test_survey_url ?? "", parameters: Array.isArray(row.survey_parameters) ? row.survey_parameters : defaults }; }

function previews(liveUrl: string, testUrl: string, parameters: SurveyParameter[]) {
  return {
    livePreview: liveUrl ? previewSurveyUrl(liveUrl, parameters, false) : "",
    testPreview: testUrl || liveUrl ? previewSurveyUrl(testUrl || liveUrl, parameters, true) : "",
  };
}

export async function handleSurveySetupApi(request: Request, pathname: string, env: SupabaseEnv): Promise<Response | null> {
  const match = pathname.match(/^\/api\/projects\/([A-Z]{2,10}-[A-Z0-9-]+)\/survey-setup$/i); if (!match) return null;
  const code = match[1].toUpperCase();
  if (!isSupabaseConfigured(env)) {
    if (request.method === "GET") return Response.json({ data: { liveUrl: "https://surveyengine.pureprofile.com/start/fba4abb6-b7fe-416f-9ec5-02cfba4d5c35?rid={[rid]}", testUrl: "https://surveyengine.pureprofile.com/start/fba4abb6-b7fe-416f-9ec5-02cfba4d5c35?rid={[rid]}", parameters: defaults, ...previews("https://surveyengine.pureprofile.com/start/fba4abb6-b7fe-416f-9ec5-02cfba4d5c35?rid={[rid]}", "https://surveyengine.pureprofile.com/start/fba4abb6-b7fe-416f-9ec5-02cfba4d5c35?rid={[rid]}", defaults) }, meta: { source: "mock", canOperate: true } });
    if (request.method === "PUT") { const setup = parse(await request.json().catch(() => null) as Record<string, unknown> | null); return setup ? Response.json({ data: { ...setup, ...previews(setup.liveUrl, setup.testUrl, setup.parameters) }, meta: { source: "mock", canOperate: true } }) : Response.json({ error: "Valid survey URLs and unique parameters are required" }, { status: 400 }); }
    return null;
  }
  if (request.method !== "GET" && request.method !== "PUT") return null;
  const access = await authorizeWorkspace(request, env, request.method === "PUT" ? workspacePermissions.operate : workspacePermissions.read); if (!access.ok) return authorizationError(access);
  const capability = await getProjectCapabilities(env, access.authorization, code); if (!capability) return Response.json({ error: "Project not found or unavailable" }, { status: 404 });
  if (request.method === "GET") { const rows = await supabaseJson<SetupRow[]>(env, `/rest/v1/projects?select=survey_url,test_survey_url,survey_parameters&project_code=eq.${encodeURIComponent(code)}&limit=1`, access.authorization); const setup = mapped(rows[0] ?? { survey_url: null, test_survey_url: null, survey_parameters: defaults }); return Response.json({ data: { ...setup, ...previews(setup.liveUrl, setup.testUrl, setup.parameters) }, meta: { source: "supabase", canOperate: capability.can_operate } }); }
  if (!capability.can_operate) return Response.json({ error: "Project editor access is required" }, { status: 403 });
  const setup = parse(await request.json().catch(() => null) as Record<string, unknown> | null); if (!setup) return Response.json({ error: "Valid survey URLs and unique parameters are required" }, { status: 400 });
  await supabaseJson(env, "/rest/v1/rpc/update_project_survey_setup", access.authorization, { method: "POST", body: JSON.stringify({ p_project_code: code, p_survey_url: setup.liveUrl || null, p_test_survey_url: setup.testUrl || null, p_survey_parameters: setup.parameters }) });
  return Response.json({ data: { ...setup, ...previews(setup.liveUrl, setup.testUrl, setup.parameters) }, meta: { source: "supabase", canOperate: true } });
}
