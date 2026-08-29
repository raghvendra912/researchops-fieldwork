import type { Metadata } from "next";
import Link from "../components/NavigationLink";
import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-art">
        <Link className="brand-lockup" href="/" style={{ padding: 0 }}>
          <span className="brand-mark">r</span><span>ResearchOps</span>
        </Link>
        <div className="login-copy">
          <h1>Fieldwork,<br /><em>under control.</em></h1>
          <p>One precise view of projects, suppliers, quality and commercial performance—from launch to last complete.</p>
        </div>
        <div className="login-proof">
          <div><strong>24/7</strong><span>Live monitoring</span></div>
          <div><strong>3.8M</strong><span>Events processed</span></div>
          <div><strong>99.9%</strong><span>Callback uptime</span></div>
        </div>
      </section>
      <section className="login-side">
        <div className="login-card">
          <div className="eyebrow">Welcome back</div>
          <h2>Sign in to your workspace</h2>
          <p>Use your ResearchOps credentials to continue.</p>
          <Suspense fallback={<div className="auth-loading">Loading sign-in…</div>}><LoginForm /></Suspense>
          <div className="login-foot">Protected workspace · Supabase email authentication</div>
        </div>
      </section>
    </main>
  );
}
