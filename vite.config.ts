import vinext from "vinext";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  const isVercelBuild = Boolean(process.env.VERCEL) || process.env.NITRO_PRESET === "vercel";
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const environment = loadEnv(mode, process.cwd(), "");
  const devAutoLoginEnabled =
    (process.env.DEV_AUTO_LOGIN ?? environment.DEV_AUTO_LOGIN) === "true";
  const workerVariables = Object.fromEntries(Object.entries({
    SUPABASE_URL: environment.SUPABASE_URL || environment.VITE_SUPABASE_URL,
    SUPABASE_ANON_KEY: environment.SUPABASE_ANON_KEY || environment.VITE_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
    EVENT_INGESTION_SECRET: environment.EVENT_INGESTION_SECRET,
    CPX_CALLBACK_SECRET: environment.CPX_CALLBACK_SECRET,
    BITLABS_CALLBACK_SECRET: environment.BITLABS_CALLBACK_SECRET,
    PURESPECTRUM_CALLBACK_SECRET: environment.PURESPECTRUM_CALLBACK_SECRET,
    FRAUD_HASH_SECRET: environment.FRAUD_HASH_SECRET,
  }).filter((entry): entry is [string, string] => Boolean(entry[1])));

  return {
    define: {
      "import.meta.env.VITE_DEV_AUTO_LOGIN": JSON.stringify(
        devAutoLoginEnabled ? "true" : "false",
      ),
    },
    server: {
      host: "127.0.0.1",
      port: 3001,
      strictPort: true,
      // Quick Tunnels use a random hostname. Keep the allowlist narrow rather
      // than disabling Vite's host protection for every domain.
      allowedHosts: [".trycloudflare.com"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: isVercelBuild
      ? [
          vinext(),
          nitro({
            serverDir: "./server",
          }),
        ]
      : [
          vinext(),
          sites(),
          cloudflare({
            viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
            config: { ...localBindingConfig, vars: workerVariables },
          }),
        ],
  };
});
