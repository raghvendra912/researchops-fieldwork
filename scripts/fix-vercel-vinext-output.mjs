import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(".vercel/output");
const functionDirectory = resolve(outputDirectory, "functions/__server.func");
const staticDirectory = resolve(outputDirectory, "static");

// Vinext's fetch-worker build is the verified complete application artifact: it
// includes RSC/SSR rendering and the ResearchOps middleware APIs. Package that
// artifact directly using Vercel Build Output API v3 instead of asking Nitro to
// split and rebundle the application into a second runtime representation.
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(functionDirectory, { recursive: true });
await cp(resolve("dist/server"), functionDirectory, { recursive: true });
await cp(resolve("dist/client"), staticDirectory, { recursive: true });

await writeFile(
  resolve(functionDirectory, ".vc-config.json"),
  `${JSON.stringify({
    handler: "handler.mjs",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    runtime: "nodejs22.x",
  }, null, 2)}\n`,
);

await writeFile(
  resolve(functionDirectory, "handler.mjs"),
  `import worker from "./index.js";

export default {
  fetch(request, context) {
    const fetchHandler =
      typeof worker === "function" ? worker : worker.fetch.bind(worker);
    return fetchHandler(request, process.env, {
      waitUntil(promise) {
        context?.waitUntil?.(promise);
      },
      passThroughOnException() {},
    });
  },
};
`,
);

await writeFile(
  resolve(outputDirectory, "config.json"),
  `${JSON.stringify({
    version: 3,
    routes: [
      {
        src: "/_next/static/(.*)",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
      },
      { handle: "filesystem" },
      { src: "/(.*)", dest: "/__server" },
    ],
  }, null, 2)}\n`,
);

console.log("Packaged the complete Vinext worker as Vercel Build Output API v3.");
