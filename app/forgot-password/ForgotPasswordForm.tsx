"use client";

import Link from "../components/NavigationLink";
import { FormEvent, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";

export function ForgotPasswordForm() {
  const { configured, requestPasswordReset } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setSubmitting(true);
    try {
      await requestPasswordReset(email, `${window.location.origin}/reset-password`);
    } catch {
      // Keep the response identical so this form cannot disclose registered emails.
    }
    setSubmitted(true);
    setSubmitting(false);
  }

  if (!configured) {
    return <div className="login-form"><div className="demo-notice">Password recovery becomes active when Supabase is configured.</div><Link className="button" href="/login">Back to sign in</Link></div>;
  }

  if (submitted) {
    return <div className="login-form"><div className="success-banner compact" role="status">If an account exists for that email, a password reset link is on its way.</div><Link className="button" href="/login">Back to sign in</Link></div>;
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field"><label htmlFor="recovery-email">Work email</label><input className="control" id="recovery-email" name="email" type="email" autoComplete="email" required /></div>
      <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send reset link →"}</button>
      <Link className="button ghost" href="/login">Back to sign in</Link>
    </form>
  );
}
