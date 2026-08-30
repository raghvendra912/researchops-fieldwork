"use client";

import Link from "../components/NavigationLink";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";

function safeReturnPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { configured, loading, session, signIn } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const returnTo = safeReturnPath(searchParams.get("returnTo"));

  useEffect(() => {
    if (configured && !loading && session) router.replace(returnTo);
  }, [configured, loading, returnTo, router, session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    setSubmitting(true);
    setError("");
    try {
      await signIn(email, password);
      router.replace(returnTo);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      console.error("Sign-in did not establish a workspace session", cause);
      if (/storage|localstorage|session storage/i.test(message)) {
        setError("Your browser blocked secure session storage. Allow site data for this site, then try again.");
      } else if (/did not return a login session/i.test(message)) {
        setError("Your credentials were accepted, but a workspace session was not returned. Please try again once.");
      } else {
        setError("We could not sign you in. Check your email and password and try again.");
      }
      setSubmitting(false);
    }
  }

  if (!configured) {
    return (
      <div className="login-form">
        <div className="demo-notice">
          Supabase is not configured, so this workspace is running in demo mode with local mock data.
        </div>
        <Link className="button primary" href={returnTo}>Enter demo workspace &rarr;</Link>
      </div>
    );
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input className="control" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input className="control" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <div className="login-options"><span /> <Link href="/forgot-password">Forgot password?</Link></div>
      {searchParams.get("reset") === "success" ? <div className="success-banner compact" role="status">Password updated. Sign in with your new password.</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="button primary" type="submit" disabled={submitting || loading}>
        {submitting ? "Signing in..." : "Enter workspace →"}
      </button>
      <div className="login-options"><span>New to ResearchOps?</span><Link href="/signup">Create an account</Link></div>
    </form>
  );
}
