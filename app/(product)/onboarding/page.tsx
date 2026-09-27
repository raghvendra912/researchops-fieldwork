import type { Metadata } from "next";
import { OrganizationOnboardingForm } from "../../components/OrganizationOnboardingForm";

export const metadata: Metadata = { title: "Workspace setup" };

export default function OnboardingPage() {
  return (
    <div className="project-center-page">
      <section className="reference-filter" aria-label="Workspace setup scope">
        <div className="reference-filter-grid">
          <div className="field"><span className="field-label">Stage</span><span className="control static-control">First-time setup</span></div>
          <div className="field"><span className="field-label">Owner</span><span className="control static-control">Signed-in user</span></div>
          <div className="field"><span className="field-label">Creates</span><span className="control static-control">Organization workspace</span></div>
          <div className="field"><span className="field-label">Defaults</span><span className="control static-control">Supplier starter records</span></div>
          <div className="reference-actions"><span className="reference-icon-button" aria-hidden="true">1</span></div>
        </div>
        <div className="reference-filter-extra"><span className="panel-note">Workspace setup · Create the organization that owns projects, clients, suppliers, and team access.</span></div>
      </section>
      <section className="panel"><div className="panel-head"><h1 className="panel-title">Create your workspace</h1><span className="panel-note">Required once</span></div><div className="uniform-form-body"><OrganizationOnboardingForm /></div></section>
    </div>
  );
}
