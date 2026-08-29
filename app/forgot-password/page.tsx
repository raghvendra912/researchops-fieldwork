import type { Metadata } from "next";
import Link from "../components/NavigationLink";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <main className="auth-card-page">
      <section className="login-card panel auth-card">
        <Link className="brand-lockup" href="/" style={{ paddingInline: 0 }}><span className="brand-mark">r</span><span>ResearchOps</span></Link>
        <div className="eyebrow">Account recovery</div>
        <h2>Reset your password</h2>
        <p>Enter your work email and we will send recovery instructions.</p>
        <ForgotPasswordForm />
      </section>
    </main>
  );
}
