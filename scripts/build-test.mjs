// Builds the application for the automated test suite.
//
// `vinext build` always builds in Vite's `production` mode and ignores
// `--mode`, so the suite cannot select a different mode through the CLI. It
// sets an explicit flag instead, which `vite.config.ts` turns into a
// credential-free `envDir`. That keeps a developer's `.env.local` out of the
// test bundle so the server-rendered shell reflects the documented demo
// experience the suite asserts.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules", "vinext", "dist", "cli.js");

const result = spawnSync(process.execPath, [cli, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, RESEARCHOPS_TEST_BUILD: "true" },
});

process.exit(result.status ?? 1);
