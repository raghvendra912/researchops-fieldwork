import { defineMiddleware } from "nitro";
import worker from "../../worker/index";

const backendPrefixes = ["/api/", "/r/", "/supabase/"];

export default defineMiddleware((event) => {
  const pathname = new URL(event.req.url).pathname;
  if (!backendPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return;
  }

  return worker.fetch(event.req, undefined, {
    waitUntil() {},
    passThroughOnException() {},
  });
});
