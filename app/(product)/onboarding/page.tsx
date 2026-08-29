import type { Metadata } from "next";
import { OrganizationOnboardingForm } from "../../components/OrganizationOnboardingForm";

export const metadata: Metadata = { title: "Workspace setup" };

export default function OnboardingPage() {
  return (
    <div className="onboarding-shell">
      <section className="panel onboarding-card">
        <div className="eyebrow">First-time setup</div>
        <h1 className="page-title">Create your workspace</h1>
        <p className="page-subtitle">Set up the organization that will own projects, clients, suppliers, and team access.</p>
        <OrganizationOnboardingForm />
      </section>
    </div>
  );
}
