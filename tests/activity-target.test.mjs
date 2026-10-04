import assert from "node:assert/strict";
import test from "node:test";
import { activityTarget } from "../src/features/notifications/activity-target.ts";

test("live activity alerts open the relevant operational screen", () => {
  assert.equal(activityTarget({ eventType: "QUALITY_FLAG", title: "Quality review needed for ROP-1178" }), "/fraud?project=ROP-1178");
  assert.equal(activityTarget({ eventType: "PROJECT_LIVE", title: "ROP-1178 is now live" }), "/projects/ROP-1178");
  assert.equal(activityTarget({ eventType: "CALLBACK_FAILURE", title: "Callback failed" }), "/notifications");
});
