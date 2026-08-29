export function requestId(request: Request) { return request.headers.get("cf-ray") ?? request.headers.get("x-request-id") ?? crypto.randomUUID(); }
export function safeLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  const sanitized = Object.fromEntries(Object.entries(fields).filter(([key]) => !/secret|token|signature|authorization|metadata|respondent/i.test(key)));
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), event, ...sanitized }));
}
