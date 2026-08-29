import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The deployed React Server Components function needs the `react-server`
// condition at runtime. Applying that condition to Vite itself selects React's
// server-only export map too early and prevents the Vinext config from loading.
const buildEnvironment = { ...process.env };
delete buildEnvironment.NODE_OPTIONS;

const viteResult = spawnSync(
  process.execPath,
  [resolve("node_modules/vite/bin/vite.js"), "build"],
  {
    env: buildEnvironment,
    stdio: "inherit",
  },
);

if (viteResult.error) {
  throw viteResult.error;
}

if (viteResult.status !== 0) {
  process.exit(viteResult.status ?? 1);
}

await import("./fix-vercel-vinext-output.mjs");
