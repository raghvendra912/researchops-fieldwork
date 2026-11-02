export function requestId(request: Request) {
  return request.headers.get("cf-ray") ?? request.headers.get("x-request-id") ?? crypto.randomUUID();
}

export function safeLog(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) {
  const sanitized = Object.fromEntries(
    Object.entries(fields).filter(([key]) => !/secret|token|signature|authorization|metadata|respondent/i.test(key)),
  );
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), event, ...sanitized }));
}

export type ErrorContext = {
  requestId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  userId?: string;
  organizationId?: string;
  extra?: Record<string, unknown>;
};

/**
 * Standard error tracking hook for unhandled exceptions and security failures.
 * Logs structured error telemetry and optionally dispatches to an external
 * monitoring service (Sentry, webhook, etc.) if configured in environment.
 */
export async function trackError(
  error: unknown,
  context: ErrorContext = {},
  env?: { ERROR_WEBHOOK_URL?: string; SENTRY_DSN?: string; [key: string]: unknown },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const errorEvent = {
    timestamp: new Date().toISOString(),
    event: "unhandled_error",
    error: message,
    stack: stack?.slice(0, 1000),
    ...context,
  };

  safeLog("error", "application_exception", errorEvent);

  if (env?.ERROR_WEBHOOK_URL && /^https?:\/\//i.test(env.ERROR_WEBHOOK_URL)) {
    try {
      await fetch(env.ERROR_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(errorEvent),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      // Fire-and-forget: do not throw inside error reporting
    }
  }
}
