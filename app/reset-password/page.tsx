import type { Metadata } from "next";
import Link from "../components/NavigationLink";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <main className="auth-card-page">
      <section className="login-card panel auth-card">
        <Link className="brand-lockup" href="/" style={{ paddingInline: 0 }}><span className="brand-mark">r</span><span>ResearchOps</span></Link>
        <div className="eyebrow">Secure recovery</div>
        <h2>Choose a new password</h2>
        <p>Your recovery link authorizes this one-time password change.</p>
        <ResetPasswordForm />
      </section>
    </main>
  );
}
