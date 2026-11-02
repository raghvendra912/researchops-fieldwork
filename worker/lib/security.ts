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

// Cryptographic HMAC-SHA256 signature generation and constant-time verification for secure outcome links
export async function createHmacSignature(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyHmacSignature(secret: string, data: string, signature: string): Promise<boolean> {
  if (!signature || signature.length !== 64) return false;
  const expected = await createHmacSignature(secret, data);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// UUIDv7 generator for hit audit click IDs
export function generateClickId(): string {
  const timestamp = Date.now();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = Math.floor(timestamp / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(timestamp / 0x100000000) & 0xff;
  bytes[2] = Math.floor(timestamp / 0x1000000) & 0xff;
  bytes[3] = Math.floor(timestamp / 0x10000) & 0xff;
  bytes[4] = Math.floor(timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Persistent visitor cookie (ro_vid) with 24-hour TTL for cross-attempt deduplication
export function extractOrSetVisitorId(request: Request): { visitorId: string; setCookieHeader?: string } {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)ro_vid=([0-9a-fA-F-]+)/);
  if (match && match[1]) {
    return { visitorId: match[1] };
  }
  const newId = generateClickId();
  return {
    visitorId: newId,
    setCookieHeader: `ro_vid=${newId}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
  };
}
