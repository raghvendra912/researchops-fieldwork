export async function riskMetadata(request: Request, deviceRef: unknown, secret?: string) {
  if (!secret) return {};
  const hash = async (value: string) => { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(""); };
  const ip = request.headers.get("cf-connecting-ip") ?? "";
  return { ...(ip ? { ipHash: await hash(ip) } : {}), ...(deviceRef ? { deviceHash: await hash(String(deviceRef)) } : {}) };
}
