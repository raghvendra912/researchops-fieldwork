import type { Metadata } from "next";
import { AuthPageFrame } from "../components/AuthPageFrame";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return <AuthPageFrame eyebrow="Account recovery" title="Reset your password" description="Enter your work email and we will send recovery instructions."><ForgotPasswordForm /></AuthPageFrame>;
}
