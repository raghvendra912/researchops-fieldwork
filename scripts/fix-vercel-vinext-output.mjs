import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("node_modules/.nitro/vite/services/rsc/vinext-client-assets.js");
const destination = resolve(
  ".vercel/output/functions/__server.func/_libs/vinext-client-assets.js",
);

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log("Included the vinext client-assets sidecar in the Vercel function.");
