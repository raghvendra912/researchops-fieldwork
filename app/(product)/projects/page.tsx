import type { Metadata } from "next";
import { ProjectCenter } from "../../components/ProjectCenter";

export const metadata: Metadata = { title: "Project Center" };

export default function ProjectsPage() {
  return <ProjectCenter />;
}
