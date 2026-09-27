import type { Metadata } from "next";
import { AuthPageFrame } from "../components/AuthPageFrame";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return <AuthPageFrame eyebrow="Secure recovery" title="Choose a new password" description="Your recovery link authorizes this one-time password change."><ResetPasswordForm /></AuthPageFrame>;
}
