import { createClient } from "@supabase/supabase-js";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseUrl = configuredUrl === "same-origin"
  ? typeof globalThis.location !== "undefined" ? `${globalThis.location.origin}/supabase` : "http://same-origin.invalid/supabase"
  : configuredUrl;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.info("Supabase is not configured; ResearchOps is running with mock project data.");
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
