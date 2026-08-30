export type RecoveryCallback =
  | { kind: "code"; code: string }
  | { kind: "token-hash"; tokenHash: string }
  | { kind: "implicit"; accessToken: string; refreshToken: string }
  | null;

export function parseRecoveryCallback(href: string): RecoveryCallback {
  const url = new URL(href);
  const code = url.searchParams.get("code");
  if (code) return { kind: "code", code };

  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash && url.searchParams.get("type") === "recovery") {
    return { kind: "token-hash", tokenHash };
  }

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const accessToken = fragment.get("access_token");
  const refreshToken = fragment.get("refresh_token");
  if (accessToken && refreshToken && fragment.get("type") === "recovery") {
    return { kind: "implicit", accessToken, refreshToken };
  }

  return null;
}

/**
 * Supabase Dashboard recovery emails use the project's Site URL as their
 * fallback destination. Preserve valid recovery credentials if they arrive at
 * the root route, rather than letting the normal root-to-dashboard redirect
 * discard them before the recovery screen can exchange the one-time code.
 */
export function recoveryDestination(href: string): string | null {
  if (!parseRecoveryCallback(href)) return null;
  const url = new URL(href);
  return `/reset-password${url.search}${url.hash}`;
}
