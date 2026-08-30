import type { Metadata } from "next";
import Link from "../components/NavigationLink";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return <main className="auth-card-page"><section className="panel auth-card"><Link className="brand-lockup" href="/"><span className="brand-mark">r</span><span>ResearchOps</span></Link><div className="eyebrow">Secure signup</div><h1 className="page-title">Create your workspace account</h1><p className="page-subtitle">Enter your work email, then verify the one-time code sent by ResearchOps Support.</p><SignupForm /></section></main>;
}
