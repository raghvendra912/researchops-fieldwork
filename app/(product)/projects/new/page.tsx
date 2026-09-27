import type { Metadata } from "next";
import Link from "../../../components/NavigationLink";
import { CreateProjectForm } from "../../../components/CreateProjectForm";

export const metadata: Metadata = { title: "Create project" };

export default function CreateProjectPage() {
  return <div className="project-center-page"><section className="reference-filter" aria-label="Project setup"><div className="reference-filter-grid"><div className="field"><span className="field-label">Workflow</span><span className="control static-control">Project setup · 4 steps</span></div><div className="field"><span className="field-label">Result</span><span className="control static-control">Pending project</span></div><div className="field"><span className="field-label">Scope</span><span className="control static-control">Quotas refined later</span></div><div className="field"><label htmlFor="create-back">Navigation</label><Link id="create-back" className="control static-control" href="/projects">← Project Center</Link></div><div className="reference-actions"><Link className="reference-icon-button" href="/projects" aria-label="Back to Project Center" title="Back to Project Center">←</Link></div></div><div className="reference-filter-extra"><span className="panel-note">Create a new project · Set the operational foundation. You can refine quotas and supplier rules later.</span></div></section><CreateProjectForm /></div>;
}
