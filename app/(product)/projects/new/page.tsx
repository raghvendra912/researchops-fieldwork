import type { Metadata } from "next";
import { ReferenceProjectCreationForm } from "../../../components/ReferenceProjectCreationForm";

export const metadata: Metadata = { title: "Create project" };

export default function CreateProjectPage() {
  return <div className="project-center-page"><ReferenceProjectCreationForm /></div>;
}
