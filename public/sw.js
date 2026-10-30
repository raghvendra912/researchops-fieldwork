const VERSION = "researchops-network-only-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ResearchOps contains authenticated operational data. Keep the installed app
// network-only so project, respondent and supplier responses are never cached.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data === "RESEARCHOPS_VERSION") event.source?.postMessage(VERSION);
});
