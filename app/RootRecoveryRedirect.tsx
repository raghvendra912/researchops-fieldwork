"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { recoveryDestination } from "../src/features/auth/recovery";

export function RootRecoveryRedirect() {
  const router = useRouter();

  useEffect(() => {
    const destination = recoveryDestination(globalThis.location.href);
    if (destination) {
      // Use a full navigation so AuthProvider mounts on /reset-password and
      // becomes the single owner of the recovery-code exchange.
      globalThis.location.replace(destination);
      return;
    }
    router.replace("/dashboard");
  }, [router]);

  return <main className="auth-loading">Opening ResearchOps…</main>;
}
