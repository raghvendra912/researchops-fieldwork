import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const functionDirectory = resolve(".vercel/output/functions/__server.func");
const workerEntry = resolve(functionDirectory, "vinext-worker.mjs");

// Nitro currently rebundles Vinext's RSC service with the client React export,
// which crashes before the Vercel function can handle a request. The Vinext
// server output is already a self-contained standard fetch worker and preserves
// the correct per-environment React bundles, so use it as the function payload.
await rm(functionDirectory, { recursive: true, force: true });
await mkdir(functionDirectory, { recursive: true });
await cp(resolve("dist/server"), functionDirectory, { recursive: true });
await rename(resolve(functionDirectory, "index.js"), workerEntry);

await writeFile(
  resolve(functionDirectory, ".vc-config.json"),
  `${JSON.stringify({
    handler: "index.mjs",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    runtime: "nodejs22.x",
  }, null, 2)}\n`,
);

await writeFile(
  resolve(functionDirectory, "index.mjs"),
  `import worker from "./vinext-worker.mjs";

export default {
  fetch(request, context) {
    return worker.fetch(request, process.env, {
      waitUntil(promise) {
        context?.waitUntil?.(promise);
      },
      passThroughOnException() {},
    });
  },
};
`,
);

console.log("Packaged the verified Vinext fetch worker for the Vercel function.");
