import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthPageFrame } from "../components/AuthPageFrame";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return <AuthPageFrame eyebrow="Welcome back" title="Sign in to your workspace" description="Use your ResearchOps credentials to continue."><Suspense fallback={<div className="auth-loading">Loading sign-in…</div>}><LoginForm /></Suspense></AuthPageFrame>;
}
