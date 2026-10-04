export type ActivityNotice = { eventType: string; title: string; body?: string };

export function activityTarget(notice: ActivityNotice) {
  const projectCode = `${notice.title} ${notice.body ?? ""}`.match(/\b[A-Z]{2,10}-[A-Z0-9-]+\b/)?.[0];
  if (notice.eventType === "QUALITY_FLAG") return projectCode ? `/fraud?project=${encodeURIComponent(projectCode)}` : "/fraud";
  if (["PROJECT_LIVE", "PROJECT_PAUSED", "PROJECT_CLOSED", "PACING_RISK", "QUOTA_REACHED"].includes(notice.eventType)) {
    return projectCode ? `/projects/${encodeURIComponent(projectCode)}` : "/projects";
  }
  return "/notifications";
}
