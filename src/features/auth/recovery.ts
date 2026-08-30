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
