import vinext from "vinext";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import { execFileSync } from "node:child_process";
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
  // The automated suite server-renders protected pages and asserts the
  // "Checking your workspace session" gate, so the test bundle must look
  // auth-configured while never reaching real infrastructure. A developer
  // machine's `.env.local` must not reach the test bundle, or the
  // server-rendered shell would inherit unpredictable credentials.
  // `--mode test` therefore reads its environment from a deliberately
  // credential-free directory instead of the project root.
  const isTestBuild = process.env.RESEARCHOPS_TEST_BUILD === "true";
  if (isTestBuild) {
    // Vite's import.meta.env inherits process.env VITE_* entries even when
    // envDir points at the credential-free directory, so a shell that
    // exported Supabase credentials (local dev, tunnels, CI) would silently
    // change the auth configuration of the test bundle. Strip them and pin
    // non-secret placeholders instead: the suite server-renders protected
    // pages and asserts the "Checking your workspace session" gate, which
    // needs a configured client but must never reach real infrastructure.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("VITE_")) delete process.env[key];
    }
  }
  const envDir = isTestBuild ? `${process.cwd()}/tests/env` : process.cwd();
  const environment = loadEnv(mode, envDir, "");
  let commitCount = "1";
  try {
    commitCount = execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
  } catch { /* Source archives without Git metadata use the first release number. */ }
  const appVersion = environment.VITE_APP_VERSION || `0.${commitCount.padStart(3, "0")}`;
  const buildTime = new Date().toISOString();
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
    envDir,
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
      "import.meta.env.VITE_DEV_AUTO_LOGIN": JSON.stringify(
        devAutoLoginEnabled ? "true" : "false",
      ),
      ...(isTestBuild
        ? {
            "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://test-suite.supabase.invalid"),
            "import.meta.env.VITE_SUPABASE_ANON_KEY": JSON.stringify("test-suite-anon-key"),
          }
        : {}),
    },
    server: {
      host: "127.0.0.1",
      port: Number(process.env.DEV_PORT || environment.DEV_PORT || 3001),
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
