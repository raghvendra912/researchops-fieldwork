"use client";

import Link from "./NavigationLink";
import { FormEvent, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";

export function OrganizationOnboardingForm() {
  const { configured, session, signOut } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("organizationName") ?? "").trim();
    setSubmitting(true);
    setError("");
    try {
      await apiRequest("/api/organizations", {
        method: "POST",
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        body: JSON.stringify({ name }),
      });
      window.location.assign("/dashboard");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The workspace could not be created.");
      setSubmitting(false);
    }
  }

  if (!configured) {
    return <div className="demo-notice">Organization onboarding becomes active when Supabase is configured. <Link className="project-code" href="/dashboard">Return to the demo workspace</Link>.</div>;
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="organization-name">Organization name</label>
        <input className="control" id="organization-name" name="organizationName" minLength={2} maxLength={100} placeholder="e.g. ResearchOps Labs" required />
      </div>
      <p className="page-subtitle">You will become the workspace owner. Default supplier records are added so you can create the first project immediately.</p>
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <button className="button primary" type="submit" disabled={submitting}>{submitting ? "Creating workspace…" : "Create workspace →"}</button>
      <button className="button ghost" type="button" onClick={() => void signOut()}>Sign out</button>
    </form>
  );
}
