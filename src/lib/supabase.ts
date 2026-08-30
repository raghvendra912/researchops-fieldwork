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
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Recovery callbacks are consumed explicitly by AuthProvider so it can
        // support PKCE, token-hash, and implicit links in one place. Leaving
        // the SDK default enabled creates a second, racing one-time-code
        // exchange and makes a valid reset link appear expired.
        detectSessionInUrl: false,
      },
    })
  : null;
