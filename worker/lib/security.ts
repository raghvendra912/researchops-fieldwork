// Security middleware for adding required headers to all responses

export function securityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  // Prevent clickjacking
  headers.set("X-Frame-Options", "DENY");

  // Prevent MIME type sniffing
  headers.set("X-Content-Type-Options", "nosniff");

  // Referrer policy
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Content Security Policy
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // React RSC requires unsafe-eval
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  );

  // Permissions policy - restrict sensitive APIs
  headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// CSRF protection via custom header check
export function validateCSRF(request: Request): boolean {
  // State-changing methods require CSRF protection
  const method = request.method;
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true; // GET/HEAD/OPTIONS don't need CSRF protection
  }

  // Check for custom header that browsers won't send cross-origin without CORS preflight
  const customHeader = request.headers.get("X-Requested-With");
  if (customHeader === "XMLHttpRequest") {
    return true;
  }

  // Also accept requests with a specific CSRF token header
  const csrfToken = request.headers.get("X-CSRF-Token");
  if (csrfToken && csrfToken.length > 0) {
    return true;
  }

  return false;
}

export function csrfError(): Response {
  return Response.json(
    { error: "CSRF validation failed. Include X-Requested-With: XMLHttpRequest header." },
    { status: 403 }
  );
}

// Request body size limit to prevent DoS
export async function validateRequestSize(request: Request, maxBytes: number = 1048576): Promise<{ valid: boolean; body?: string }> {
  const contentLength = request.headers.get("content-length");

  // If Content-Length header is present and exceeds limit, reject immediately
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return { valid: false };
  }

  // Read body with size check
  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes) {
    return { valid: false };
  }

  return { valid: true, body };
}

export function requestSizeError(): Response {
  return Response.json(
    { error: "Request body too large. Maximum size is 1MB." },
    { status: 413 }
  );
}

// Validate secrets at startup
export function validateSecrets(env: Record<string, string | undefined>, required: string[]): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  for (const key of required) {
    const value = env[key];
    if (!value) {
      missing.push(key);
      continue;
    }

    // Secrets should be at least 32 characters (256 bits base64)
    if (value.length < 32) {
      missing.push(`${key} (too short, minimum 32 characters)`);
    }
  }

  return { valid: missing.length === 0, missing };
}

// Prevent dev features in production
export function isDevelopmentMode(): boolean {
  // Check multiple indicators that we're in development
  const nodeEnv = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  const isVercel = typeof process !== "undefined" ? process.env.VERCEL : undefined;

  // If we're in Vercel production, we're definitely not in dev mode
  if (isVercel && nodeEnv === "production") {
    return false;
  }

  // Otherwise check NODE_ENV
  return nodeEnv !== "production";
}

export function blockDevFeatureInProduction(featureName: string): Response {
  return Response.json(
    { error: `${featureName} is only available in development mode` },
    { status: 403 }
  );
}
