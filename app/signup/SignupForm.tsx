"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "../components/NavigationLink";
import { useAuth } from "../../src/features/auth/AuthProvider";

export function SignupForm() {
  const router = useRouter();
  const { configured, requestSignUpOtp, verifySignUpOtp } = useAuth();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "verify">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await requestSignUpOtp(email.trim()); setStep("verify"); }
    catch { setError("The verification code could not be sent. Check the email address and try again."); }
    finally { setBusy(false); }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const token = String(new FormData(event.currentTarget).get("token") ?? "").replace(/\s/g, ""); setBusy(true); setError("");
    try { await verifySignUpOtp(email.trim(), token); router.replace("/onboarding"); }
    catch { setError("The code is invalid or expired. Request a new code and try again."); setBusy(false); }
  }

  if (!configured) return <div className="demo-notice">Signup becomes active when Supabase is configured.</div>;
  return <div className="login-form">{step === "email" ? <form className="login-form" onSubmit={requestCode}><div className="field"><label htmlFor="signup-email">Work email</label><input className="control" id="signup-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>{error ? <div className="form-error" role="alert">{error}</div> : null}<button className="button primary" disabled={busy} type="submit">{busy ? "Sending…" : "Send one-time code"}</button></form> : <form className="login-form" onSubmit={verifyCode}><div className="success-banner compact" role="status">A one-time code was sent to {email}.</div><div className="field"><label htmlFor="signup-token">Verification code</label><input className="control otp-control" id="signup-token" name="token" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={10} pattern="[0-9]+" required /></div>{error ? <div className="form-error" role="alert">{error}</div> : null}<button className="button primary" disabled={busy} type="submit">{busy ? "Verifying…" : "Verify and continue"}</button><button className="button ghost" type="button" onClick={() => { setStep("email"); setError(""); }}>Use another email</button></form>}<div className="login-options"><span>Already registered?</span><Link href="/login">Sign in</Link></div></div>;
}
