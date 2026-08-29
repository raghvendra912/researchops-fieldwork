import type { Metadata } from "next";
import Link from "../../../components/NavigationLink";
import { CreateProjectForm } from "../../../components/CreateProjectForm";

export const metadata: Metadata = { title: "Create project" };

export default function CreateProjectPage() {
  return <><div className="page-head"><div><div className="eyebrow">Project setup</div><h1 className="page-title">Create a new project</h1><p className="page-subtitle">Set the operational foundation. You can refine quotas and supplier rules later.</p></div><Link className="button" href="/projects">← Project Center</Link></div><CreateProjectForm /></>;
}
