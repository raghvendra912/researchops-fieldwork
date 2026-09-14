import { supabaseJson, type SupabaseEnv } from "./supabase.ts";

export type ProjectCapabilities = {
  project_id: string;
  can_access: boolean;
  can_operate: boolean;
  can_review: boolean;
  can_manage_access: boolean;
};

export async function getProjectCapabilities(env: SupabaseEnv, authorization: string, projectCode: string) {
  const rows = await supabaseJson<ProjectCapabilities[]>(env, "/rest/v1/rpc/project_capabilities", authorization, {
    method: "POST",
    body: JSON.stringify({ p_project_code: projectCode.toUpperCase() }),
  });
  return rows[0] ?? null;
}
