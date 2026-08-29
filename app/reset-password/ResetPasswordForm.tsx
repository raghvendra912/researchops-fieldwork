"use client";

import Link from "../components/NavigationLink";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";

export function ResetPasswordForm() {
  const router = useRouter();
  const { configured, loading, session, updatePassword, signOut } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password.length < 10) return setError("Use at least 10 characters for the new password.");
    if (password !== confirmation) return setError("The passwords do not match.");

    setSubmitting(true);
    setError("");
    try {
      await updatePassword(password);
      await signOut();
      router.replace("/login?reset=success");
    } catch {
      setError("This recovery link could not update the password. Request a new link and try again.");
      setSubmitting(false);
    }
  }

  if (!configured) return <div className="login-form"><div className="demo-notice">Password recovery becomes active when Supabase is configured.</div><Link className="button" href="/login">Back to sign in</Link></div>;
  if (loading) return <div className="auth-loading compact-loading">Validating recovery link…</div>;
  if (!session) return <div className="login-form"><div className="form-error" role="alert">This recovery link is invalid or has expired.</div><Link className="button primary" href="/forgot-password">Request a new link</Link></div>;

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field"><label htmlFor="new-password">New password</label><input className="control" id="new-password" name="password" type="password" minLength={10} autoComplete="new-password" required /></div>
      <div className="field"><label htmlFor="confirm-password">Confirm password</label><input className="control" id="confirm-password" name="confirmation" type="password" minLength={10} autoComplete="new-password" required /></div>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Updating…" : "Update password →"}</button>
    </form>
  );
}
