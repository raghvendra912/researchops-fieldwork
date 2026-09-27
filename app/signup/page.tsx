import type { Metadata } from "next";
import { AuthPageFrame } from "../components/AuthPageFrame";
import { SignupForm } from "./SignupForm";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return <AuthPageFrame eyebrow="Secure signup" title="Create your workspace account" description="Enter your work email, then verify the one-time code sent by ResearchOps Support."><SignupForm /></AuthPageFrame>;
}
